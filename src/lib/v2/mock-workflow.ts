import type { z } from "zod";
import type { MockResult } from "./case-store";
import type { AgentMessage, ToolRequest } from "./contracts";
import { MockWorkflow, type MessageStep, mockInstructions, mockCustomerTask, mockCoordinatorTask, mockInvestigatorFinding, mockCustomerDraft, mockReviewer } from "./mock-agents";
import type { ToolResult } from "./tools";
import { billingDraft, billingFinding, billingInstructions, billingReview } from "./billing";

export { mockCustomerDraft } from "./mock-agents";
type ToolStep = { operationKey: string; request: z.infer<typeof ToolRequest> };
type IO = { step(step: MessageStep, generate: () => unknown): Promise<AgentMessage>; tool(step: ToolStep): Promise<ToolResult> };

// Pure mock functions only; external providers need reserved dispatches and usage settlement first.
export async function runFourRoleMock(rawWorkflow: unknown, steps: ToolStep[], io: IO, customer: (finding: AgentMessage, cycle: number) => ReturnType<typeof mockCustomerDraft> = mockCustomerDraft): Promise<MockResult> {
  const workflow = MockWorkflow.parse(rawWorkflow);
  const instructions = workflow.billing ? billingInstructions : mockInstructions;
  for (const role of ["customer", "coordinator", "investigator", "reviewer"] as const) {
    if (workflow.instructions[role].version !== instructions[role].version || workflow.instructions[role].text !== instructions[role].text) throw new Error("unsupported mock instruction snapshot");
  }
  const first = await io.step({ operationKey: "customer-request", sender: "customer", recipient: "coordinator", parentMessageId: null }, () => mockCustomerTask(workflow.sourceText));
  let parent = first;
  const known = new Map<string, ToolResult>();
  for (let cycle = 0; cycle <= 2; cycle++) {
    const required = parent.kind==="review_result" ? parent.payload.reinvestigate : undefined;
    const assigned = cycle === 0 ? steps : steps.filter((s) => required?.length ? required.includes(s.request.name) : s.request.name === "policy_lookup").map((s) => ({ ...s, operationKey: workflow.billing ? `revision-${cycle}-${s.operationKey}` : `revision-${cycle}-policy` }));
    const task = await io.step({ operationKey: `investigate-${cycle}`, sender: "coordinator", recipient: "investigator", parentMessageId: parent.messageId }, () => mockCoordinatorTask(assigned.map((s) => s.request), cycle > 0));
    const results = await Promise.all(assigned.map((s) => io.tool(s)));
    for (const result of results) known.set(result.name, result);
    const finding = await io.step({ operationKey: `finding-${cycle}`, sender: "investigator", recipient: "coordinator", parentMessageId: task.messageId }, () => workflow.billing ? billingFinding(workflow.billing,[...known.values()]) : mockInvestigatorFinding([...known.values()]));
    const draftTask = await io.step({ operationKey: `draft-task-${cycle}`, sender: "coordinator", recipient: "customer", parentMessageId: finding.messageId }, () => ({ kind: "task_request", payload: { instruction: workflow.billing ? "Propose only the verified payment/eligible credit and projected balance, pending human approval. No changes are applied." : "Draft a pending-review acknowledgement using this finding. Do not claim an applied action." }, evidenceRefs: finding.evidenceRefs }));
    const draft = await io.step({ operationKey: `draft-${cycle}`, sender: "customer", recipient: "reviewer", parentMessageId: draftTask.messageId }, () => customer(finding, cycle));
    const review = await io.step({ operationKey: `review-${cycle}`, sender: "reviewer", recipient: "coordinator", parentMessageId: draft.messageId }, () => workflow.billing ? billingReview(workflow.billing,[...known.values()],draft,finding) : mockReviewer(draft, finding));
    if (review.kind !== "review_result") throw new Error("review result required");
    if (review.payload.decision !== "revise" || cycle === 2) {
      const decision = review.payload.decision === "approve" ? "approve" : "escalate";
      const last = decision === "approve" ? review : await io.step({ operationKey: "escalate", sender: "coordinator", recipient: "customer", parentMessageId: review.messageId }, () => ({ kind: "escalation", payload: { reason: cycle === 2 ? "Two revision cycles exhausted; human review required." : "Required evidence could not be verified; human review required." }, evidenceRefs: finding.evidenceRefs }));
      const pending = workflow.billing && decision==="approve" ? billingDraft(finding).payload.resolution : null;
      return { mode: "mock", summary: decision === "approve" ? "Four-role mock review complete; human review required. No changes applied." : "Four-role mock escalated for human investigation. No changes applied.", evidenceRefs: finding.evidenceRefs, workflow: { decision, revisionCycles: cycle, finalMessageId: last.messageId },
        ...(pending && finding.kind==="finding" && finding.payload.billing ? { pendingProposal: pending, projectedBalanceCents: finding.payload.billing.projectedBalanceCents } : {}),
      };
    }
    parent = review;
  }
  throw new Error("mock review cycle invalid");
}
