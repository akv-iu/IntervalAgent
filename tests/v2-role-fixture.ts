import { billingDraft, billingFinding, billingRecipe } from "../src/lib/v2/billing";
import { demoRecords } from "../src/lib/v2/demo-records";
import { makeAgentMessage } from "../src/lib/v2/mock-agents";
import { parseRoleInput, roleTaskStep, type RoleTask } from "../src/lib/v2/role-tasks";

// Scripted transport fixture, never live-model or independent evaluation evidence.
export function scriptedRoleBody(task: RoleTask, input: string) {
  const data=parseRoleInput(task,input), context={ ...data.scope,caseId: "fixture-case",runId: "fixture-run",createdAt: "2026-10-20T00:00:00.000Z" };
  if (task==="customer-request") return { kind: "task_request",payload: { instruction: data.sourceText },evidenceRefs: [] };
  if (task==="investigate") return { kind: "task_request",payload: { instruction: "Read the selected records.",toolRequests: data.allowedTools },evidenceRefs: [] };
  if (task==="finding") return billingFinding(billingRecipe(demoRecords(),data.scope).context,data.results!);
  if (task==="draft-task") return { kind: "task_request",payload: { instruction: "Prepare a pending human-review proposal." },evidenceRefs: data.parent!.evidenceRefs };
  if (task==="draft") return billingDraft(makeAgentMessage(context,roleTaskStep("finding","fixture-finding","fixture-task"),data.finding));
  return { kind: "review_result",payload: { decision: "approve",summary: "Scripted review approved; human approval is still required.",requiredChanges: [] },evidenceRefs: data.draft!.evidenceRefs };
}
