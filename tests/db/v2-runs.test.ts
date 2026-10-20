import type { Pool } from "pg";
import { caseStore, jobStore, type ClaimedJob } from "../../src/lib/v2/case-store";
import { runStore, RunLimit } from "../../src/lib/v2/run-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { createReadTools } from "../../src/lib/v2/tools";
import { runMockWorkerOnce } from "../../src/lib/v2/mock-worker";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => {
  db = await testSchema();
  await db.pool.query("insert into v2_visitor_sessions(session_id,token_hash,business_id,workspace_id) values('visitor-1',$1,'northside','demo')", ["a".repeat(64)]);
});
afterAll(async () => db?.drop());
beforeEach(async () => { await db.pool.query("truncate v2_cases,v2_run_daily_usage cascade"); });
const visitor = { kind: "visitor", sessionId: "visitor-1", businessId: "northside", workspaceId: "demo" };
const key = { businessId: "northside", workspaceId: "demo", caseId: "run-case" };
const model = (operationKey = "customer") => ({ operationKey, role: "customer", inputTokens: 400, requestHash: "a".repeat(64) });
const tool = { operationKey: "history", request: { name: "account_history", accountId: "account-1" } };
async function queued(caseId = key.caseId) {
  const cases = caseStore(db.pool), k = { ...key, caseId };
  await cases.create(visitor, { ...k, accountId: "account-1" }, demoRecords());
  await cases.append(visitor, k, { text: "I already paid", idempotencyKey: "first", expectedRevision: 1 });
  return { cases, jobs: jobStore(db.pool), runs: runStore(db.pool), k };
}
async function claimed() {
  const stores = await queued();
  return { ...stores, job: (await stores.jobs.claim("worker-1"))! };
}
async function result(job: ClaimedJob) {
  return createReadTools(async () => job.records).execute({ businessId: key.businessId, workspaceId: key.workspaceId, accountId: job.accountId, role: "investigator" }, tool.request);
}
async function row() { return (await db.pool.query("select * from v2_case_runs")).rows[0]; }
async function attempts() { return (await db.pool.query("select * from v2_run_attempts order by ordinal")).rows; }

test("a run pins the mock recipe, policy, record hash and limits once across worker instances", async () => {
  const { runs, job } = await claimed();
  const first = await runs.open(job.lease), repeated = await runStore(db.pool).open(job.lease);
  expect(repeated).toEqual(first);
  expect(first.snapshot).toMatchObject({ mode: "mock", version: "mock-investigation-2", policyVersion: 43, limits: { modelRequests: 12, toolCalls: 16, tokens: 24000, outputTokens: 600, seconds: 180 } });
  expect(first.snapshot.steps).toHaveLength(2);
  expect(first.snapshot.recordsHash).toMatch(/^[a-f0-9]{64}$/);
  await db.pool.query("update v2_cases set facts=jsonb_set(facts,'{accounts,0,firstName}',to_jsonb('Changed'::text))");
  await expect(runs.open(job.lease)).rejects.toThrow(/records changed/);
});

test("model reservations settle exact usage once and preserve unknown capacity", async () => {
  const { runs, job } = await claimed();
  const slot = await runs.reserveModel(job.lease, model());
  expect(slot.outputLimit).toBe(600);
  expect((await row()).charged_tokens).toBe(1000);
  await runs.settleModel(job.lease, slot.attemptId, { input: 100, output: 20 });
  await runs.settleModel(job.lease, slot.attemptId, { input: 100, output: 20 });
  expect((await row()).charged_tokens).toBe(120);
  const unknown = await runs.reserveModel(job.lease, model("review"));
  await runs.settleModel(job.lease, unknown.attemptId, null);
  expect((await row()).charged_tokens).toBe(1120);
  expect((await attempts()).map((a) => a.status)).toEqual(["succeeded", "unknown"]);
  await expect(runs.settleModel(job.lease, slot.attemptId, { input: 1, output: 1 })).rejects.toThrow(/conflict/);
});

