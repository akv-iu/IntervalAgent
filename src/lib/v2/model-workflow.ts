import type { z } from "zod";
import type { AgentMessage, ToolRequest } from "./contracts";
import { BillingContext, billingFinding, billingReview } from "./billing";
import { bodyOf, roleTaskStep, validateRoleOutput, type RoleTask } from "./role-tasks";
import type { MessageStep } from "./mock-agents";
import type { ToolResult } from "./tools";

type ToolStep={ operationKey: string;request: z.infer<typeof ToolRequest> };
type IO={ model(task: RoleTask,step: MessageStep,input: string): Promise<AgentMessage>;tool(step: ToolStep): Promise<ToolResult> };

// shortcut: one internal transport-test pass; live provenance, revision routing and job completion come later.
export async function runModelWorkflow(rawContext: unknown, sourceText: string, steps: ToolStep[], io: IO) {
  const context=BillingContext.parse(rawContext), base={ scope: context.scope,sourceText };
  const call=async(task: RoleTask,parent: AgentMessage | null,data: object)=>{
    const input=JSON.stringify({ ...base,...data });
    const message=await io.model(task,roleTaskStep(task,`model-${task}`,parent?.messageId ?? null),input);
    validateRoleOutput({ task,input },bodyOf(message));
    return message;
  };
  const first=await call("customer-request",null,{});
  const assignment=await call("investigate",first,{ parent: bodyOf(first),allowedTools: steps.map(s=>s.request) });
  if (assignment.kind!=="task_request") throw new Error("investigation task required");
  const selected=assignment.payload.toolRequests!.map((request)=>{
    const step=steps.find(s=>JSON.stringify(s.request)===JSON.stringify(request));
    if (!step) throw new Error("unassigned model tool");
    return step;
  });
  const results=await Promise.all(selected.map(io.tool));
  const finding=await call("finding",assignment,{ parent: bodyOf(assignment),results });
  const draftTask=await call("draft-task",finding,{ parent: bodyOf(finding) });
  const draft=await call("draft",draftTask,{ parent: bodyOf(draftTask),finding: bodyOf(finding) });
  const review=await call("review",draft,{ parent: bodyOf(draft),finding: bodyOf(finding),draft: bodyOf(draft) });
  if (draft.kind!=="proposal" || review.kind!=="review_result") throw new Error("proposal and review required");
  const guard=billingReview(context,results,draft,finding), fresh=billingFinding(context,results);
  const approved=review.payload.decision==="approve" && guard.payload.decision==="approve";
  return { mode: "model_test" as const,decision: approved ? "approve" as const : "escalate" as const,
    finalMessageId: review.messageId,guard: guard.payload,pendingProposal: approved ? draft.payload.resolution : null,
    projectedBalanceCents: approved ? fresh.payload.billing!.projectedBalanceCents : null };
}
