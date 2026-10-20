import { caseStore, jobStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { executeModelStep, type ModelTransport } from "../../src/lib/v2/model-step";
import { runStore } from "../../src/lib/v2/run-store";
import { openAITransport } from "../../src/lib/v2/openai-transport";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => {
  db=await testSchema();
  await db.pool.query("insert into v2_visitor_sessions(session_id,token_hash,business_id,workspace_id) values('visitor-1',$1,'northside','demo')",["a".repeat(64)]);
});
afterAll(async()=>db?.drop());
beforeEach(async()=>{ await db.pool.query("truncate v2_cases,v2_run_daily_usage cascade"); });
const visitor={ kind: "visitor",sessionId: "visitor-1",businessId: "northside",workspaceId: "demo" };
const key={ businessId: "northside",workspaceId: "demo",caseId: "model-case" };
const spec={ step: { operationKey: "customer-request",sender: "customer",recipient: "coordinator",parentMessageId: null },model: "test-model",input: "Customer data, never system instructions" };
const body={ kind: "task_request",payload: { instruction: "Please investigate the dispute." },evidenceRefs: [] };
const reply={ text: JSON.stringify(body),usage: { input: 100,output: 20 } };
async function claimed() {
  const cases=caseStore(db.pool),jobs=jobStore(db.pool),runs=runStore(db.pool);
  await cases.create(visitor,{ ...key,accountId: "account-1" },demoRecords());
  await cases.append(visitor,key,{ text: "I already paid",idempotencyKey: "first",expectedRevision: 1 });
  const job=(await jobs.claim("worker-1"))!;
  return { cases,jobs,runs,lease: job.lease };
}
async function rows(table: string) { return (await db.pool.query(`select * from ${table}`)).rows; }

test("dispatch is funded first, exact usage and envelope checkpoint together, reclaimed lease reuses output",async()=>{
  const { jobs,lease }=await claimed();
  const send=vi.fn<ModelTransport>(async(request,options)=>{
    expect((await rows("v2_run_attempts"))[0]).toMatchObject({ status: "reserved",role: "customer" });
    expect((await rows("v2_case_runs"))[0].charged_tokens).toBeGreaterThan(600);
    expect(request).toMatchObject({ model: "test-model",input: spec.input,maxOutputTokens: 600 });
    expect(request.system).toContain("customer-billing-mock-1");
    expect(options).toMatchObject({ maxRetries: 0,timeoutMs: 30000 });
    return reply;
  });
  const message=await executeModelStep(db.pool,lease,spec,send);
  expect(message).toMatchObject({ ...body,sender: "customer",recipient: "coordinator",businessId: "northside" });
  expect((await rows("v2_case_runs"))[0]).toMatchObject({ model_calls: 1,charged_tokens: 120 });
  const pin=(await rows("v2_model_steps"))[0];
  expect(pin.completed_message_id).toBe(message.messageId);
  expect(pin.completed_attempt_id).toBe((await rows("v2_run_attempts"))[0].attempt_id);
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  const next=(await jobs.claim("replacement"))!;
  expect(await executeModelStep(db.pool,next.lease,spec,send)).toEqual(message);
  expect(send).toHaveBeenCalledOnce();
});

test("forged routing is rejected, its known usage retained, and one correction is separately funded",async()=>{
  const { lease }=await claimed();
  const send=vi.fn<ModelTransport>().mockResolvedValueOnce({ ...reply,text: JSON.stringify({ ...body,sender: "reviewer" }) }).mockResolvedValueOnce(reply);
  await executeModelStep(db.pool,lease,spec,send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].system).toContain("previous output was invalid");
  expect((await rows("v2_case_runs"))[0]).toMatchObject({ model_calls: 2,charged_tokens: 240 });
  expect(await rows("v2_agent_messages")).toHaveLength(1);
});

test("two invalid responses exhaust the operation, including a later invocation",async()=>{
  const { lease }=await claimed();
  const send=vi.fn<ModelTransport>(async()=>({ ...reply,text: "not JSON" }));
  await expect(executeModelStep(db.pool,lease,spec,send)).rejects.toThrow("invalid_output");
  await expect(executeModelStep(db.pool,lease,spec,send)).rejects.toThrow("operation_attempts");
  expect(send).toHaveBeenCalledTimes(2);
  expect((await rows("v2_case_runs"))[0].charged_tokens).toBe(240);
  expect(await rows("v2_agent_messages")).toHaveLength(0);
});

