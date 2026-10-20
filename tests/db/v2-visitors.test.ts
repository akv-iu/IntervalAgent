import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createVisitorApi } from "../../src/lib/v2/visitor-api";
import { caseStore } from "../../src/lib/v2/case-store";
import { runMockWorkerOnce } from "../../src/lib/v2/mock-worker";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => { db = await testSchema(); });
afterAll(async () => db?.drop());
beforeEach(async () => { await db.pool.query("truncate v2_cases,v2_visitor_sessions,v2_session_limit cascade"); });
const config = { mode: "public" as const, origin: "https://v2.example", databaseUrl: "unused" };
type Api = ReturnType<typeof createVisitorApi>;
function request(path: string, cookie = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`${config.origin}/api/v2/${path}`, { method, headers: { cookie, origin: config.origin, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function start(api = createVisitorApi(db.pool, config), businessId = "northside") {
  const response = await api.handle(request("session", "", { businessId }), "session");
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const create = (api: Api, cookie: string, caseId = "case-1") => api.handle(request("cases", cookie, { caseId, accountId: "account-1" }), "cases");
const post = (api: Api, cookie: string, text = "I already paid", idempotencyKey = "m1", expectedRevision = 1) => api.handle(request("cases/case-1/messages", cookie, { text, idempotencyKey, expectedRevision }), "messages", "case-1");
const get = (api: Api, cookie: string, query = "") => api.handle(request(`cases/case-1${query}`, cookie), "case", "case-1");

test("new sessions use secure cookies and persist only an opaque token hash with a 24h expiry", async () => {
  const api = createVisitorApi(db.pool, config);
  const response = await api.handle(request("session", "", { businessId: "northside" }), "session");
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^__Host-recovery-v2=[A-Za-z0-9_-]{43};/);
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=86400"]) expect(cookie).toContain(flag);
  expect(cookie).not.toContain("Domain=");
  const [row] = (await db.pool.query("select * from v2_visitor_sessions")).rows;
  const token = cookie.split(";")[0].split("=")[1];
  expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row.workspace_id).not.toBe("demo");
  expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(86_400_000);
  expect(await response.text()).not.toMatch(/token|hash|sessionId/i);
});

test("session reads survive a new API instance and repeats do not extend expiry", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  const before = (await db.pool.query("select expires_at from v2_visitor_sessions")).rows[0].expires_at;
  const again = await createVisitorApi(db.pool, config).handle(request("session", cookie, { businessId: "northside" }), "session");
  expect(again.status).toBe(200); expect(again.headers.get("set-cookie")).toBeNull();
  expect((await db.pool.query("select expires_at from v2_visitor_sessions")).rows).toEqual([{ expires_at: before }]);
  expect((await api.handle(request("session", cookie, { businessId: "subscriptions" }), "session")).status).toBe(409);
});

test("forged, expired and revoked sessions fail closed", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  expect((await get(api, `__Host-recovery-v2=${"x".repeat(43)}`)).status).toBe(401);
  await db.pool.query("update v2_visitor_sessions set revoked_at=now()");
  expect((await get(api, cookie)).status).toBe(401);
  await db.pool.query("update v2_visitor_sessions set revoked_at=null,created_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 second'");
  expect((await get(api, cookie)).status).toBe(401);
});

test("different visitors and businesses cannot read or mutate another workspace", async () => {
  const api = createVisitorApi(db.pool, config), first = await start(api), second = await start(api), otherBusiness = await start(api, "subscriptions");
  expect((await create(api, first)).status).toBe(201);
  expect((await get(api, second)).status).toBe(404);
  expect((await get(api, otherBusiness)).status).toBe(404);
  expect((await post(api, second)).status).toBe(404);
  expect((await create(api, otherBusiness)).status).toBe(201);
  expect((await (await get(api, otherBusiness)).json()).case.businessId).toBe("subscriptions");
});

