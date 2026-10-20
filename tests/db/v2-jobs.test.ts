import type { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { migrate } from "../../src/lib/db-admin";
import { caseStore, jobStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { mockInvestigation, runMockWorkerOnce, runMockWorker } from "../../src/lib/v2/mock-worker";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => { db = await testSchema(); });
afterAll(async () => db?.drop());
beforeEach(async () => { await db.pool.query("truncate v2_cases cascade"); });
const visitor = { kind: "visitor", sessionId: "visitor-1", businessId: "northside", workspaceId: "demo" };
const operator = { kind: "operator", operatorId: "operator-1", businessIds: ["northside"] };
const key = { businessId: "northside", workspaceId: "demo", caseId: "jobs-case" };
const message = (text = "I already paid", idempotencyKey = "message-1", expectedRevision = 1) => ({ text, idempotencyKey, expectedRevision });
async function queued() {
  const cases = caseStore(db.pool), jobs = jobStore(db.pool);
  await cases.create(visitor, { ...key, accountId: "account-1" }, demoRecords());
  await cases.append(visitor, key, message());
  return { cases, jobs };
}
async function rows() { return (await db.pool.query("select * from v2_case_jobs order by case_revision")).rows; }
async function claim() { const job = await jobStore(db.pool).claim("worker-1"); expect(job).not.toBeNull(); return job!; }
async function expire() { await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second' where state='running'"); }
async function ready() { await db.pool.query("update v2_case_jobs set available_at=clock_timestamp()-interval '1 second' where state='queued'"); }

test("accepted messages queue one durable job and retries do not queue duplicates", async () => {
  const { cases } = await queued();
  await cases.append(visitor, key, message());
  expect(await rows()).toMatchObject([{ state: "queued", attempts: 0, case_revision: "2" }]);
});

test("enqueue failure rolls back case, audit and message together", async () => {
  const cases = caseStore(db.pool);
  await cases.create(visitor, { ...key, accountId: "account-1" }, demoRecords());
  await db.pool.query("alter table v2_case_jobs add constraint injected_failure check (case_id <> 'jobs-case')");
  try { await expect(cases.append(visitor, key, message())).rejects.toThrow(); }
  finally { await db.pool.query("alter table v2_case_jobs drop constraint injected_failure"); }
  expect((await cases.get(visitor, key)).revision).toBe(1);
  expect((await cases.history(visitor, key)).events).toHaveLength(1);
  expect((await cases.history(visitor, key)).messages).toHaveLength(0);
  expect(await rows()).toHaveLength(0);
});

test("two workers cannot claim or commit the same step twice", async () => {
  const { cases, jobs } = await queued();
  const claims = await Promise.all([jobs.claim("worker-1"), jobs.claim("worker-2")]);
  const accepted = claims.filter((j) => j !== null);
  expect(accepted).toHaveLength(1);
  const job = accepted[0]!, result = await mockInvestigation(job);
  expect(await jobs.complete(job.lease, result)).toBe(true);
  expect(await jobs.complete(job.lease, result)).toBe(false);
  expect((await cases.get(visitor, key))).toMatchObject({ state: "awaiting_human", revision: 3 });
  expect((await cases.history(visitor, key)).events[2]).toMatchObject({ actor: "system", actorId: job.lease.workerId, kind: "request_human" });
  expect(await rows()).toMatchObject([{ state: "succeeded", attempts: 1, result: { mode: "mock" } }]);
});

test("restart reclaims expired work with a new token and rejects the old result", async () => {
  const { jobs } = await queued();
  const old = await claim();
  await expire();
  const restarted = (await jobStore(db.pool).claim("restarted-worker"))!;
  expect(restarted.lease.token).not.toBe(old.lease.token);
  expect(await jobs.complete(old.lease, await mockInvestigation(old))).toBe(false);
  expect(await jobs.complete(restarted.lease, await mockInvestigation(restarted))).toBe(true);
  expect(await rows()).toMatchObject([{ state: "succeeded", attempts: 2 }]);
});

test("STOP cancels leased work and prevents stale completion", async () => {
  const { cases, jobs } = await queued();
  const job = await claim();
  await cases.append(visitor, key, message("STOP", "stop", 1));
  expect(await jobs.complete(job.lease, await mockInvestigation(job))).toBe(false);
  expect(await jobs.claim("another-worker")).toBeNull();
  expect(await rows()).toMatchObject([{ state: "cancelled", result: null }]);
  expect(await cases.get(visitor, key)).toMatchObject({ state: "closed", contactSuppressed: true });
  expect((await cases.history(visitor, key)).events.map((e) => e.kind)).toEqual(["created", "customer_message", "stop_contact"]);
});

test("new evidence cancels the old job and queues only the current revision", async () => {
  const { cases, jobs } = await queued();
  const old = await claim();
  await cases.append(visitor, key, message("Here is the receipt", "receipt", 2));
  expect(await jobs.complete(old.lease, await mockInvestigation(old))).toBe(false);
  expect(await rows()).toMatchObject([{ state: "cancelled", case_revision: "2" }, { state: "queued", case_revision: "3" }]);
  expect((await jobs.claim("worker-2"))!.lease.caseRevision).toBe(3);
});

test("operator transitions invalidate queued work", async () => {
  const { cases, jobs } = await queued();
  await cases.transition(operator, key, { type: "close", reason: "Operator closed case", expectedRevision: 2 });
  expect(await jobs.claim("worker-1")).toBeNull();
  expect(await rows()).toMatchObject([{ state: "cancelled" }]);
});

test("failures back off and stop after three attempts with a recoverable case", async () => {
  const { cases, jobs } = await queued();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await claim();
    expect(await jobs.fail(job.lease)).toBe(attempt < 3 ? "retry" : "failed");
    expect(await jobs.claim("too-soon")).toBeNull();
    if (attempt < 3) await ready();
  }
  expect(await rows()).toMatchObject([{ state: "failed", attempts: 3, last_error: "handler_failed", result: null }]);
  expect(await cases.get(visitor, key)).toMatchObject({ state: "awaiting_human", revision: 3 });
});

test("expiry of the final attempt escalates rather than running forever", async () => {
  const { cases, jobs } = await queued();
  for (let attempt = 1; attempt <= 3; attempt++) { await claim(); await expire(); }
  expect(await jobs.claim("worker-4")).toBeNull();
  expect(await rows()).toMatchObject([{ state: "failed", attempts: 3, last_error: "lease_expired" }]);
  expect((await cases.get(visitor, key)).state).toBe("awaiting_human");
});

test("mock worker processes persisted work through scoped tools without publishing chat", async () => {
  const { cases } = await queued();
  expect(await runMockWorkerOnce(db.pool, "worker-1")).toBe("completed");
  expect(await runMockWorkerOnce(db.pool, "worker-1")).toBe("idle");
  const [job] = await rows();
  expect(job.result).toMatchObject({ mode: "mock", evidenceRefs: expect.arrayContaining([expect.objectContaining({ recordType: "policy" }), expect.objectContaining({ recordType: "account" })]) });
  expect(job.result.evidenceRefs.every((ref: { businessId: string; accountId: string }) => ref.businessId === "northside" && ref.accountId === "account-1")).toBe(true);
  expect((await cases.history(visitor, key)).messages).toHaveLength(1);
});

test("wrong scope or ownership cannot complete a leased job", async () => {
  const { jobs } = await queued();
  const job = await claim(), result = await mockInvestigation(job);
  expect(await jobs.complete({ ...job.lease, workerId: "imposter" }, result)).toBe(false);
  expect(await jobs.complete({ ...job.lease, workspaceId: "other" }, result)).toBe(false);
  expect(await jobs.claim("impatient-worker")).toBeNull();
  expect(await jobs.complete(job.lease, result)).toBe(true);
});

test("completion audit failure rolls back job result and case progress", async () => {
  const { cases, jobs } = await queued();
  const job = await claim();
  await db.pool.query("alter table v2_case_events add constraint reject_completion check (kind <> 'request_human')");
  try { await expect(jobs.complete(job.lease, await mockInvestigation(job))).rejects.toThrow(); }
  finally { await db.pool.query("alter table v2_case_events drop constraint reject_completion"); }
  expect(await rows()).toMatchObject([{ state: "running", result: null }]);
  expect((await cases.get(visitor, key)).revision).toBe(2);
});

test("handler failures persist a sanitized retry reason", async () => {
  await queued();
  expect(await runMockWorkerOnce(db.pool, "worker-1", async () => { throw new Error("PRIVATE ERROR MUST NOT BE STORED"); })).toBe("retry");
  expect(await rows()).toMatchObject([{ state: "queued", last_error: "handler_failed", result: null }]);
});

test("graceful shutdown finishes the claimed step before ending the loop", async () => {
  const { cases } = await queued();
  const controller = new AbortController();
  await runMockWorker(db.pool, "worker-1", controller.signal, async (job) => { controller.abort(); return mockInvestigation(job); });
  expect((await cases.get(visitor, key)).state).toBe("awaiting_human");
  expect(await rows()).toMatchObject([{ state: "succeeded" }]);
});

test("claim rechecks eligibility when its candidate snapshot has become stale", async () => {
  await queued();
  const token = "00000000-0000-4000-8000-000000000001";
  // Inject the competing commit after candidate selection, using the real PostgreSQL job row.
  const interleavedPool = {
    async connect() {
      const client = await db.pool.connect();
      return {
        async query(sql: string, params?: unknown[]) {
          const result = await client.query(sql, params);
          if (sql.startsWith("select c.*,j.case_revision")) await db.pool.query("update v2_case_jobs set state='running',attempts=1,worker_id='other-worker',lease_token=$1,lease_until=clock_timestamp()+interval '60 seconds'", [token]);
          return result;
        },
        release(broken: boolean) { client.release(broken); },
      };
    },
  } as unknown as Pool;
  expect(await jobStore(interleavedPool).claim("late-worker")).toBeNull();
  expect(await rows()).toMatchObject([{ state: "running", worker_id: "other-worker", lease_token: token, attempts: 1 }]);
});

test("discarding an old candidate preserves the newer queued revision", async () => {
  const { cases, jobs } = await queued();
  await cases.append(visitor, key, message("New evidence", "new", 2));
  await db.pool.query("update v2_case_jobs set state='queued',finished_at=null,available_at='2000-01-01' where case_revision=2");
  expect(await jobs.claim("worker-1")).toBeNull();
  expect(await rows()).toMatchObject([{ state: "cancelled", case_revision: "2" }, { state: "queued", case_revision: "3" }]);
  expect((await jobs.claim("worker-1"))!.lease.caseRevision).toBe(3);
});

test("migration backfills only eligible Phase 4 messages and is repeatable", async () => {
  const { cases } = await queued();
  const closed = { ...key, caseId: "already-closed" };
  await cases.create(visitor, { ...closed, accountId: "account-1" }, demoRecords());
  await cases.append(visitor, closed, message("STOP"));
  await db.pool.query("drop table v2_case_jobs");
  await db.pool.query("delete from schema_migrations where name='006_v2_jobs.sql'");
  expect(await migrate(db.pool)).toEqual(["006_v2_jobs.sql"]);
  expect(await migrate(db.pool)).toEqual([]);
  expect(await rows()).toMatchObject([{ case_id: "jobs-case", case_revision: "2", state: "queued" }]);
  expect((await cases.history(visitor, closed)).messages[0].text).toBe("STOP");
});

test("a real worker process restart recovers an abandoned lease and commits once", async () => {
  const { cases } = await queued();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${db.schema}`);
  const env = { ...process.env, V2_WORKER_DATABASE_URL: url.toString(), V2_WORKER_ID: "process-worker" };
  const run = promisify(execFile);
  // Exit without cleanup immediately after a persisted claim, as a crashed worker would.
  await run(process.execPath, ["--import", "tsx", "-e", "const {Pool}=require('pg');const {jobStore}=require('./src/lib/v2/case-store.ts');const p=new Pool({connectionString:process.env.V2_WORKER_DATABASE_URL});jobStore(p).claim('crashed-worker').then(j=>process.exit(j?0:2)).catch(()=>process.exit(3));"], { env, windowsHide: true, timeout: 30_000 });
  expect(await rows()).toMatchObject([{ state: "running", attempts: 1 }]);
  await expire();
  const restarted = await run(process.execPath, ["--import", "tsx", "scripts/v2-mock-worker.ts", "--once"], { env, windowsHide: true, timeout: 30_000 });
  expect(restarted.stdout.trim()).toBe("completed");
  expect(await rows()).toMatchObject([{ state: "succeeded", attempts: 2, worker_id: "process-worker" }]);
  expect((await cases.history(visitor, key)).events.filter((e) => e.kind === "request_human")).toHaveLength(1);
});

test("expired leases and unverifiable results cannot advance case progress", async () => {
  const { cases, jobs } = await queued();
  const job = await claim(), result = await mockInvestigation(job);
  const ref = result.evidenceRefs[0];
  for (const invalid of [{ ...ref, businessId: "other" }, { ...ref, version: ref.version + 1 }, { ...ref, recordId: "missing" }]) {
    await expect(jobs.complete(job.lease, { ...result, evidenceRefs: [invalid] })).rejects.toThrow(/evidence/);
  }
  await expire();
  expect(await jobs.complete(job.lease, result)).toBe(false);
  expect(await jobs.fail(job.lease)).toBe("stale");
  expect((await cases.get(visitor, key)).revision).toBe(2);
});

test("the dedicated worker grants support processing without V1 access or facts/message edits", async () => {
  await queued();
  const role = `vw_${db.schema.slice(5)}`;
  const sql = readFileSync("db/ops/v2_worker_role.sql", "utf8").split("\n").filter((line) => !line.startsWith("create role")).join("\n").replaceAll("recovery_v2_worker", role).replace("schema public", `schema ${db.schema}`);
  const c = await db.pool.connect();
  try {
    await c.query(`create role ${role} nologin`);
    await c.query(`grant ${role} to current_user`);
    await c.query(sql);
    await c.query(`set role ${role}`);
    const restricted = { connect: async () => ({ query: c.query.bind(c), release() {} }) } as unknown as Pool;
    expect(await runMockWorkerOnce(restricted, "restricted-worker")).toBe("completed");
    for (const forbidden of ["select * from accounts", "update v2_cases set facts='{}'", "insert into v2_case_jobs (business_id) values ('other')", "insert into v2_case_messages (business_id) values ('other')", "delete from v2_cases"]) {
      await expect(c.query(forbidden)).rejects.toMatchObject({ code: "42501" });
    }
  } finally {
    await c.query("reset role"); await c.query(`drop owned by ${role}`); await c.query(`drop role ${role}`); c.release();
  }
});
