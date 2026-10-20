import { billingRecipe } from "../src/lib/v2/billing";
import { demoRecords } from "../src/lib/v2/demo-records";
import { makeAgentMessage, type MessageStep } from "../src/lib/v2/mock-agents";
import { runModelWorkflow } from "../src/lib/v2/model-workflow";
import { parseRoleInput, roleInstruction, validateRoleOutput, type RoleTask } from "../src/lib/v2/role-tasks";
import { createReadTools } from "../src/lib/v2/tools";
import { scriptedRoleBody } from "./v2-role-fixture";

function harness(businessId="northside",change?: (task: RoleTask,body: unknown)=>unknown) {
  const data=demoRecords(), scope={ businessId,workspaceId: "demo",accountId: "account-1" };
  const recipe=billingRecipe(data,scope), tools=createReadTools(async()=>data);
  const requests: string[]=[], tasks: RoleTask[]=[], inputs: string[]=[];
  return { recipe,requests,tasks,inputs,io: {
    async model(task: RoleTask,step: MessageStep,input: string) {
      tasks.push(task); inputs.push(input); roleInstruction(task,step); parseRoleInput(task,input);
      const body=change?.(task,scriptedRoleBody(task,input)) ?? scriptedRoleBody(task,input);
      validateRoleOutput({ task,input },body);
      return makeAgentMessage({ ...scope,caseId: "test-case",runId: "test-run",createdAt: "2026-10-20T00:00:00.000Z" },step,body);
    },
    async tool(step: (typeof recipe.steps)[number]) { requests.push(step.request.name); return tools.execute({ ...scope,role: "investigator" },step.request); },
  } };
}

test.each([["northside",1400],["subscriptions",3400]])("all four transport roles produce the pending %s result",async(business,balance)=>{
  const h=harness(business as string);
  const result=await runModelWorkflow(h.recipe.context,"I already paid",h.recipe.steps,h.io);
  expect(h.tasks).toEqual(["customer-request","investigate","finding","draft-task","draft","review"]);
  expect(result).toMatchObject({ mode: "model_test",decision: "approve",projectedBalanceCents: balance });
  expect(h.requests).toHaveLength(5);
  expect(h.inputs.every(input=>input.length<=8000 && !input.includes("test-run") && !input.includes("createdAt"))).toBe(true);
});

test("the coordinator's selected tools drive dispatch; missing evidence cannot be approved",async()=>{
  const h=harness("northside",(task,raw)=>{
    if (task!=="investigate") return raw;
    const body=raw as { payload: { toolRequests: { name: string }[] } };
    return { ...body,payload: { ...body.payload,toolRequests: body.payload.toolRequests.filter(r=>r.name==="policy_lookup") } };
  });
  const result=await runModelWorkflow(h.recipe.context,"I already paid",h.recipe.steps,h.io);
  expect(h.requests).toEqual(["policy_lookup"]); expect(result.decision).toBe("escalate");
  expect(result.pendingProposal).toBeNull();
});

test("a model reviewer approval cannot override the deterministic pending-wording guard",async()=>{
  const h=harness("northside",(task,raw)=> task==="draft" ? { ...(raw as object),payload: { message: "Your balance is zero and payment applied.",resolution: null } } : raw);
  expect((await runModelWorkflow(h.recipe.context,"I already paid",h.recipe.steps,h.io)).decision).toBe("escalate");
});
