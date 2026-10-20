import { caseStore, jobStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { runStore } from "../../src/lib/v2/run-store";
import { runCheckpointedMock } from "../../src/lib/v2/mock-worker";
import { mockCustomerDraft } from "../../src/lib/v2/mock-workflow";
import { testSchema } from "./helpers";
import type { Pool } from "pg";
import * as toolModule from "../../src/lib/v2/tools";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => {
  db = await testSchema();
  await db.pool.query("insert into v2_visitor_sessions(session_id,token_hash,business_id,workspace_id) values('visitor-1',$1,'northside','demo')", ["a".repeat(64)]);
});
afterAll(async () => db?.drop());
beforeEach(async () => { await db.pool.query("truncate v2_cases cascade"); });
const visitor = { kind: "visitor", sessionId: "visitor-1", businessId: "northside", workspaceId: "demo" };
const key = { businessId: "northside", workspaceId: "demo", caseId: "workflow-case" };
async function claimed() {
  const cases = caseStore(db.pool), jobs = jobStore(db.pool), runs = runStore(db.pool);
  await cases.create(visitor, { ...key, accountId: "account-1" }, demoRecords());
  await cases.append(visitor, key, { text: "I already paid", idempotencyKey: "first", expectedRevision: 1 });
  return { cases, jobs, runs, job: (await jobs.claim("worker-1"))! };
}
async function messages() { return (await db.pool.query("select * from v2_agent_messages order by ordinal")).rows; }
const initial = { operationKey: "customer-request", sender: "customer", recipient: "coordinator", parentMessageId: null };
const body = () => ({ kind: "task_request", payload: { instruction: "Investigate my dispute" }, evidenceRefs: [] });

test("the durable worker pins instructions and exchanges all four roles without customer publication", async () => {
  const { job, jobs, cases, runs } = await claimed();
  const before = await runs.open(job.lease);
  expect(before.snapshot).toMatchObject({ version: "mock-workflow-1", workflow: { sourceText: "I already paid", lessonVersion: "none", instructions: { customer: { version: "customer-mock-1" }, reviewer: { version: "reviewer-mock-1" } } } });
  const result = await runCheckpointedMock(db.pool, job);
  expect(result.workflow?.decision).toBe("approve");
  expect(await jobs.complete(job.lease, result)).toBe(true);
  const rows = await messages();
  expect(rows).toHaveLength(6);
  expect(rows.map((r) => r.message.sender)).toEqual(["customer", "coordinator", "investigator", "coordinator", "customer", "reviewer"]);
  expect(rows.every((r) => r.run_id === before.runId)).toBe(true);
  expect((await cases.history(visitor, key)).messages).toHaveLength(1);
  expect((await cases.get(visitor, key)).state).toBe("awaiting_human");
  expect((await db.pool.query("select model_calls,charged_tokens,tool_calls from v2_case_runs")).rows[0]).toEqual({ model_calls: 0, charged_tokens: 0, tool_calls: 2 });
});

test("reclaimed leases reuse stored role outputs and tool results", async () => {
  const { job, jobs, runs } = await claimed();
  const old = await runCheckpointedMock(db.pool, job);
  const pinned = await runs.open(job.lease), rows = await messages();
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  const replacement = (await jobs.claim("replacement"))!;
  const draft = vi.fn(() => { throw new Error("completed role must not run again"); });
  expect(await runCheckpointedMock(db.pool, replacement, draft)).toEqual(old);
  expect(draft).not.toHaveBeenCalled();
  expect(await messages()).toEqual(rows);
  expect(await runs.open(replacement.lease)).toEqual(pinned);
  expect((await db.pool.query("select count(*)::int n from v2_run_attempts")).rows[0].n).toBe(2);
  await expect(runs.agentMessage(job.lease, initial, body)).rejects.toThrow(/lease/);
  expect(await jobs.complete(replacement.lease, old)).toBe(true);
});

