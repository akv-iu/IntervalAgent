import { caseStore, jobStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { processModelTestJob, runCheckpointedModelTest } from "../../src/lib/v2/model-test-worker";
import { runCheckpointedMock } from "../../src/lib/v2/mock-worker";
import { runStore } from "../../src/lib/v2/run-store";
import { openAITransport } from "../../src/lib/v2/openai-transport";
import { RoleTask } from "../../src/lib/v2/role-tasks";
import { scriptedRoleBody } from "../v2-role-fixture";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async()=>{
  db=await testSchema();
  for (const business of ["northside","subscriptions"]) await db.pool.query("insert into v2_visitor_sessions(session_id,token_hash,business_id,workspace_id) values($1,$2,$3,'demo')",[`visitor-${business}`,business==="northside" ? "a".repeat(64) : "b".repeat(64),business]);
});
afterAll(async()=>db?.drop());
beforeEach(async()=>{ await db.pool.query("truncate v2_cases,v2_run_daily_usage cascade"); });
async function claimed(businessId="northside") {
  const visitor={ kind: "visitor",sessionId: `visitor-${businessId}`,businessId,workspaceId: "demo" };
  const key={ businessId,workspaceId: "demo",caseId: "model-flow-case" },cases=caseStore(db.pool),jobs=jobStore(db.pool),runs=runStore(db.pool);
  await cases.create(visitor,{ ...key,accountId: "account-1" },demoRecords());
  await cases.append(visitor,key,{ text: "I already paid",idempotencyKey: "first",expectedRevision: 1 });
  return { visitor,key,cases,jobs,runs,job: (await jobs.claim("model-test-worker"))! };
}
const bodyOfRequest=(init: RequestInit | undefined)=>JSON.parse(init!.body as string) as { messages: { role: string;content: string }[] };
function fakeSDK(change?: (task: RoleTask,body: unknown)=>unknown | Promise<unknown>) {
  const fetch=vi.fn<typeof globalThis.fetch>(async(_url,init)=>{
    const wire=bodyOfRequest(init),task=RoleTask.parse(wire.messages[0].content.match(/billing-role-1\/([a-z-]+)/)?.[1]);
    const body=scriptedRoleBody(task,wire.messages[1].content);
    return Response.json({ choices: [{ finish_reason: "stop",message: { content: JSON.stringify(change ? await change(task,body) : body) } }],usage: { prompt_tokens: 80,completion_tokens: 20 } });
  });
  return { fetch,send: openAITransport("test-key",fetch) };
}
async function row(table: string) { return (await db.pool.query(`select * from ${table}`)).rows; }

test.each([["northside",1400],["subscriptions",3400]])("durable %s four-role SDK flow has explicit test provenance and cached recovery",async(business,balance)=>{
  const h=await claimed(business as string),sdk=fakeSDK();
  const result=await runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send);
  expect(result).toMatchObject({ mode: "model_test",decision: "approve",projectedBalanceCents: balance });
  expect(sdk.fetch).toHaveBeenCalledTimes(6);
  expect((await row("v2_case_runs"))[0]).toMatchObject({ model_calls: 6,tool_calls: 5,charged_tokens: 600,snapshot: { mode: "model_test",version: "model-billing-test-2",model: "test-model",rolePrompts: { review: expect.stringContaining("billing-role-1/review") } } });
  const messages=await row("v2_agent_messages");
  expect(messages).toHaveLength(6);
  expect(new Set(messages.map(r=>r.message.sender))).toEqual(new Set(["customer","coordinator","investigator","reviewer"]));
  expect((await row("v2_model_steps")).every(r=>r.completed_message_id)).toBe(true);
  expect((await h.cases.get(h.visitor,h.key)).state).toBe("investigating");
  expect((await h.cases.history(h.visitor,h.key)).messages).toHaveLength(1);
  if (business==="northside") {
    await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
    await expect(h.runs.openModelTest(h.job.lease,"test-model")).rejects.toThrow("lease");
    const next=(await h.jobs.claim("replacement"))!;
    expect(await runCheckpointedModelTest(db.pool,next,"test-model",sdk.send)).toEqual(result);
    expect(sdk.fetch).toHaveBeenCalledTimes(6);
    expect((await row("v2_case_runs"))[0]).toMatchObject({ model_calls: 6,tool_calls: 5,charged_tokens: 600 });
    await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("lease");
    h.job=next;
  }
  expect(await h.runs.completeModelTest(h.job.lease)).toEqual(result);
  expect((await row("v2_case_jobs"))[0]).toMatchObject({ state: "succeeded",result });
  expect((await h.cases.get(h.visitor,h.key)).state).toBe("awaiting_human");
  expect((await h.cases.history(h.visitor,h.key)).events.filter(e=>e.kind==="request_human")).toHaveLength(1);
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("lease");
  expect(sdk.fetch).toHaveBeenCalledTimes(6);
});

