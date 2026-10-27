import { z } from "zod";
import type { Investigation } from "./contracts";

const Evidence = z.array(z.object({ messageId: z.string().min(1).max(100), quote: z.string().min(1).max(300) }).strict()).max(4);
export const PaymentClaim = z.object({
  businessId: z.string().min(1).max(100), caseId: z.string().min(1).max(100), sourceVersion: z.string().min(1).max(1024),
  intent: z.enum(["payment_claim", "unclear", "not_payment_claim"]),
  claimMessageId: z.string().min(1).max(100), throughMessageId: z.string().min(1).max(100),
  invoice: z.object({ value: z.string().min(1).max(80).nullable(), evidence: Evidence }).strict(),
  amount: z.object({ value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().describe("Customer-claimed amount in integer US cents, never dollars; null when unknown."), evidence: Evidence }).strict(),
  date: z.object({ value: z.iso.date().nullable(), evidence: Evidence }).strict(),
  reportResponse: z.object({ stance: z.enum(["agrees", "disputes", "unclear"]), businessMessageId: z.string().min(1).max(100) }).strict().nullable().optional(),
  uncertainties: z.array(z.string().min(1).max(200)).max(4),
}).strict();
export type PaymentClaim = z.infer<typeof PaymentClaim>;

export function validatePaymentClaim(value: unknown, input: Investigation): PaymentClaim {
  if (!value) throw new Error("Review this payment again with conversation evidence before investigating or recording it.");
  const claim = PaymentClaim.parse(value);
  if (claim.businessId !== input.facts.businessId || claim.caseId !== input.facts.id || claim.sourceVersion !== input.facts.sourceVersion) throw new Error("Payment interpretation belongs to another account or stale source snapshot");
  const customer = (id: string) => input.messages.findIndex((m) => m.id === id && m.channel === "customer" && m.speaker === "customer");
  const start = customer(claim.claimMessageId), through = customer(claim.throughMessageId);
  if (start < 0 || through < start) throw new Error("Payment interpretation requires ordered customer claim and context messages");
  for (const [field, slot] of Object.entries({ invoice: claim.invoice, amount: claim.amount, date: claim.date })) {
    if (slot.value !== null && !slot.evidence.length) throw new Error(`${field} interpretation requires conversation evidence`);
    let customerEvidence = false;
    for (const ref of slot.evidence) {
      const index = input.messages.findIndex((m) => m.id === ref.messageId), message = input.messages[index];
      if (!message || index > through || message.channel !== "customer" || message.disposition === "late") throw new Error(`${field} evidence ${ref.messageId} is missing, future or outside the customer conversation`);
      if (!message.text.includes(ref.quote)) throw new Error(`${field} evidence ${ref.messageId} quotation is not verbatim; copy the exact text from that message`);
      if (message.speaker === "customer" && index >= start) customerEvidence = true;
    }
    if (slot.value !== null && !customerEvidence) throw new Error(`${field} has no customer evidence at/after claimMessageId; retain the original claim ID and cite its contextual confirmation`);
  }
  if (claim.reportResponse) {
    const response = input.messages.findIndex((m) => m.id === claim.reportResponse!.businessMessageId && m.channel === "business" && m.speaker === "business" && m.requestId === input.requestId && m.disposition !== "late");
    const latest = input.messages.findLastIndex((m, i) => i < through && m.channel === "business" && m.speaker === "business" && m.requestId === input.requestId && m.disposition !== "late");
    if (!input.requestId || response < 0 || response !== latest) throw new Error("Report response must cite the latest linked business reply preceding the customer response");
    if (claim.reportResponse.stance === "agrees" && (input.verification?.claimMessageId !== claim.claimMessageId || claim.amount.value === null || claim.amount.value !== input.verification.amountCents || !claim.amount.evidence.some((e) => e.messageId === claim.throughMessageId))) throw new Error("Agreement must preserve the reported amount and cite the current customer confirmation");
  }
  return claim;
}

export function validateCurrentClaim(value: unknown, input: Investigation): PaymentClaim {
  const claim = validatePaymentClaim(value, input);
  if (claim.throughMessageId !== input.messages.findLast((m) => m.channel === "customer" && m.speaker === "customer")?.id) throw new Error("Review newer messages before investigating or recognizing this payment.");
  return claim;
}

export function requireInvestigableClaim(value: unknown, input: Investigation): PaymentClaim {
  const claim = validateCurrentClaim(value, input);
  if (claim.intent !== "payment_claim" || claim.invoice.value !== input.facts.invoiceId) throw new Error("Clarify the payment claim and matching invoice before business investigation");
  return claim;
}