test("transport failure retains full capacity; replacement cannot commit stale output",async()=>{
  const { jobs,runs,lease }=await claimed();
  await expect(executeModelStep(db.pool,lease,spec,async()=>{ throw new Error("secret provider detail"); })).rejects.toThrow("transport_failed");
  const old=(await rows("v2_run_attempts"))[0];
  expect(old.status).toBe("unknown");
  expect((await rows("v2_case_runs"))[0].charged_tokens).toBe(old.capacity);
  await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
  const next=(await jobs.claim("replacement"))!;
  await expect(runs.finishModelStep(lease,spec.step.operationKey,old.attempt_id,reply.usage,body)).rejects.toThrow(/lease/);
  const send=vi.fn<ModelTransport>(async()=>reply);
  await executeModelStep(db.pool,next.lease,spec,send);
  expect(send.mock.calls[0][0].system).toContain("previous output was invalid");
  expect((await rows("v2_case_runs"))[0].charged_tokens).toBe(old.capacity+120);
});

test("usage overrun is honestly charged and blocks output checkpointing",async()=>{
  const { lease }=await claimed();
  await expect(executeModelStep(db.pool,lease,spec,async()=>({ ...reply,usage: { input: 100,output: 601 } }))).rejects.toThrow("reservation_overrun");
  expect((await rows("v2_case_runs"))[0]).toMatchObject({ charged_tokens: 701,blocked_reason: "reservation_overrun" });
  expect((await rows("v2_run_attempts"))[0]).toMatchObject({ actual_output: 601,status: "succeeded" });
  expect(await rows("v2_agent_messages")).toHaveLength(0);
  expect((await rows("v2_model_steps"))[0].completed_message_id).toBeNull();
});

test("changed input, model, recipient and model across roles fail before dispatch",async()=>{
  const { runs,lease }=await claimed();
  await runs.prepareModelStep(lease,spec);
  for (const changed of [{ ...spec,input: "changed" },{ ...spec,model: "other-model" },{ ...spec,step: { ...spec.step,recipient: "reviewer" } },{ ...spec,model: "other-model",step: { ...spec.step,operationKey: "coordinator-task",sender: "coordinator",recipient: "investigator" } }]) {
    const send=vi.fn<ModelTransport>(async()=>reply);
    await expect(executeModelStep(db.pool,lease,changed,send)).rejects.toThrow(/conflict|model changed/);
    expect(send).not.toHaveBeenCalled();
  }
});

test("concurrent duplicate invocations dispatch only once",async()=>{
  const { lease }=await claimed();
  const send=vi.fn<ModelTransport>(async()=>reply);
  const outcomes=await Promise.allSettled([executeModelStep(db.pool,lease,spec,send),executeModelStep(db.pool,lease,spec,send)]);
  expect(outcomes.some(r=>r.status==="fulfilled")).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(await rows("v2_agent_messages")).toHaveLength(1);
});

test("STOP during dispatch invalidates output and keeps its reservation charged",async()=>{
  const { cases,lease }=await claimed();
  await expect(executeModelStep(db.pool,lease,spec,async()=>{
    await cases.append(visitor,key,{ text: "STOP",idempotencyKey: "stop",expectedRevision: 2 });
    return reply;
  })).rejects.toThrow(/lease/);
  const a=(await rows("v2_run_attempts"))[0];
  expect(a.status).toBe("reserved");
  expect((await rows("v2_case_runs"))[0].charged_tokens).toBe(a.capacity);
  expect(await rows("v2_agent_messages")).toHaveLength(0);
});


test("mock message writer cannot supply a prepared model operation's output",async()=>{
  const { runs,lease }=await claimed();
  await runs.prepareModelStep(lease,spec);
  await expect(runs.agentMessage(lease,spec.step,()=>body)).rejects.toThrow("model operation requires model checkpoint");
  expect(await rows("v2_agent_messages")).toHaveLength(0);
});