test("competing reservations share the last daily capacity across cases and cannot overspend", async () => {
  const first = await queued("first-case"), second = await queued("second-case");
  const a = (await first.jobs.claim("worker-a"))!, b = (await second.jobs.claim("worker-b"))!;
  await db.pool.query("insert into v2_run_daily_usage(day,charged_tokens) values((clock_timestamp() at time zone 'UTC')::date,23000)");
  const reservations = await Promise.allSettled([first.runs.reserveModel(a.lease, model()), second.runs.reserveModel(b.lease, model())]);
  expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await db.pool.query("select charged_tokens::int from v2_run_daily_usage")).rows[0].charged_tokens).toBe(24000);
  expect((await db.pool.query("select sum(model_calls)::int n from v2_case_runs")).rows[0].n).toBe(1);
});

test("parallel duplicate dispatch is denied and changed operation identity is rejected", async () => {
  const { runs, job } = await claimed();
  const reservations = await Promise.allSettled([runs.reserveModel(job.lease, model()), runs.reserveModel(job.lease, model())]);
  expect(reservations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await row()).model_calls).toBe(1);
  await expect(runs.reserveModel(job.lease, { ...model(), requestHash: "b".repeat(64) })).rejects.toThrow(/conflict/);
});

test("crashed reservations remain charged and replacement leases get a separately counted attempt", async () => {
  const { runs, jobs, job } = await claimed();
  const old = await runs.reserveModel(job.lease, model());
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  const replacement = (await jobs.claim("new-worker"))!;
  await expect(runs.settleModel(job.lease, old.attemptId, { input: 1, output: 1 })).rejects.toThrow(/lease/);
  await runs.reserveModel(replacement.lease, model());
  expect((await row()).charged_tokens).toBe(2000);
  expect((await row()).model_calls).toBe(2);
  expect((await attempts()).every((a) => a.status === "reserved")).toBe(true);
});

test("checkpointed tools resume without redispatch and reject foreign evidence", async () => {
  const { runs, jobs, job } = await claimed();
  const slot = await runs.reserveTool(job.lease, tool);
  expect(slot.kind).toBe("dispatch"); if (slot.kind !== "dispatch") return;
  const output = await result(job);
  await expect(runs.settleTool(job.lease, slot.attemptId, { ...output, evidenceRefs: output.evidenceRefs.map((r) => ({ ...r, workspaceId: "foreign" })) })).rejects.toThrow(/evidence/);
  await runs.settleTool(job.lease, slot.attemptId, output);
  await runs.settleTool(job.lease, slot.attemptId, output);
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  const next = (await jobs.claim("new-worker"))!;
  expect(await runStore(db.pool).reserveTool(next.lease, tool)).toEqual({ kind: "cached", result: output });
  expect((await row()).tool_calls).toBe(1);
});

test("only one transient tool retry is allowed, with both attempts counted", async () => {
  const { runs, job } = await claimed();
  for (let n = 0; n < 2; n++) {
    const slot = await runs.reserveTool(job.lease, tool); if (slot.kind !== "dispatch") throw new Error("unexpected cache");
    await runs.settleTool(job.lease, slot.attemptId, { status: "unavailable", name: "account_history", message: "Unavailable", evidenceRefs: [] });
  }
  await expect(runs.reserveTool(job.lease, tool)).rejects.toBeInstanceOf(RunLimit);
  expect((await row()).tool_calls).toBe(2);
});

