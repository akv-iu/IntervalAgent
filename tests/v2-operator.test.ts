import type { Pool } from "pg";
import type { OperatorAuth } from "../src/lib/v2/operator-auth";
import { operatorConfig } from "../src/lib/v2/operator-config";
import { createOperatorApi } from "../src/lib/v2/operator-api";

const env = { V2_MODE: "public", V2_OPERATOR_AUTH: "true", V2_ORIGIN: "https://v2.example", V2_OPERATOR_DATABASE_URL: "postgres://example/db", V2_AUTH_SECRET: "a-long-test-secret-that-is-not-a-real-credential", V2_GITHUB_CLIENT_ID: "fixture", V2_GITHUB_CLIENT_SECRET: "fixture" };
const config = operatorConfig(env)!;
function setup() {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const auth = { handler: vi.fn(), api: { getSession: vi.fn().mockResolvedValue(null) } };
  return { pool, auth, api: createOperatorApi(pool as unknown as Pool, config, auth as unknown as OperatorAuth) };
}
function req(path = "operator/session", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${config.origin}/api/v2/${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: config.origin, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("operator auth has its own explicit opt-in and credentials, with no owner/web fallback", () => {
  expect(operatorConfig({})).toBeNull();
  expect(operatorConfig({ ...env, V2_MODE: "off" })).toBeNull();
  expect(operatorConfig({ ...env, V2_OPERATOR_AUTH: "false" })).toBeNull();
  for (const key of ["V2_OPERATOR_DATABASE_URL", "V2_AUTH_SECRET", "V2_GITHUB_CLIENT_ID", "V2_GITHUB_CLIENT_SECRET"]) {
    expect(() => operatorConfig({ ...env, [key]: "", DATABASE_URL: "private", V2_WEB_DATABASE_URL: "postgres://example/db" })).toThrow();
  }
  expect(() => operatorConfig({ ...env, V2_AUTH_SECRET: "short" })).toThrow();
  expect(() => operatorConfig({ ...env, V2_ORIGIN: "http://v2.example" })).toThrow();
  expect(() => operatorConfig({ ...env, V2_OPERATOR_AUTH: "typo" })).toThrow();
});

test("auth entry accepts only GitHub sign-in, its callback and sign-out", async () => {
  const { api, auth, pool } = setup();
  for (const path of ["auth/get-session", "auth/sign-up/email", "auth/link-social", "auth/callback/google", "auth/delete-user", "auth/anything"]) {
    expect((await api.handle(req(path), "auth")).status).toBe(404);
  }
  for (const body of [{ provider: "google" }, { provider: "github", callbackURL: "https://evil.example" }, { provider: "github", idToken: { token: "forged" } }]) {
    expect((await api.handle(req("auth/sign-in/social", body), "auth")).status).toBe(400);
  }
  expect(auth.handler).not.toHaveBeenCalled(); expect(pool.query).not.toHaveBeenCalled();
});

test("sign-in forces a same-origin callback and strips forwarded authority headers", async () => {
  const { api, auth, pool } = setup();
  pool.query.mockResolvedValue({ rows: [{ count: 1 }] });
  auth.handler.mockResolvedValue(Response.json({ url: "https://github.com/login/oauth/authorize" }));
  const result = await api.handle(req("auth/sign-in/social", { provider: "github" }, { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" }), "auth");
  expect(result.status).toBe(200);
  const forwarded = auth.handler.mock.calls[0][0] as Request;
  expect(await forwarded.json()).toEqual({ provider: "github", callbackURL: `${config.origin}/api/v2/operator/session` });
  expect(forwarded.headers.get("x-forwarded-host")).toBeNull();
  expect(forwarded.headers.get("x-forwarded-proto")).toBeNull();
  expect(result.headers.get("cache-control")).toContain("no-store");
});

test("origin/host gates and JSON byte limits run before auth or database work", async () => {
  const { api, auth, pool } = setup();
  const badHeaders: Record<string, string>[] = [{ origin: "https://evil.example" }, { origin: "" }, { host: "evil.example", "x-forwarded-host": "v2.example" }];
  for (const headers of badHeaders) {
    expect((await api.handle(req("auth/sign-in/social", { provider: "github" }, headers), "auth")).status).toBe(403);
  }
  expect((await api.handle(req("auth/sign-in/social", { provider: "github", padding: "x".repeat(5000) }), "auth")).status).toBe(413);
  expect(auth.handler).not.toHaveBeenCalled(); expect(auth.api.getSession).not.toHaveBeenCalled(); expect(pool.query).not.toHaveBeenCalled();
  const internal = new Request("http://localhost:3000/api/v2/operator/session", { headers: { host: "v2.example" } });
  expect((await api.handle(internal, "session")).status).toBe(401);
});

test("a forged principal or visitor cookie never establishes an operator session", async () => {
  const { api, pool } = setup();
  for (const cookie of ["", "__Host-recovery-v2=visitor", "v2-operator-local.session_token=forged"]) {
    const response = await api.handle(req("operator/session?operatorId=owner&businessId=northside", undefined, { cookie, "x-operator-id": "owner" }), "session");
    expect(response.status).toBe(400);
  }
  expect((await api.handle(req(), "session")).status).toBe(401);
  expect(pool.query).not.toHaveBeenCalled();
});

test("errors expose no identity, database details or authentication tokens", async () => {
  const { api, auth } = setup();
  auth.api.getSession.mockRejectedValue(new Error("PRIVATE DATABASE TOKEN"));
  const response = await api.handle(req(), "session");
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(response.headers.get("cache-control")).toContain("no-store");
});

test("OAuth callback errors return a sanitized response and successful redirects suppress referrers", async () => {
  const { api, auth, pool } = setup();
  pool.query.mockResolvedValue({ rows: [{ count: 1 }] });
  auth.handler.mockResolvedValue(new Response(null, { status: 302, headers: { location: `${config.origin}/api/v2/auth/error?error_description=PRIVATE-PROVIDER-DETAIL` } }));
  const failed = await api.handle(req("auth/callback/github?state=fixture&code=fixture"), "auth");
  expect(failed.status).toBe(400);
  expect(await failed.text()).not.toContain("PRIVATE");
  expect(failed.headers.get("location")).toBeNull();
  auth.handler.mockResolvedValue(new Response(null, { status: 302, headers: { location: `${config.origin}/api/v2/operator/session` } }));
  const success = await api.handle(req("auth/callback/github?state=fixture&code=fixture"), "auth");
  expect(success.status).toBe(302);
  expect(success.headers.get("referrer-policy")).toBe("no-referrer");
});
