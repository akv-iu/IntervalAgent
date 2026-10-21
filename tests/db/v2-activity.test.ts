import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { createVisitorApi } from "../../src/lib/v2/visitor-api";
import { jobStore } from "../../src/lib/v2/case-store";
import { runCheckpointedMock } from "../../src/lib/v2/mock-worker";
import { activityStore } from "../../src/lib/v2/activity-store";
import { runStore } from "../../src/lib/v2/run-store";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => { db = await testSchema(); });
afterAll(async () => db?.drop());
beforeEach(async () => { await db.pool.query("truncate v2_cases,v2_visitor_sessions,v2_session_limit,v2_run_daily_usage cascade"); });
const config = { mode: "public" as const, origin: "https://v2.example", databaseUrl: "unused" };
type Api = ReturnType<typeof createVisitorApi>;
function request(cookie: string, path = "cases/case-1/activity", body?: unknown) {
  return new Request(`${config.origin}/api/v2/${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin: config.origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function setup(businessId = "northside", accountId = "account-1") {
  const api = createVisitorApi(db.pool, config);
  const response = await api.handle(request("", "session", { businessId }), "session");
  expect(response.status).toBe(201);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect((await api.handle(request(cookie, "cases", { caseId: "case-1", accountId }), "cases")).status).toBe(201);
  return { api, cookie };
}
const load = (api: Api, cookie: string, suffix = "") => api.handle(request(cookie, `cases/case-1/activity${suffix}`), "activity", "case-1");
async function post(api: Api, cookie: string, text = "I already paid", expectedRevision = 1, idempotencyKey = "message-1") {
  expect((await api.handle(request(cookie, "cases/case-1/messages", { text, expectedRevision, idempotencyKey }), "messages", "case-1")).status).toBe(201);
}
async function complete() {
  const jobs = jobStore(db.pool), job = (await jobs.claim("private-worker"))!;
  const result = await runCheckpointedMock(db.pool, job);
  expect(await jobs.complete(job.lease, result)).toBe(true);
}

test("activity is empty before submission and queued before dispatch, with no-store and strict input", async () => {
  const { api, cookie } = await setup();
  expect(await (await load(api, cookie)).json()).toMatchObject({ execution: null, messages: [], tools: [], evidence: [], proposal: null });
  await post(api, cookie);
  const response = await load(api, cookie);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toMatchObject({ execution: { state: "queued", leaseActive: false, mode: "unavailable", usage: null }, proposal: null });
  expect((await load(api, cookie, "?businessId=subscriptions")).status).toBe(400);
  expect((await load(api, "")).status).toBe(401);
});

test("checkpoints appear without a case revision change and the reviewed $14 remains pending", async () => {
  const { api, cookie } = await setup(); await post(api, cookie);
  const jobs = jobStore(db.pool), job = (await jobs.claim("private-worker"))!;
  const result = await runCheckpointedMock(db.pool, job);
  const active = await (await load(api, cookie)).json();
  expect(active.case.revision).toBe(2);
  expect(active.execution).toMatchObject({ caseRevision: 2, state: "running", leaseActive: true, mode: "mock" });
  expect(active.messages.map((m: { sender: string }) => m.sender)).toEqual(expect.arrayContaining(["customer", "coordinator", "investigator", "reviewer"]));
  expect(active.messages).toHaveLength(6); expect(active.tools).toHaveLength(5); expect(active.proposal).toBeNull();
  expect(await jobs.complete(job.lease, result)).toBe(true);
  const finished = await (await load(api, cookie)).json();
  expect(finished.proposal).toMatchObject({ status: "pending_human", projectedBalanceCents: 1400, sourceCaseRevision: 2 });
  expect(finished.execution.usage).toMatchObject({ modelRequests: 0, observedInputTokens: 0, unknownModelAttempts: 0, heldTokens: 0 });
  expect(finished.evidence.some((e: { recordType: string }) => e.recordType === "policy")).toBe(true);
  expect(finished.evidence.find((e: { recordType: string }) => e.recordType === "invoice").fields).toEqual(expect.arrayContaining([{ label: "Invoice total", value: "$84.00" }]));
  expect(finished.messages[1].parentOrdinal).toBe(1);
});

test("the second business projects its own policy and $34 pending balance", async () => {
  const { api, cookie } = await setup("subscriptions"); await post(api, cookie); await complete();
  const body = await (await load(api, cookie)).json();
  expect(body.case.businessId).toBe("subscriptions"); expect(body.proposal.projectedBalanceCents).toBe(3400);
  expect(body.proposal.actions.map((a: { type: string }) => a.type)).toEqual(["allocate_payment"]);
});

test("new input and STOP cannot retain a previous proposal or attach old activity to the next job", async () => {
  const { api, cookie } = await setup(); await post(api, cookie); await complete();
  await post(api, cookie, "Check again", 3, "message-2");
  expect(await (await load(api, cookie)).json()).toMatchObject({ execution: { caseRevision: 4, state: "queued" }, messages: [], proposal: null });
  await complete(); await post(api, cookie, "STOP", 1, "stop");
  const stopped = await (await load(api, cookie)).json();
  expect(stopped.case.contactSuppressed).toBe(true); expect(stopped.proposal).toBeNull();
});

test("different visitors, businesses and invalid/revoked principals cannot inspect this trace", async () => {
  const first = await setup(), second = await setup(), other = await setup("subscriptions");
  await post(first.api, first.cookie); await complete();
  expect((await (await load(second.api, second.cookie)).json()).messages).toEqual([]);
  expect((await (await load(other.api, other.cookie)).json()).messages).toEqual([]);
  await db.pool.query("update v2_visitor_sessions set revoked_at=clock_timestamp()");
  expect((await load(first.api, first.cookie)).status).toBe(401);
  await expect(activityStore(db.pool).read({ kind: "visitor", sessionId: "bad", businessId: "subscriptions", workspaceId: "other" }, { businessId: "northside", workspaceId: "other", caseId: "case-1" })).rejects.toThrow("case access denied");
});

test("safe summaries omit task instructions, drafts, pinned prompts and worker identities", async () => {
  const { api, cookie } = await setup(); await post(api, cookie); await complete();
  await db.pool.query(`update v2_agent_messages set message=jsonb_set(message,'{payload,instruction}','"PRIVATE INSTRUCTION"') where message->>'kind'='task_request'`);
  await db.pool.query(`update v2_agent_messages set message=jsonb_set(message,'{payload,message}','"PRIVATE DRAFT"') where message->>'kind'='proposal'`);
  await db.pool.query(`update v2_case_runs set snapshot=jsonb_set(snapshot,'{instruction}','"PRIVATE PROMPT"')`);
  const response = await load(api, cookie); expect(response.status).toBe(200);
  expect(await response.text()).not.toMatch(/PRIVATE|private-worker|lease_token|requestHash|parentMessageId|runId|sessionId|idempotencyKey/);
});

test("missing evidence versions stay visibly missing and foreign evidence fails closed", async () => {
  const { api, cookie } = await setup(); await post(api, cookie); await complete();
  await db.pool.query(`update v2_agent_messages set message=jsonb_set(message,'{evidenceRefs,0,version}','999') where ordinal=3`);
  const missing = await (await load(api, cookie)).json();
  expect(missing.evidence.some((e: { version: number; status: string }) => e.version === 999 && e.status === "missing")).toBe(true);
  await db.pool.query(`update v2_agent_messages set message=jsonb_set(message,'{evidenceRefs,0,accountId}','"other"') where ordinal=3`);
  const response = await load(api, cookie);
  expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/foreign|other/);
});

test("model-test known usage, unknown reservations and expired leases remain distinct", async () => {
  const { api, cookie } = await setup(); await post(api, cookie);
  const job = (await jobStore(db.pool).claim("test-worker"))!, runs = runStore(db.pool);
  await runs.openModelTest(job.lease, "test-model");
  const reserve = (operationKey: string) => runs.reserveModel(job.lease, { operationKey, role: "customer", inputTokens: 400, requestHash: "a".repeat(64) });
  const known = await reserve("known"); await runs.settleModel(job.lease, known.attemptId, { input: 100, output: 20 });
  const unknown = await reserve("unknown"); await runs.settleModel(job.lease, unknown.attemptId, null);
  const active = await (await load(api, cookie)).json();
  expect(active.execution).toMatchObject({ mode: "model_test", leaseActive: true, usage: { modelRequests: 2, observedInputTokens: 100, observedOutputTokens: 20, unknownModelAttempts: 1, heldTokens: 1000, chargedTokens: 1120 } });
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  expect((await (await load(api, cookie)).json()).execution.leaseActive).toBe(false);
});

test("ambiguous investigations escalate without inventing a proposal", async () => {
  const { api, cookie } = await setup("northside", "account-3"); await post(api, cookie); await complete();
  const body = await (await load(api, cookie)).json();
  expect(body.proposal).toBeNull();
  expect(body.messages.some((m: { kind: string; decision: string | null }) => m.kind === "escalation" || m.decision === "escalate")).toBe(true);
});

test("unavailable tool details stay private and a retry keeps the failed lookup visible", async () => {
  const { api, cookie } = await setup(); await post(api, cookie);
  const jobs = jobStore(db.pool), job = (await jobs.claim("tool-worker"))!, runs = runStore(db.pool);
  await runs.open(job.lease);
  const slot = await runs.reserveTool(job.lease, { operationKey: "account-history", request: { name: "account_history", accountId: "account-1" } });
  if (slot.kind !== "dispatch") throw new Error("fresh tool reservation required");
  await runs.settleTool(job.lease, slot.attemptId, { name: "account_history", status: "unavailable", message: "PRIVATE TOOL DETAIL", evidenceRefs: [] });
  await jobs.fail(job.lease);
  const response = await load(api, cookie); expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.execution).toMatchObject({ state: "queued", attempts: 1, leaseActive: false });
  expect(body.tools).toMatchObject([{ name: "account_history", status: "unavailable" }]); expect(body.proposal).toBeNull();
  expect(JSON.stringify(body)).not.toContain("PRIVATE TOOL DETAIL");
});

test("real web grants allow projected reads but deny raw prompts, requests, results and writes", async () => {
  const { api, cookie } = await setup(); await post(api, cookie); await complete();
  const role = `va_${db.schema.slice(5)}`, c = await db.pool.connect();
  const sql = readFileSync("db/ops/v2_web_role.sql", "utf8").split("\n").filter((line) => !line.startsWith("create role")).join("\n").replaceAll("recovery_v2_web", role).replace("schema public", `schema ${db.schema}`);
  try {
    await c.query(`create role ${role} nologin`); await c.query(`grant ${role} to current_user`); await c.query(sql); await c.query(`set role ${role}`);
    const pool = { query: c.query.bind(c), connect: async () => ({ query: c.query.bind(c), release() {} }) } as unknown as Pool;
    const response = await load(createVisitorApi(pool, config), cookie);
    expect(response.status).toBe(200); expect((await response.json()).proposal.projectedBalanceCents).toBe(1400);
    for (const query of ["select snapshot from v2_case_runs", "select request from v2_run_attempts", "select message from v2_agent_messages", "select result from v2_case_jobs", "select lease_token from v2_case_jobs"]) {
      await expect(c.query(query)).rejects.toMatchObject({ code: "42501" });
    }
    for (const view of ["v2_activity_jobs", "v2_activity_messages", "v2_activity_tools"]) {
      expect((await c.query("select has_table_privilege(current_user,$1,'UPDATE,DELETE,INSERT') allowed", [view])).rows[0].allowed).toBe(false);
    }
    await expect(c.query("update v2_activity_jobs set state='succeeded'")).rejects.toThrow();
    await expect(c.query("delete from v2_activity_messages")).rejects.toThrow();
  } finally { await c.query("reset role"); await c.query(`drop owned by ${role}`); await c.query(`drop role ${role}`); c.release(); }
});