test("per-run request, tool, token and deadline limits persist a reason before any new dispatch", async () => {
  for (const [field, value, kind] of [["model_calls", 12, "model"], ["tool_calls", 16, "tool"], ["charged_tokens", 24000, "model"], ["deadline_at", "2000-01-01", "tool"]] as const) {
    await db.pool.query("truncate v2_cases,v2_run_daily_usage cascade");
    const { runs, job } = await claimed();
    await runs.open(job.lease);
    await db.pool.query(`update v2_case_runs set ${field}=$1`, [value]);
    await expect(kind === "model" ? runs.reserveModel(job.lease, model()) : runs.reserveTool(job.lease, tool)).rejects.toBeInstanceOf(RunLimit);
    expect((await row()).blocked_reason).not.toBeNull();
    expect(await attempts()).toHaveLength(0);
  }
});

test("late STOP and wrong-scope leases fence reservations and checkpoints", async () => {
  const { runs, cases, job } = await claimed();
  const slot = await runs.reserveModel(job.lease, model());
  await expect(runs.reserveModel({ ...job.lease, workspaceId: "foreign" }, model("other"))).rejects.toThrow(/lease/);
  await cases.append(visitor, key, { text: "STOP", idempotencyKey: "stop", expectedRevision: 1 });
  await expect(runs.settleModel(job.lease, slot.attemptId, { input: 1, output: 1 })).rejects.toThrow(/lease/);
  await expect(runs.reserveModel(job.lease, model("other"))).rejects.toThrow(/lease/);
  expect((await row()).charged_tokens).toBe(1000);
});

test("the default mock worker actually checkpoints its tools and pauses immediately on an exhausted run", async () => {
  await queued();
  expect(await runMockWorkerOnce(db.pool, "worker-1")).toBe("completed");
  expect((await row()).tool_calls).toBe(2);
  expect((await attempts()).map((a) => a.status)).toEqual(["succeeded", "succeeded"]);
  await db.pool.query("truncate v2_cases,v2_run_daily_usage cascade");
  const { runs, jobs, job } = await claimed();
  await runs.open(job.lease);
  await db.pool.query("update v2_case_runs set tool_calls=16");
  await jobs.fail(job.lease);
  await db.pool.query("update v2_case_jobs set available_at=clock_timestamp()-interval '1 second'");
  expect(await runMockWorkerOnce(db.pool, "worker-2")).toBe("failed");
  expect((await db.pool.query("select state from v2_cases")).rows[0].state).toBe("awaiting_human");
  expect(await attempts()).toHaveLength(0);
});
test("a UTC midnight boundary cannot detach settlement from the day that funded the reservation", async () => {
  const { job } = await claimed();
  let clock = "2000-01-01T23:59:59Z";
  const wrapped = {
    async connect() {
      const client = await db.pool.connect();
      return {
        async query(sql: string, values?: unknown[]) {
          const funding = sql.includes("insert into v2_run_daily_usage");
          if (funding || sql.includes("insert into v2_run_attempts")) sql = sql.replaceAll("clock_timestamp()", `timestamptz '${clock}'`);
          const result = await client.query(sql, values);
          if (funding) clock = "2000-01-02T00:00:01Z";
          return result;
        },
        release(broken: boolean) { client.release(broken); },
      };
    },
  } as unknown as Pool;
  const runs = runStore(wrapped), slot = await runs.reserveModel(job.lease, model());
  await runs.settleModel(job.lease, slot.attemptId, { input: 100, output: 20 });
  const funded = (await db.pool.query("select day::text,charged_tokens::int from v2_run_daily_usage")).rows[0];
  expect((await db.pool.query("select day::text from v2_run_attempts")).rows[0].day).toBe(funded.day);
  expect(funded.charged_tokens).toBe(120);
});

test("foreign-account tool input cannot obtain a dispatch reservation", async () => {
  const { runs, job } = await claimed();
  await expect(runs.reserveTool(job.lease, { ...tool, request: { ...tool.request, accountId: "account-2" } })).rejects.toThrow(/account/);
  expect(await attempts()).toHaveLength(0);
});

