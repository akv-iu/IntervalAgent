import { caseStore, jobStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { runCheckpointedModelTest } from "../../src/lib/v2/model-test-worker";
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
  expect((await row("v2_case_runs"))[0]).toMatchObject({ model_calls: 6,tool_calls: 5,charged_tokens: 600,snapshot: { mode: "model_test",version: "model-billing-test-1",model: "test-model",rolePrompts: { review: expect.stringContaining("billing-role-1/review") } } });
  const messages=await row("v2_agent_messages");
  expect(messages).toHaveLength(6);
  expect(new Set(messages.map(r=>r.message.sender))).toEqual(new Set(["customer","coordinator","investigator","reviewer"]));
  expect((await row("v2_model_steps")).every(r=>r.completed_message_id)).toBe(true);
  expect((await h.cases.get(h.visitor,h.key)).state).toBe("investigating");
  expect((await h.cases.history(h.visitor,h.key)).messages).toHaveLength(1);
  if (business==="northside") {
    await db.pool.query("update v2_case_jobs set lease_until=clock_timestamp()-interval '1 second'");
    const next=(await h.jobs.claim("replacement"))!;
    expect(await runCheckpointedModelTest(db.pool,next,"test-model",sdk.send)).toEqual(result);
    expect(sdk.fetch).toHaveBeenCalledTimes(6);
    expect((await row("v2_case_runs"))[0]).toMatchObject({ model_calls: 6,tool_calls: 5,charged_tokens: 600 });
  }
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
});

test("exhausted model budget blocks the complete flow before SDK dispatch",async()=>{
  const h=await claimed(),sdk=fakeSDK();
  await h.runs.openModelTest(h.job.lease,"test-model");
  await db.pool.query("update v2_case_runs set model_calls=12");
  await expect(runCheckpointedModelTest(db.pool,h.job,"test-model",sdk.send)).rejects.toThrow("model_requests");
  expect(sdk.fetch).not.toHaveBeenCalled();
  expect((await row("v2_case_runs"))[0].blocked_reason).toBe("model_requests");
});
