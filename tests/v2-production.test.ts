import { v2Config } from "../src/lib/v2/store";
import * as store from "../src/lib/v2/store";
import { handleV2 } from "../src/lib/v2/http";
import { projectEnv } from "../src/lib/project-env";

vi.mock("../src/lib/project-env", () => ({ projectEnv: vi.fn() }));
const publicOrigin = "https://interval-agent.vercel.app";
const hostedUrl = "postgresql://demo:synthetic@example.neon.tech/intervalagent_v2?sslmode=verify-full";

beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.mocked(projectEnv).mockReturnValue({ V2_ENABLED: "true", V2_DATABASE_URL: "postgresql://demo:synthetic@127.0.0.1:55442/intervalagent_v2" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function hosted() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("V2_ENABLED", "true");
  vi.stubEnv("V2_DATABASE_URL", hostedUrl);
  vi.stubEnv("V2_PUBLIC_ORIGIN", publicOrigin);
  vi.stubEnv("V2_OPENAI_API_KEY", "synthetic-key");
}

test("hosted settings come from Vercel with a separate verified database and shared budget cap", () => {
  hosted();
  expect(v2Config()).toEqual({ databaseUrl: hostedUrl, apiKey: "synthetic-key", publicOrigin, maxSpendMicros: 5_000_000 });
  expect(projectEnv).not.toHaveBeenCalled();
});

test.each([
  ["V2_ENABLED", "false"],
  ["V2_DATABASE_URL", "not a URL"],
  ["V2_DATABASE_URL", hostedUrl.replace("intervalagent_v2", "neondb")],
  ["V2_DATABASE_URL", hostedUrl.replace("example.neon.tech", "foreign.test")],
  ["V2_DATABASE_URL", hostedUrl.replace("verify-full", "disable")],
  ["V2_PUBLIC_ORIGIN", "http://interval-agent.vercel.app"],
  ["V2_PUBLIC_ORIGIN", `${publicOrigin}/foreign`],
  ["V2_PUBLIC_ORIGIN", "https://user:pass@interval-agent.vercel.app"],
])("hosted configuration rejects invalid %s", (key, value) => {
  hosted(); vi.stubEnv(key, value);
  expect(() => v2Config()).toThrow();
});

test("local development retains its loopback isolation and file configuration", () => {
  vi.stubEnv("V2_DATABASE_URL", hostedUrl);
  expect(v2Config().publicOrigin).toBeUndefined();
  expect(v2Config().databaseUrl).toContain("127.0.0.1:55442");
  vi.mocked(projectEnv).mockReturnValue({ V2_ENABLED: "true", V2_DATABASE_URL: hostedUrl });
  expect(() => v2Config()).toThrow("loopback");
});

test.each([
  { url: publicOrigin, host: "foreign.test", origin: publicOrigin },
  { url: "https://foreign.test", host: "interval-agent.vercel.app", origin: publicOrigin },
  { url: publicOrigin, host: "interval-agent.vercel.app", origin: "https://foreign.test" },
  { url: publicOrigin, host: "interval-agent.vercel.app", origin: "" },
])("production refuses untrusted hosts and cross-origin writes", async ({ url, host, origin }) => {
  hosted();
  const create = vi.spyOn(store, "createWorkspace");
  const response = await handleV2(new Request(`${url}/api/v2/workspace`, { method: "POST", headers: { host, origin }, body: JSON.stringify({ action: "create" }) }));
  expect(response.status).toBe(403);
  expect(create).not.toHaveBeenCalled();
});

test("a production workspace uses an isolated HttpOnly secure cookie and rejects missing sessions", async () => {
  hosted();
  vi.spyOn(store, "readWorkspace").mockRejectedValue(new store.V2Error(401, "Start a private workspace."));
  const headers = { host: "interval-agent.vercel.app", origin: publicOrigin };
  expect((await handleV2(new Request(`${publicOrigin}/api/v2/workspace`, { headers }))).status).toBe(401);
  vi.spyOn(store, "createWorkspace").mockResolvedValue({ token: "a".repeat(64), view: { cases: {}, resets: 0, expiresAt: "2026-11-18T00:00:00Z" } });
  vi.spyOn(store, "budgetUsage").mockResolvedValue({ capDollars: 5, conservativeUsedDollars: 0, calls: 0, unknown_calls: 0, input_tokens: 0, output_tokens: 0 });
  const response = await handleV2(new Request(`${publicOrigin}/api/v2/workspace`, { method: "POST", headers, body: JSON.stringify({ action: "create" }) }));
  expect(response.status).toBe(201);
  expect(response.headers.get("set-cookie")).toContain("Path=/api/v2; Max-Age=86400; HttpOnly; SameSite=Strict; Secure");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
