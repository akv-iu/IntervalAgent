import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { createOperatorAuth, operatorCookieName } from "../../src/lib/v2/operator-auth";
import { createOperatorApi } from "../../src/lib/v2/operator-api";
import { operatorConfig } from "../../src/lib/v2/operator-config";
import { caseStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => { db = await testSchema(); });
afterAll(async () => db?.drop());
beforeEach(async () => { await db.pool.query("truncate v2_cases,v2_auth_user,v2_auth_verification,v2_auth_limit cascade"); });
afterEach(() => vi.unstubAllGlobals());
const config = operatorConfig({ V2_MODE: "public", V2_OPERATOR_AUTH: "true", V2_ORIGIN: "https://v2.example", V2_OPERATOR_DATABASE_URL: "postgres://example/db", V2_AUTH_SECRET: "a-long-test-secret-that-is-not-a-real-credential", V2_GITHUB_CLIENT_ID: "fixture", V2_GITHUB_CLIENT_SECRET: "fixture" })!;
const request = (path: string, cookie = "", body?: unknown) => new Request(`${config.origin}/api/v2/${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin: config.origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function api(pool = db.pool) { return createOperatorApi(pool, config, createOperatorAuth(pool, config)); }
async function identity(member = true) {
  const id = randomUUID(), token = randomUUID();
  await db.pool.query(`insert into v2_auth_user(id,name,email,"emailVerified","createdAt","updatedAt") values($1,'Fixture',$2,true,now(),now())`, [id, `${id}@example.test`]);
  await db.pool.query(`insert into v2_auth_session(id,token,"userId","expiresAt","createdAt","updatedAt") values($1,$2,$3,now()+interval '8 hours',now(),now())`, [randomUUID(), token, id]);
  let operatorId: string | undefined;
  if (member) {
    operatorId = (await db.pool.query("insert into v2_operators(user_id) values($1) returning operator_id", [id])).rows[0].operator_id;
    await db.pool.query("insert into v2_operator_memberships(operator_id,business_id) values($1,'northside')", [operatorId]);
  }
  const signature = createHmac("sha256", config.secret).update(token).digest("base64");
  return { id, operatorId, token, cookie: `${operatorCookieName(config)}=${encodeURIComponent(`${token}.${signature}`)}` };
}

test("real auth validates signed database sessions and returns only provisioned business access", async () => {
  const who = await identity(), app = api();
  const response = await app.handle(request("operator/session", who.cookie), "session");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ operatorId: who.operatorId, businessIds: ["northside"] });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect((await api().handle(request("operator/session", who.cookie), "session")).status).toBe(200);
  const expiry = (await db.pool.query(`select "expiresAt"-"createdAt" as age from v2_auth_session`)).rows[0].age;
  expect(expiry.hours).toBe(8);
});

test("valid GitHub identity alone grants no membership; revocation and disabling take effect immediately", async () => {
  const unapproved = await identity(false), app = api();
  expect((await app.handle(request("operator/session", unapproved.cookie), "session")).status).toBe(403);
  const who = await identity();
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(200);
  await db.pool.query("update v2_operator_memberships set revoked_at=now()");
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(403);
  await db.pool.query("update v2_operator_memberships set revoked_at=null");
  await db.pool.query("update v2_operators set disabled_at=now()");
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(403);
});

test("session deletion between library validation and membership resolution denies access", async () => {
  const who = await identity();
  const pool = {
    connect: db.pool.connect.bind(db.pool),
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes("v2_operators o")) await db.pool.query("delete from v2_auth_session");
      return db.pool.query(sql, values);
    },
  } as unknown as Pool;
  expect((await api(pool).handle(request("operator/session", who.cookie), "session")).status).toBe(401);
});

test("forged, duplicate, expired, deleted and visitor sessions cannot access operator data", async () => {
  const who = await identity(), app = api();
  for (const cookie of [who.cookie.replace(/.$/, "x"), `${who.cookie}; ${who.cookie}`, "__Host-recovery-v2=visitor"]) {
    expect((await app.handle(request("operator/session", cookie), "session")).status).toBe(401);
  }
  await db.pool.query(`update v2_auth_session set "expiresAt"=now()-interval '1 second'`);
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(401);
  await db.pool.query("delete from v2_auth_session");
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(401);
});

test("operator case reads expose scoped evidence and audit only for granted businesses", async () => {
  const who = await identity(), app = api(), store = caseStore(db.pool);
  const principal = { kind: "operator", operatorId: "fixture-operator", businessIds: ["northside", "subscriptions"] };
  for (const businessId of ["northside", "subscriptions"]) {
    await store.create(principal, { businessId, workspaceId: "demo", caseId: "case-1", accountId: "account-1" }, demoRecords());
  }
  const key = { businessId: "northside", workspaceId: "demo", caseId: "case-1" };
  const response = await app.handle(request("operator/cases/northside/demo/case-1", who.cookie), "case", key);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.case).toMatchObject(key);
  expect(body.facts.accounts).toHaveLength(1);
  expect(body.history.events).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain(who.token);
  expect((await app.handle(request("operator/cases/subscriptions/demo/case-1", who.cookie), "case", { ...key, businessId: "subscriptions" })).status).toBe(403);
  expect((await app.handle(request("operator/cases/northside/missing/case-1", who.cookie), "case", { ...key, workspaceId: "missing" })).status).toBe(404);
});

test("GitHub OAuth uses state binding, encrypts provider tokens, and does not self-enroll operators", async () => {
  const app = api(), calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input); calls.push(url);
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "PRIVATE-GITHUB-TOKEN", token_type: "bearer", scope: "read:user,user:email" });
    if (url === "https://api.github.com/user") return Response.json({ id: 123456, login: "fixture", name: "Fixture", email: "fixture@example.test", avatar_url: null });
    if (url === "https://api.github.com/user/emails") return Response.json([{ email: "fixture@example.test", primary: true, verified: true }]);
    throw new Error("Unexpected network destination");
  }));
  const begin = await app.handle(request("auth/sign-in/social", "", { provider: "github" }), "auth");
  expect(begin.status).toBe(200);
  const url = new URL((await begin.json()).url);
  expect(url.origin).toBe("https://github.com");
  expect(url.searchParams.get("redirect_uri")).toBe(`${config.origin}/api/v2/auth/callback/github`);
  const cookie = begin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const callback = `auth/callback/github?code=fixture-code&state=${encodeURIComponent(url.searchParams.get("state")!)}`;
  const stolen = await app.handle(request(callback), "auth");
  expect(stolen.status).toBe(400);
  expect((await db.pool.query("select count(*)::int n from v2_auth_session")).rows[0].n).toBe(0);
  // Start a fresh browser flow after the rejected callback.
  const fresh = await app.handle(request("auth/sign-in/social", "", { provider: "github" }), "auth");
  const freshUrl = new URL((await fresh.json()).url);
  const freshCookie = fresh.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const callbackUrl = `${config.origin}/api/v2/auth/callback/github?code=fixture-code&state=${encodeURIComponent(freshUrl.searchParams.get("state")!)}`;
  const browserCallback = () => new Request(callbackUrl, { headers: { cookie: freshCookie || cookie, "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
  const completed = await app.handle(browserCallback(), "auth");
  expect(completed.status).toBe(302);
  expect(completed.headers.get("location")).toBe(`${config.origin}/api/v2/operator/session`);
  const authCookie = completed.headers.getSetCookie().find((c) => c.startsWith(`${operatorCookieName(config)}=`))!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(authCookie.toLowerCase()).toContain(flag.toLowerCase());
  expect(authCookie).not.toMatch(/domain=/i);
  const stored = (await db.pool.query(`select "providerId","accountId","accessToken" from v2_auth_account`)).rows[0];
  expect(stored).toMatchObject({ providerId: "github", accountId: "123456" });
  expect(stored.accessToken).not.toBe("PRIVATE-GITHUB-TOKEN");
  expect((await db.pool.query("select count(*)::int n from v2_operators")).rows[0].n).toBe(0);
  expect((await app.handle(request("operator/session", authCookie.split(";")[0]), "session")).status).toBe(403);
  expect((await app.handle(browserCallback(), "auth")).status).toBe(400);
  expect((await db.pool.query("select count(*)::int n from v2_auth_session")).rows[0].n).toBe(1);
  expect(calls.length).toBeGreaterThanOrEqual(2);
});

test("logout revokes a real database session even after the ordinary operator budget is exhausted", async () => {
  const who = await identity(), app = api();
  await db.pool.query("update v2_operators set request_count=120,request_window=clock_timestamp()");
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(429);
  const logout = await app.handle(request("auth/sign-out", who.cookie, {}), "auth");
  expect(logout.status).toBe(200);
  expect((await db.pool.query("select count(*)::int n from v2_auth_session")).rows[0].n).toBe(0);
  expect((await app.handle(request("operator/session", who.cookie), "session")).status).toBe(401);
});

test("concurrent sign-ins share the last global slot and a new database minute resets the allowance", async () => {
  await db.pool.query("insert into v2_auth_limit values(true,date_trunc('minute',clock_timestamp()),59)");
  const responses = await Promise.all([api().handle(request("auth/sign-in/social", "", { provider: "github" }), "auth"), api().handle(request("auth/sign-in/social", "", { provider: "github" }), "auth")]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
  expect(responses.find((r) => r.status === 429)!.headers.get("retry-after")).toBe("60");
  expect((await db.pool.query("select count from v2_auth_limit")).rows[0].count).toBe(60);
  await db.pool.query("update v2_auth_limit set window_start=clock_timestamp()-interval '1 minute'");
  expect((await api().handle(request("auth/sign-in/social", "", { provider: "github" }), "auth")).status).toBe(200);
});

test("the owner enrollment script pins GitHub account ID and does not re-enable a disabled operator", async () => {
  const first = await identity(false), second = await identity(false);
  for (const [index, who] of [first, second].entries()) {
    await db.pool.query(`insert into v2_auth_account(id,"accountId","providerId","userId","createdAt","updatedAt") values($1,$2,'github',$3,now(),now())`, [randomUUID(), String(100 + index), who.id]);
  }
  async function grant() {
    const c = await db.pool.connect();
    try {
      const sql = readFileSync("db/ops/v2_operator_membership.sql", "utf8").split(/\r?\n/).filter((s) => !s.startsWith("--")).join("\n");
      for (const statement of sql.split(";").filter((s) => s.trim())) {
        const query = statement.replaceAll(":'github_account_id'", "$1").replaceAll(":'business_id'", "$2");
        await c.query(query, query.includes("$2") ? ["100", "northside"] : query.includes("$1") ? ["100"] : []);
      }
    } catch (error) { await c.query("rollback"); throw error; }
    finally { c.release(); }
  }
  await grant();
  expect((await api().handle(request("operator/session", first.cookie), "session")).status).toBe(200);
  expect((await api().handle(request("operator/session", second.cookie), "session")).status).toBe(403);
  await db.pool.query("update v2_operators set disabled_at=now()");
  await db.pool.query("update v2_operator_memberships set revoked_at=now()");
  await grant();
  expect((await db.pool.query("select revoked_at from v2_operator_memberships")).rows[0].revoked_at).not.toBeNull();
  expect((await api().handle(request("operator/session", first.cookie), "session")).status).toBe(403);
});

test("restricted operator role can authenticate/read but cannot self-grant, change facts, or affect V1", async () => {
  const who = await identity(), c = await db.pool.connect(), role = `v2_operator_${db.schema}`;
  const key = { businessId: "northside", workspaceId: "demo", caseId: "case-1" };
  await caseStore(db.pool).create({ kind: "operator", operatorId: "fixture-operator", businessIds: ["northside"] }, { ...key, accountId: "account-1" }, demoRecords());
  try {
    await c.query(`create role ${role}`);
    await c.query(`grant ${role} to current_user`);
    const grants = readFileSync("db/ops/v2_operator_role.sql", "utf8").split(/\r?\n/).filter((s) => !s.startsWith("create role") && !s.startsWith("--")).join("\n").replaceAll("schema public", `schema ${db.schema}`).replaceAll("recovery_v2_operator", role);
    await c.query(grants); await c.query(`set role ${role}`);
    const pool = { query: c.query.bind(c), connect: async () => ({ query: c.query.bind(c), release() {} }) } as unknown as Pool;
    expect((await api(pool).handle(request("operator/session", who.cookie), "session")).status).toBe(200);
    expect((await api(pool).handle(request("operator/cases/northside/demo/case-1", who.cookie), "case", key)).status).toBe(200);
    for (const sql of ["select * from accounts", "insert into v2_operators(user_id) values('forged')", "update v2_operator_memberships set revoked_at=null", "update v2_operators set disabled_at=null", "update v2_cases set facts='{}'", "update v2_cases set state='resolved'", "select * from v2_visitor_sessions"]) {
      await expect(c.query(sql)).rejects.toMatchObject({ code: "42501" });
    }
  } finally {
    try { await c.query("reset role"); await c.query(`drop owned by ${role}`); await c.query(`drop role ${role}`); }
    finally { c.release(); }
  }
});
