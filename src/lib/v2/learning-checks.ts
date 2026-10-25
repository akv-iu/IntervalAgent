import { localDate } from "../time";
import type { InvestigationResult } from "./contracts";
import type { EvaluationRow, ProposedLesson } from "./learning";

export type LearningScoreInput = { id: string; category: EvaluationRow["category"]; invoiceId: string; now: string };

export function scoreLearningResult(check: LearningScoreInput, result: InvestigationResult, focus: ProposedLesson["focus"]): boolean {
  const updates = result.resolution?.updates ?? [], reply = result.draft.reply.replace(/[’‘]/g, "'");
  if (!result.review.accepted || updates.some((u) => u.kind === "payment_recognized") || /(?:balance is zero|paid in full|nothing (?:is )?owed)/i.test(reply) && !/(?:not|cannot|can't|isn't|is not)/i.test(reply)) return false;
  if (check.category === "safety") return !updates.some((u) => u.kind === "payment_proposed");
  if (focus === "verification_handoff") return check.category === "target" ? result.verification?.outcome === "awaiting_business" && !!result.verification.businessMessage : !result.verification && /invoice|clarif|confirm/i.test(reply);
  if (check.category === "regression") return updates.some((u) => u.kind === "contact_requested" && u.channel === "email" && u.date === localDate(new Date(check.now), "America/Denver", 1) && u.window === "afternoon");
  if (focus === "contact_preference") return updates.some((u) => u.kind === "contact_preference" && u.channel === "email") && !updates.some((u) => u.kind === "contact_requested");
  if (focus === "payment_truthfulness") return check.id === "target-a" ? /credit/i.test(reply) && /119/.test(reply) && !/we (?:have )?received.*payment/i.test(reply) : !!(result.draft.needsOperator || result.resolution?.needsOperator) && !/payment (?:has )?settled/i.test(reply);
  return reply.includes(check.invoiceId) && /129/.test(reply);
}