test("review rejection and targeted correction are retained as separate linked messages", async () => {
  const { job } = await claimed();
  const result = await runCheckpointedMock(db.pool, job, (finding, cycle) => cycle === 0
    ? { ...mockCustomerDraft(finding), payload: { message: "Your balance is zero.", resolution: null } } : mockCustomerDraft(finding));
  expect(result.workflow?.revisionCycles).toBe(1);
  expect((await messages()).filter((r) => r.message.kind === "review_result").map((r) => r.message.payload.decision)).toEqual(["revise", "approve"]);
  expect((await db.pool.query("select tool_calls from v2_case_runs")).rows[0].tool_calls).toBe(3);
});

test("message checkpoints reject forged routes, parents and evidence before any write", async () => {
  const { job, runs } = await claimed();
  await expect(runs.agentMessage(job.lease, { ...initial, sender: "investigator" }, body)).rejects.toThrow();
  await expect(runs.agentMessage(job.lease, { ...initial, parentMessageId: "foreign-message" }, body)).rejects.toThrow(/parent/);
  await expect(runs.agentMessage(job.lease, initial, () => ({ ...body(), evidenceRefs: [{ businessId: "northside", workspaceId: "demo", accountId: "account-1", recordType: "payment", recordId: "payment-50", version: 1 }] }))).rejects.toThrow(/evidence/);
  expect(await messages()).toHaveLength(0);
  const first = await runs.agentMessage(job.lease, initial, body);
  await expect(runs.agentMessage(job.lease, { ...initial, sender: "coordinator" }, body)).rejects.toThrow();
  expect(await runs.agentMessage(job.lease, initial, () => { throw new Error("cached"); })).toEqual(first);
});

test("STOP and newer evidence fence pending role outputs", async () => {
  const { job, cases, runs } = await claimed();
  const first = await runs.agentMessage(job.lease, initial, body);
  await cases.append(visitor, key, { text: "STOP", idempotencyKey: "stop", expectedRevision: 1 });
  await expect(runs.agentMessage(job.lease, { operationKey: "next", sender: "coordinator", recipient: "investigator", parentMessageId: first.messageId }, body)).rejects.toThrow(/lease/);
  expect(await messages()).toHaveLength(1);
});

test("nested proposal evidence must have been observed by an assigned tool", async () => {
  const { job, runs } = await claimed();
  const first = await runs.agentMessage(job.lease, initial, body);
  const request = await runs.agentMessage(job.lease, { operationKey: "draft-task", sender: "coordinator", recipient: "customer", parentMessageId: first.messageId }, body);
  const scope = { businessId: key.businessId, workspaceId: key.workspaceId, accountId: job.accountId, version: 1 };
  await expect(runs.agentMessage(job.lease, { operationKey: "proposal", sender: "customer", recipient: "reviewer", parentMessageId: request.messageId }, () => ({
    kind: "proposal", evidenceRefs: [], payload: { message: "Pending action", resolution: { proposalId: "proposal-1", accountId: job.accountId, currency: "USD", policyVersion: 1, approvalRequired: true,
      actions: [{ type: "allocate_payment", paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 1000 }],
      evidenceRefs: [{ ...scope, recordType: "invoice", recordId: "invoice-1" }, { ...scope, recordType: "payment", recordId: "payment-1" }, { ...scope, recordType: "policy", recordId: "policy-1" }],
    } },
  }))).rejects.toThrow(/evidence/);
  expect(await messages()).toHaveLength(2);
});

test("a role result crossing the deadline is discarded and records the block", async () => {
  const { job, runs } = await claimed();
  await runs.open(job.lease);
  const crossing = { async connect() {
    const client = await db.pool.connect();
    return { async query(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params);
      if (sql.startsWith("select result from v2_run_attempts")) await client.query("update v2_case_runs set deadline_at=clock_timestamp()-interval '1 second'");
      return result;
    }, release(broken: boolean) { client.release(broken); } };
  } } as unknown as Pool;
  await expect(runStore(crossing).agentMessage(job.lease, initial, body)).rejects.toMatchObject({ reason: "deadline" });
  expect(await messages()).toHaveLength(0);
  expect((await db.pool.query("select blocked_reason from v2_case_runs")).rows[0].blocked_reason).toBe("deadline");
});