test("review feedback drives one durable revision before guarded completion",async()=>{
  const h=await claimed(); let reviews=0,investigations=0;
  const sdk=fakeSDK((task,body)=>{
    if (task==="review" && reviews++===0) return { ...(body as object),payload: { decision: "revise",summary: "Recheck the policy and pending wording.",requiredChanges: ["Recheck policy"],reinvestigate: ["policy_lookup"] } };
    if (task==="investigate" && investigations++>0) return { ...(body as object),payload: { instruction: "Recheck the requested policy",toolRequests: [{ name: "policy_lookup",accountId: "account-1" }] } };
    return body;
  });
  const outcome=await processModelTestJob(db.pool,h.job,"test-model",sdk.send);
  expect(outcome).toMatchObject({ status: "succeeded",result: { decision: "approve",revisionCycles: 1,projectedBalanceCents: 1400 } });
  expect(sdk.fetch).toHaveBeenCalledTimes(11);
  const pins=await row("v2_model_steps"),second=pins.find(p=>p.operation_key==="model-investigate-1");
  expect(JSON.parse(second.requests[0].input)).toMatchObject({ parent: { kind: "review_result",payload: { decision: "revise" } },feedback: { payload: { requiredChanges: ["Recheck policy"] } } });
  expect((await row("v2_case_jobs"))[0].result.guard.decision).toBe("approve");
  expect((await row("v2_case_runs"))[0].tool_calls).toBe(6);
});

test("persistent unsupported drafts exhaust one revision and persist guard escalation",async()=>{
  const h=await claimed(),sdk=fakeSDK((task,body)=>task==="draft" ? { ...(body as object),payload: { message: "Your payment was applied.",resolution: null } } : body);
  expect(await processModelTestJob(db.pool,h.job,"test-model",sdk.send)).toMatchObject({ status: "succeeded",result: { decision: "escalate",revisionCycles: 1,guard: { decision: "revise" },pendingProposal: null,projectedBalanceCents: null,reason: expect.stringContaining("revision limit") } });
  expect((await h.cases.get(h.visitor,h.key)).state).toBe("awaiting_human");
  expect(sdk.fetch).toHaveBeenCalledTimes(11);
});

