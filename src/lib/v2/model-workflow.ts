import type { z } from "zod";
import type { AgentMessage, ToolRequest } from "./contracts";
import { BillingContext, billingFinding, billingReview } from "./billing";
import { bodyOf, roleTaskStep, validateRoleOutput, type RoleTask } from "./role-tasks";
import type { MessageStep } from "./mock-agents";
import type { ToolResult } from "./tools";

type ToolStep={ operationKey: string;request: z.infer<typeof ToolRequest> };
type IO={ model(task: RoleTask,step: MessageStep,input: string): Promise<AgentMessage>;tool(step: ToolStep): Promise<ToolResult> };

// Legacy snapshots replay one pass; version 2 admits one revision inside the shared 12-request limit.
export async function runModelWorkflow(rawContext: unknown, sourceText: string, steps: ToolStep[], io: IO, revisionLimit: 0 | 1 = 0) {
  const context=BillingContext.parse(rawContext), base={ scope: context.scope,sourceText };
  const call=async(task: RoleTask,parent: AgentMessage | null,data: object,cycle=0)=>{
    const input=JSON.stringify({ ...base,...data });
    const message=await io.model(task,roleTaskStep(task,`model-${task}${cycle ? `-${cycle}` : ""}`,parent?.messageId ?? null),input);
    validateRoleOutput({ task,input },bodyOf(message));
    return message;
  };
  const first=await call("customer-request",null,{});
  let parent=first;
  let feedback: object={};
  const known=new Map<string,ToolResult>();
  for (let cycle=0;cycle<=revisionLimit;cycle++) {
    const available=steps.map(s=>({ ...s,operationKey: cycle ? `revision-${cycle}-${s.operationKey}` : s.operationKey }));
    const assignment=await call("investigate",parent,{ ...feedback,parent: bodyOf(parent),allowedTools: available.map(s=>s.request) },cycle);
    if (assignment.kind!=="task_request") throw new Error("investigation task required");
    const selected=assignment.payload.toolRequests!.map((request)=>{
      const step=available.find(s=>JSON.stringify(s.request)===JSON.stringify(request));
      if (!step) throw new Error("unassigned model tool");
      return step;
    });
    const observed=await Promise.all(selected.map(io.tool));
    for (const result of observed) known.set(result.name,result);
    const results=[...known.values()];
    const finding=await call("finding",assignment,{ ...feedback,parent: bodyOf(assignment),results },cycle);
    const draftTask=await call("draft-task",finding,{ ...feedback,parent: bodyOf(finding) },cycle);
    const draft=await call("draft",draftTask,{ ...feedback,parent: bodyOf(draftTask),finding: bodyOf(finding) },cycle);
    const review=await call("review",draft,{ ...feedback,parent: bodyOf(draft),finding: bodyOf(finding),draft: bodyOf(draft) },cycle);
    if (draft.kind!=="proposal" || review.kind!=="review_result") throw new Error("proposal and review required");
    const guard=billingReview(context,results,draft,finding), fresh=billingFinding(context,results);
    const approved=review.payload.decision==="approve" && guard.payload.decision==="approve";
    if (!approved && cycle<revisionLimit && review.payload.decision!=="escalate" && guard.payload.decision!=="escalate") {
      parent=review;
      feedback={ feedback: bodyOf(review),guard };
      continue;
    }
    return { mode: "model_test" as const,decision: approved ? "approve" as const : "escalate" as const,
      revisionCycles: cycle,finalMessageId: review.messageId,guard: guard.payload,
      reason: approved ? "Pending proposal verified; human approval required." : cycle===revisionLimit && (review.payload.decision==="revise" || guard.payload.decision==="revise") ? "Model-test revision limit reached; human investigation required." : "Model-test review escalated; human investigation required.",
      evidenceRefs: fresh.evidenceRefs,pendingProposal: approved ? draft.payload.resolution : null,
      projectedBalanceCents: approved ? fresh.payload.billing!.projectedBalanceCents : null };
  }
  throw new Error("model review cycle invalid");
}