test("job completion must point to the actual final review checkpoint", async () => {
  const { job, jobs, cases } = await claimed();
  const result = await runCheckpointedMock(db.pool, job);
  await expect(jobs.complete(job.lease, { ...result, workflow: { ...result.workflow, finalMessageId: "foreign-message" } })).rejects.toThrow(/checkpoint/);
  expect((await cases.get(visitor, key)).state).toBe("investigating");
  expect(await jobs.complete(job.lease, result)).toBe(true);
});

test("SQL rejects an incomplete envelope rather than accepting null identity comparisons", async () => {
  const { job, runs } = await claimed();
  const run = await runs.open(job.lease);
  await expect(db.pool.query("insert into v2_agent_messages(business_id,workspace_id,case_id,case_revision,run_id,operation_key,message_id,ordinal,message) values($1,$2,$3,$4,$5,'malformed','malformed',1,'{}')", [key.businessId,key.workspaceId,key.caseId,job.lease.caseRevision,run.runId])).rejects.toMatchObject({ code: "23514" });
});

test("envelope timestamps record each role step rather than repeating run creation", async () => {
  const { job, runs } = await claimed();
  const first = await runs.agentMessage(job.lease, initial, body);
  await runs.agentMessage(job.lease, { operationKey: "next", sender: "coordinator", recipient: "investigator", parentMessageId: first.messageId }, body);
  expect(new Set((await messages()).map((r) => r.message.createdAt)).size).toBe(2);
});

test("transient tool unavailability gets one separately counted retry", async () => {
  const { job } = await claimed();
  const original = toolModule.createReadTools;
  let policyCalls = 0;
  const spy = vi.spyOn(toolModule, "createReadTools").mockImplementation((load) => {
    const tools = original(load);
    return { async execute(context, request) {
      const result = await tools.execute(context, request);
      if (result.name === "policy_lookup" && policyCalls++ === 0) return { name: "policy_lookup", status: "unavailable", message: "Injected transient failure.", evidenceRefs: [] };
      return result;
    } };
  });
  try { expect((await runCheckpointedMock(db.pool, job)).workflow?.decision).toBe("approve"); }
  finally { spy.mockRestore(); }
  expect(policyCalls).toBe(2);
  expect((await db.pool.query("select tool_calls from v2_case_runs")).rows[0].tool_calls).toBe(3);
});

test("the mock message ceiling blocks new steps and allows a human pause", async () => {
  const { job, jobs, runs, cases } = await claimed();
  let parent = await runs.agentMessage(job.lease, initial, body);
  for (let i = 1; i < 18; i++) parent = await runs.agentMessage(job.lease, { operationKey: `step-${i}`, sender: parent.recipient, recipient: parent.recipient === "coordinator" ? "customer" : "coordinator", parentMessageId: parent.messageId }, body);
  await expect(runs.agentMessage(job.lease, { operationKey: "overflow", sender: parent.recipient, recipient: "coordinator", parentMessageId: parent.messageId }, body)).rejects.toMatchObject({ reason: "agent_messages" });
  expect(await messages()).toHaveLength(18);
  expect(await jobs.pause(job.lease)).toBe("failed");
  expect((await cases.get(visitor, key)).state).toBe("awaiting_human");
});

test("persistent rejection escalates with the actual final checkpoint after two corrections", async () => {
  const { job, jobs } = await claimed();
  const result = await runCheckpointedMock(db.pool, job, (finding) => ({ ...mockCustomerDraft(finding), payload: { message: "Your balance is zero.", resolution: null } }));
  expect(result.workflow).toMatchObject({ decision: "escalate", revisionCycles: 2 });
  expect(await messages()).toHaveLength(17);
  expect(await jobs.complete(job.lease, result)).toBe(true);
});