test("completion refuses incomplete/mock checkpoints and rolls back handoff with its result",async()=>{
  const h=await claimed(),sdk=fakeSDK();
  await h.runs.open(h.job.lease);
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("model-test workflow required");
  await db.pool.query("delete from v2_case_runs");
  await h.runs.openModelTest(h.job.lease,"test-model");
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("checkpoint missing");
  await runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send);
  const pin=(await db.pool.query("select * from v2_model_steps where operation_key='model-review'")).rows[0];
  const tool=(await db.pool.query("select attempt_id from v2_run_attempts where kind='tool' limit 1")).rows[0];
  await db.pool.query("update v2_model_steps set completed_attempt_id=$1 where operation_key='model-review'",[tool.attempt_id]);
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("attempt mismatch");
  await db.pool.query("update v2_model_steps set completed_attempt_id=$1 where operation_key='model-review'",[pin.completed_attempt_id]);
  await db.pool.query("update v2_model_steps set request_hash=$1 where operation_key='model-review'",["a".repeat(64)]);
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("checkpoint mismatch");
  await db.pool.query("update v2_model_steps set request_hash=$1 where operation_key='model-review'",[pin.request_hash]);
  const root=(await db.pool.query("select * from v2_model_steps where operation_key='model-customer-request'")).rows[0];
  await h.runs.prepareModelStep(h.job.lease,{ task: "customer-request",model: "test-model",step: { ...root.step,operationKey: "extra-root" },input: root.requests[0].input });
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("extra messages");
  await db.pool.query("delete from v2_model_steps where operation_key='extra-root'");
  await db.pool.query(`create function reject_model_handoff() returns trigger language plpgsql as $$ begin raise exception 'injected handoff failure'; end $$;
    create trigger reject_model_handoff before insert on v2_case_events for each row when (new.kind='request_human') execute function reject_model_handoff()`);
  try {
    await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("injected handoff failure");
    expect((await row("v2_case_jobs"))[0]).toMatchObject({ state: "running",result: null });
    expect((await h.cases.get(h.visitor,h.key)).state).toBe("investigating");
  } finally { await db.pool.query("drop trigger reject_model_handoff on v2_case_events; drop function reject_model_handoff()"); }
  expect((await h.runs.completeModelTest(h.job.lease)).decision).toBe("approve");
});

test("unknown transport failure retries from saved output without duplicating successful calls",async()=>{
  const h=await claimed(),sdk=fakeSDK(); let fail=true;
  const send: typeof sdk.send=async(request,options)=>{
    if (request.task==="finding" && fail) { fail=false; throw new Error("injected transport failure"); }
    return sdk.send(request,options);
  };
  expect(await processModelTestJob(db.pool,h.job,"test-model",send)).toEqual({ status: "retry" });
  expect((await row("v2_case_jobs"))[0]).toMatchObject({ state: "queued",last_error: "handler_failed",result: null });
  await db.pool.query("update v2_case_jobs set available_at=clock_timestamp()-interval '1 second'");
  const next=(await h.jobs.claim("retry-worker"))!;
  expect(await processModelTestJob(db.pool,next,"test-model",send)).toMatchObject({ status: "succeeded",result: { decision: "approve" } });
  expect(sdk.fetch).toHaveBeenCalledTimes(6);
  expect((await row("v2_case_runs"))[0].model_calls).toBe(7);
  expect((await row("v2_run_attempts")).filter(a=>a.status==="unknown")).toHaveLength(1);
});

test("legacy model-test snapshots retain one-pass escalation and complete without a revision",async()=>{
  const h=await claimed();
  await h.runs.openModelTest(h.job.lease,"test-model");
  await db.pool.query(`update v2_case_runs set snapshot=jsonb_set(snapshot,'{version}','"model-billing-test-1"')`);
  const sdk=fakeSDK((task,body)=>task==="review" ? { ...(body as object),payload: { decision: "revise",summary: "Needs another check",requiredChanges: ["Recheck policy"] } } : body);
  expect(await processModelTestJob(db.pool,h.job,"test-model",sdk.send)).toMatchObject({ status: "succeeded",result: { decision: "escalate",revisionCycles: 0,pendingProposal: null } });
  expect(sdk.fetch).toHaveBeenCalledTimes(6);
});

test("a wrong role output gets one separately funded correction before continuing",async()=>{
  const h=await claimed(); let wrong=true;
  const sdk=fakeSDK((task,body)=>{
    if (task!=="finding" || !wrong) return body;
    wrong=false; return { kind: "escalation",payload: { reason: "Wrong type for assigned finding" },evidenceRefs: [] };
  });
  expect((await runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send)).decision).toBe("approve");
  expect(sdk.fetch).toHaveBeenCalledTimes(7);
  expect((await row("v2_case_runs"))[0]).toMatchObject({ model_calls: 7,charged_tokens: 700 });
  expect(await row("v2_agent_messages")).toHaveLength(6);
});