test("visitor HTTP to persisted mock worker path retains history without exposing internal audit/facts", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  expect((await create(api, cookie)).status).toBe(201);
  expect((await post(api, cookie)).status).toBe(201);
  expect(await runMockWorkerOnce(db.pool, "private-worker-id")).toBe("completed");
  const response = await get(api, cookie), body = await response.json();
  expect(body.case).toMatchObject({ state: "awaiting_human", revision: 3 });
  expect(body.messages).toMatchObject([{ role: "customer", text: "I already paid" }]);
  const scope = (await db.pool.query("select business_id,workspace_id from v2_cases")).rows[0];
  await caseStore(db.pool).transition({ kind: "operator", operatorId: "private-operator", businessIds: ["northside"] }, { businessId: scope.business_id, workspaceId: scope.workspace_id, caseId: "case-1" }, { type: "resolve", expectedRevision: 3, reason: "PRIVATE INTERNAL NOTE" });
  const text = await (await get(api, cookie)).text();
  expect(text).not.toMatch(/PRIVATE|private-worker|private-operator|actorId|facts|token|idempotencyKey/);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

test("idempotent case/message retries do not duplicate work and conflicting submissions return 409", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  await create(api, cookie); await create(api, cookie);
  expect((await post(api, cookie)).status).toBe(201);
  const duplicate = await post(api, cookie);
  expect(duplicate.status).toBe(200); expect((await duplicate.json()).duplicate).toBe(true);
  expect((await post(api, cookie, "Different", "m1")).status).toBe(409);
  expect((await post(api, cookie, "Stale", "m2")).status).toBe(409);
  expect((await db.pool.query("select count(*)::int n from v2_case_jobs")).rows[0].n).toBe(1);
});

test("STOP with an old client revision cancels work through the protected endpoint", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  await create(api, cookie); await post(api, cookie);
  const stopped = await post(api, cookie, "STOP", "stop", 1);
  expect(stopped.status).toBe(201);
  expect((await stopped.json()).case).toMatchObject({ state: "closed", contactSuppressed: true });
  expect(await runMockWorkerOnce(db.pool, "worker-1")).toBe("idle");
});

test("logout revokes the server session and clears the matching cookie", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  const response = await api.handle(request("session", cookie, undefined, "DELETE"), "session");
  expect(response.status).toBe(204);
  expect(response.headers.get("set-cookie")).toContain("__Host-recovery-v2=; Max-Age=0");
  expect((await api.handle(request("session", cookie), "session")).status).toBe(401);
});

test("client scope/roles are rejected and cursor/identity input is validated", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  for (const forged of [{ businessId: "subscriptions" }, { workspaceId: "demo" }, { principal: { kind: "operator" } }]) {
    expect((await api.handle(request("cases", cookie, { caseId: "case-1", accountId: "account-1", ...forged }), "cases")).status).toBe(400);
  }
  await create(api, cookie);
  expect((await get(api, cookie, "?limit=1000")).status).toBe(400);
  expect((await api.handle(request("cases/x", cookie), "case", "../x")).status).toBe(400);
  expect((await api.handle(request("cases/case-1/messages", cookie, { text: "Hi", role: "agent", expectedRevision: 1, idempotencyKey: "m1" }), "messages", "case-1")).status).toBe(400);
});

test("database-backed request limits apply across API instances and reset by window", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  await db.pool.query("update v2_visitor_sessions set request_count=120,request_window=clock_timestamp()");
  expect((await createVisitorApi(db.pool, config).handle(request("session", cookie), "session")).status).toBe(429);
  await db.pool.query("update v2_visitor_sessions set request_window=clock_timestamp()-interval '61 seconds'");
  expect((await api.handle(request("session", cookie), "session")).status).toBe(200);
});

test("workspace-start daily cap is atomic and rejects further creation", async () => {
  const api = createVisitorApi(db.pool, config);
  await start(api);
  await db.pool.query("update v2_session_limit set count=200");
  expect((await api.handle(request("session", "", { businessId: "northside" }), "session")).status).toBe(429);
  await db.pool.query("update v2_session_limit set day=(now() at time zone 'UTC')::date-1");
  expect((await api.handle(request("session", "", { businessId: "northside" }), "session")).status).toBe(201);
});

test("failed session insertion rolls back its global quota reservation", async () => {
  const api = createVisitorApi(db.pool, config);
  await db.pool.query("alter table v2_visitor_sessions add constraint injected_failure check (business_id <> 'northside')");
  try { expect((await api.handle(request("session", "", { businessId: "northside" }), "session")).status).toBe(503); }
  finally { await db.pool.query("alter table v2_visitor_sessions drop constraint injected_failure"); }
  expect((await db.pool.query("select count(*)::int n from v2_session_limit")).rows[0].n).toBe(0);
});

