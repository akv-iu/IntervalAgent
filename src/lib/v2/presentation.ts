import type { CaseState } from "./store";

export type Attention = "customer" | "business" | "operator";
export const roleNames: Record<string, string> = { customer: "Case Orchestrator", business_verification: "Business Verification", account_resolution: "Account Resolution", reviewer: "Reviewer" };

export const statusNames: Record<CaseState["status"], string> = { ready: "Ready for the customer", processing: "Agents are working", awaiting_business: "Waiting for the business", needs_review: "Operator review needed", run_failed: "Technical failure · explicit retry available", stopped: "Contact stopped", taken_over: "Under operator control" };

export function scenarioName(c: Pick<CaseState, "facts">): string {
  const scenario = c.facts.scenario;
  return scenario ? { late_payment: "Late payment", partial_payment: "Partial payment on record", conflicting_reference: "Different invoice reference", cancellation_overlap: "Cancellation and renewal", affordability: "Affordability and options", pending_payment: "Pending payment" }[scenario] : c.facts.id.replaceAll("-", " ");
}

export function caseAttention(c: Pick<CaseState, "stopped" | "takeover" | "reviewHold" | "run" | "status" | "requestId" | "verification">): Attention | null {
  if (c.stopped) return null;
  if (c.takeover || c.reviewHold || c.status === "needs_review") return "operator";
  if (c.status === "run_failed") return null;
  if (c.run || c.status === "processing") return null;
  if (c.requestId && c.verification && ["awaiting_business", "needs_facts", "pending", "conflicting"].includes(c.verification.outcome)) return "business";
  return "customer";
}