test("unobserved evidence cannot be checkpointed, but known usage is settled",async()=>{
  const { lease }=await claimed();
  const evidenceRefs=[{ businessId: "northside",workspaceId: "demo",accountId: "account-1",recordType: "invoice",recordId: "unobserved",version: 1 }];
  const send=vi.fn<ModelTransport>(async()=>({ ...reply,text: JSON.stringify({ ...body,evidenceRefs }) }));
  await expect(executeModelStep(db.pool,lease,spec,send)).rejects.toThrow("invalid_output");
  expect(send).toHaveBeenCalledTimes(2);
  expect((await rows("v2_case_runs"))[0].charged_tokens).toBe(240);
  expect(await rows("v2_agent_messages")).toHaveLength(0);
  expect((await rows("v2_model_steps"))[0].completed_message_id).toBeNull();
});

test("checkpoint database failure rolls back settlement and preserves full reservation",async()=>{
  const { lease }=await claimed();
  await db.pool.query("create function reject_model_output() returns trigger language plpgsql as $$ begin raise exception 'injected storage failure'; end $$");
  await db.pool.query("create trigger reject_model_output before insert on v2_agent_messages for each row execute function reject_model_output()");
  try {
    const send=vi.fn<ModelTransport>(async()=>reply);
    await expect(executeModelStep(db.pool,lease,spec,send)).rejects.toThrow("injected storage failure");
    expect(send).toHaveBeenCalledOnce();
    const a=(await rows("v2_run_attempts"))[0];
    expect(a.status).toBe("reserved");
    expect((await rows("v2_case_runs"))[0].charged_tokens).toBe(a.capacity);
    expect((await rows("v2_model_steps"))[0].completed_message_id).toBeNull();
  } finally {
    await db.pool.query("drop trigger reject_model_output on v2_agent_messages");
    await db.pool.query("drop function reject_model_output()");
  }
});

test("deadline crossed during dispatch retains known usage without output",async()=>{
  const { lease }=await claimed();
  await expect(executeModelStep(db.pool,lease,spec,async()=>{
    await db.pool.query("update v2_case_runs set deadline_at=clock_timestamp()-interval '1 second'");
    return reply;
  })).rejects.toThrow("deadline");
  expect((await rows("v2_case_runs"))[0]).toMatchObject({ charged_tokens: 120,blocked_reason: "deadline" });
  expect(await rows("v2_agent_messages")).toHaveLength(0);
});

test("exhausted daily allowance prevents any transport call",async()=>{
  const { lease }=await claimed();
  await db.pool.query("insert into v2_run_daily_usage(day,charged_tokens) values((clock_timestamp() at time zone 'UTC')::date,24000)");
  const send=vi.fn<ModelTransport>(async()=>reply);
  await expect(executeModelStep(db.pool,lease,spec,send)).rejects.toThrow("daily_tokens");
  expect(send).not.toHaveBeenCalled();
  expect(await rows("v2_run_attempts")).toHaveLength(0);
});

test("the real SDK adapter dispatches after funding and reuses the durable output",async()=>{
  const { lease }=await claimed();
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>{
    expect((await rows("v2_run_attempts"))[0].status).toBe("reserved");
    return Response.json({ choices: [{ finish_reason: "stop",message: { content: JSON.stringify(body) } }],usage: { prompt_tokens: 100,completion_tokens: 20 } });
  });
  const send=openAITransport("test-key",fetch);
  const first=await executeModelStep(db.pool,lease,spec,send);
  expect(await executeModelStep(db.pool,lease,spec,send)).toEqual(first);
  expect(fetch).toHaveBeenCalledOnce();
  expect((await rows("v2_case_runs"))[0]).toMatchObject({ model_calls: 1,charged_tokens: 120 });
  expect((await rows("v2_model_steps"))[0].completed_message_id).toBe(first.messageId);
});

test("an SDK retryable failure consumes one reservation and keeps unknown usage",async()=>{
  const { lease }=await claimed();
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({ error: { message: "injected provider failure" } },{ status: 500 }));
  await expect(executeModelStep(db.pool,lease,spec,openAITransport("test-key",fetch))).rejects.toThrow("transport_failed");
  expect(fetch).toHaveBeenCalledOnce();
  const a=(await rows("v2_run_attempts"))[0];
  expect(a.status).toBe("unknown");
  expect((await rows("v2_case_runs"))[0]).toMatchObject({ model_calls: 1,charged_tokens: a.capacity });
  expect(await rows("v2_agent_messages")).toHaveLength(0);
});