test("checkpoint data cannot carry a foreign business even when its evidence references are local", async () => {
  const { runs, job } = await claimed(), slot = await runs.reserveTool(job.lease, tool);
  if (slot.kind!=="dispatch") throw new Error("unexpected cache");
  const output = await result(job);
  if (output.status!=="found" || output.name!=="account_history") throw new Error("missing fixture account");
  const forged = { ...output, data: { ...output.data, account: { ...output.data.account, businessId: "subscriptions" } } };
  await expect(runs.settleTool(job.lease, slot.attemptId, forged)).rejects.toThrow(/scope/);
  expect((await attempts())[0].status).toBe("reserved");
});

test("missing funding data cannot silently refund a run or mark observed usage settled", async () => {
  const { runs, job } = await claimed(), slot = await runs.reserveModel(job.lease, model());
  await db.pool.query("delete from v2_run_daily_usage");
  await expect(runs.settleModel(job.lease, slot.attemptId, { input: 100, output: 20 })).rejects.toThrow(/funding/);
  expect((await row()).charged_tokens).toBe(1000);
  expect((await attempts())[0].status).toBe("reserved");
});

test("a tool result arriving beyond the run deadline cannot become a successful checkpoint", async () => {
  const { runs, job } = await claimed(), slot = await runs.reserveTool(job.lease, tool);
  if (slot.kind!=="dispatch") throw new Error("unexpected cache");
  await db.pool.query("update v2_case_runs set deadline_at='2000-01-01'");
  await expect(runs.settleTool(job.lease, slot.attemptId, await result(job))).rejects.toBeInstanceOf(RunLimit);
  expect((await row()).blocked_reason).toBe("deadline");
  expect((await attempts())[0].status).toBe("reserved");
});

test("observed overages are retained honestly and block later dispatch", async () => {
  const { runs, job } = await claimed();
  await db.pool.query("insert into v2_run_daily_usage(day,charged_tokens) values((clock_timestamp() at time zone 'UTC')::date,23000)");
  const slot = await runs.reserveModel(job.lease, model());
  await runs.settleModel(job.lease, slot.attemptId, { input: 1400, output: 100 });
  expect((await row()).charged_tokens).toBe(1500);
  expect((await row()).blocked_reason).toBe("reservation_overrun");
  expect((await db.pool.query("select charged_tokens::int from v2_run_daily_usage")).rows[0].charged_tokens).toBe(24500);
  await expect(runs.reserveModel(job.lease, model("next"))).rejects.toBeInstanceOf(RunLimit);
});

test("a failed attempt insert rolls back its run and daily reservation together", async () => {
  const { runs, job } = await claimed();
  await db.pool.query("alter table v2_run_attempts add constraint injected_failure check (operation_key<>'customer')");
  try { await expect(runs.reserveModel(job.lease, model())).rejects.toMatchObject({ code: "23514" }); }
  finally { await db.pool.query("alter table v2_run_attempts drop constraint injected_failure"); }
  expect(await row()).toBeUndefined();
  expect((await db.pool.query("select count(*)::int n from v2_run_daily_usage")).rows[0].n).toBe(0);
  expect(await attempts()).toHaveLength(0);
});

test("a reclaimed worker resumes the pinned recipe and does not repeat a completed tool", async () => {
  const { runs, job } = await claimed();
  const pinned = await runs.open(job.lease), step = pinned.snapshot.steps[0];
  const slot = await runs.reserveTool(job.lease, step);
  if (slot.kind!=="dispatch") throw new Error("unexpected cache");
  await runs.settleTool(job.lease, slot.attemptId, await result(job));
  await db.pool.query("update v2_case_runs set snapshot=jsonb_set(snapshot,'{summary}',to_jsonb('Pinned earlier recipe summary.'::text))");
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  expect(await runMockWorkerOnce(db.pool, "replacement-worker")).toBe("completed");
  expect((await row()).tool_calls).toBe(2);
  expect(await attempts()).toHaveLength(2);
  expect((await db.pool.query("select result from v2_case_jobs")).rows[0].result.summary).toBe("Pinned earlier recipe summary.");
});