test("the dedicated web role can serve visitors without V1, ledger-fact or worker-result privileges", async () => {
  const role = `vv_${db.schema.slice(5)}`;
  const sql = readFileSync("db/ops/v2_web_role.sql", "utf8").split("\n").filter((line) => !line.startsWith("create role")).join("\n").replaceAll("recovery_v2_web", role).replace("schema public", `schema ${db.schema}`);
  const c = await db.pool.connect();
  try {
    await c.query(`create role ${role} nologin`); await c.query(`grant ${role} to current_user`); await c.query(sql); await c.query(`set role ${role}`);
    const pool = { query: c.query.bind(c), connect: async () => ({ query: c.query.bind(c), release() {} }) } as unknown as Pool;
    const api = createVisitorApi(pool, config), cookie = await start(api);
    expect((await create(api, cookie)).status).toBe(201);
    expect((await post(api, cookie)).status).toBe(201);
    expect((await get(api, cookie)).status).toBe(200);
    for (const forbidden of ["select * from accounts", "update v2_cases set facts='{}'", "update v2_case_jobs set result='{}'", "update v2_visitor_sessions set business_id='subscriptions'", "delete from v2_cases"]) {
      await expect(c.query(forbidden)).rejects.toMatchObject({ code: "42501" });
    }
  } finally { await c.query("reset role"); await c.query(`drop owned by ${role}`); await c.query(`drop role ${role}`); c.release(); }
});

test("revocation while a request body is arriving prevents the later case write", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  await create(api, cookie);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await db.pool.query("update v2_visitor_sessions set revoked_at=clock_timestamp()");
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: "Late request", idempotencyKey: "late", expectedRevision: 1 })));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: { cookie, origin: config.origin, "content-type": "application/json" }, body, duplex: "half" };
  const response = await api.handle(new Request(`${config.origin}/api/v2/cases/case-1/messages`, init), "messages", "case-1");
  expect(response.status).toBe(401);
  expect((await db.pool.query("select revision from v2_cases")).rows[0].revision).toBe("1");
  expect((await db.pool.query("select count(*)::int n from v2_case_jobs")).rows[0].n).toBe(0);
});

test("invalid stored facts are a server failure, not a client validation error", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  await create(api, cookie);
  await db.pool.query("update v2_cases set facts='{}'");
  const response = await create(api, cookie);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/accounts|Zod|schema/);
});

test("competing starts cannot exceed the last daily workspace slot", async () => {
  const api = createVisitorApi(db.pool, config);
  await start(api); await db.pool.query("update v2_session_limit set count=199");
  const responses = await Promise.all([api.handle(request("session", "", { businessId: "northside" }), "session"), api.handle(request("session", "", { businessId: "subscriptions" }), "session")]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 429]);
  expect((await db.pool.query("select count from v2_session_limit")).rows[0].count).toBe(200);
});

test("local HTTP uses a distinct host-only cookie and customer cursor pages remain bounded", async () => {
  const local = { ...config, mode: "local" as const, origin: "http://localhost:3000" }, api = createVisitorApi(db.pool, local);
  const response = await api.handle(new Request(`${local.origin}/api/v2/session`, { method: "POST", headers: { origin: local.origin, "content-type": "application/json" }, body: JSON.stringify({ businessId: "northside" }) }), "session");
  expect(response.status).toBe(201);
  expect(response.headers.get("set-cookie")).toMatch(/^recovery-v2-local=/);
  expect(response.headers.get("set-cookie")).not.toContain("Secure");
  const publicApi = createVisitorApi(db.pool, config), cookie = await start(publicApi);
  await create(publicApi, cookie); await post(publicApi, cookie);
  const first = await (await get(publicApi, cookie, "?limit=1")).json();
  expect(first.messages).toEqual([]); expect(first.nextRevision).toBe(1);
  const second = await (await get(publicApi, cookie, "?limit=1&afterRevision=1")).json();
  expect(second.messages).toMatchObject([{ revision: 2, text: "I already paid" }]);
  expect((await get(publicApi, cookie, "?limit=1&limit=2")).status).toBe(400);
});

test("a valid STOP request still suppresses contact after the ordinary request budget is exhausted", async () => {
  const api = createVisitorApi(db.pool, config), cookie = await start(api);
  await create(api, cookie); await post(api, cookie);
  await db.pool.query("update v2_visitor_sessions set request_count=120,request_window=clock_timestamp()");
  const stopped = await post(api, cookie, "STOP", "urgent-stop", 1);
  expect(stopped.status).toBe(201);
  expect((await stopped.json()).case).toMatchObject({ state: "closed", contactSuppressed: true });
  expect((await db.pool.query("select state from v2_case_jobs")).rows[0].state).toBe("cancelled");
});
