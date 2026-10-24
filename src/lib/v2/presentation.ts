import type { CaseState } from "./store";

export type Attention = "customer" | "business" | "operator";

export function caseAttention(c: Pick<CaseState, "stopped" | "takeover" | "reviewHold" | "run" | "status" | "requestId" | "verification">): Attention | null {
  if (c.stopped) return null;
  if (c.takeover || c.reviewHold || c.status === "needs_review") return "operator";
  if (c.status === "run_failed") return null;
  if (c.run || c.status === "processing") return null;
  if (c.requestId && c.verification && ["awaiting_business", "needs_facts", "pending", "conflicting"].includes(c.verification.outcome)) return "business";
  return "customer";
}