test("unassigned coordinator requests never dispatch tools",async()=>{
  const h=await claimed();
  const sdk=fakeSDK((task,body)=>task==="investigate" ? { ...(body as object),payload: { instruction: "Read another invoice",toolRequests: [{ name: "invoice_details",accountId: "account-1",invoiceId: "unassigned" }] } } : body);
  await expect(runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send)).rejects.toThrow("invalid_output");
  expect((await row("v2_case_runs"))[0]).toMatchObject({ model_calls: 3,tool_calls: 0,charged_tokens: 300 });
  expect(await row("v2_agent_messages")).toHaveLength(1);
});

test("test provenance forbids mock completion, mock messages and switching models",async()=>{
  const h=await claimed(),sdk=fakeSDK();
  await h.runs.openModelTest(h.job.lease,"test-model");
  await expect(runCheckpointedMock(db.pool,h.job)).rejects.toThrow("mock worker cannot");
  await expect(h.runs.agentMessage(h.job.lease,{ operationKey: "new-mock",sender: "customer",recipient: "coordinator",parentMessageId: null },()=>({ kind: "task_request",payload: { instruction: "mock" },evidenceRefs: [] }))).rejects.toThrow("cannot use mock messages");
  await expect(h.jobs.complete(h.job.lease,{ mode: "mock",summary: "Mislabelled model result",evidenceRefs: [],workflow: { decision: "escalate",revisionCycles: 0,finalMessageId: "test-review" } })).rejects.toThrow("cannot complete mock jobs");
  await expect(runCheckpointedModelTest(db.pool,h.job,"other-model",sdk.send)).rejects.toThrow("profile conflict");
  expect(sdk.fetch).not.toHaveBeenCalled();
});

test("STOP during a model call fences output and preserves its unknown reservation",async()=>{
  const h=await claimed();
  const sdk=fakeSDK(async(task,body)=>{
    if (task==="finding") await h.cases.append(h.visitor,h.key,{ text: "STOP",idempotencyKey: "stop",expectedRevision: 2 });
    return body;
  });
  await expect(runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send)).rejects.toThrow(/lease/);
  expect(sdk.fetch).toHaveBeenCalledTimes(3);
  const attempts=await row("v2_run_attempts");
  expect(attempts.filter(a=>a.kind==="model" && a.status==="reserved")).toHaveLength(1);
  expect((await h.cases.get(h.visitor,h.key)).contactSuppressed).toBe(true);
  expect(await row("v2_agent_messages")).toHaveLength(2);
  expect(await processModelTestJob(db.pool,h.job,"test-model",sdk.send)).toEqual({ status: "stale" });
  await expect(h.runs.completeModelTest(h.job.lease)).rejects.toThrow("lease");
  expect((await row("v2_case_jobs"))[0]).toMatchObject({ state: "cancelled",result: null });
  expect(sdk.fetch).toHaveBeenCalledTimes(3);
});

test("exhausted model budget blocks the complete flow before SDK dispatch",async()=>{
  const h=await claimed(),sdk=fakeSDK();
  await h.runs.openModelTest(h.job.lease,"test-model");
  await db.pool.query("update v2_case_runs set model_calls=12");
  await expect(runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send)).rejects.toThrow("model_requests");
  expect(sdk.fetch).not.toHaveBeenCalled();
  expect((await row("v2_case_runs"))[0].blocked_reason).toBe("model_requests");
  expect(await processModelTestJob(db.pool,h.job,"test-model",sdk.send)).toEqual({ status: "failed" });
  expect((await row("v2_case_jobs"))[0]).toMatchObject({ state: "failed",last_error: "resource_limit",result: null });
  expect((await h.cases.get(h.visitor,h.key)).state).toBe("awaiting_human");
  expect(sdk.fetch).not.toHaveBeenCalled();
});
