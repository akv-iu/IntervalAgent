import { z } from "zod";
import type { Investigation } from "./contracts";

const Evidence = z.array(z.object({ messageId: z.string().min(1).max(100), quote: z.string().min(1).max(300) }).strict()).max(4);
export const PaymentClaim = z.object({
  businessId: z.string().min(1).max(100), caseId: z.string().min(1).max(100), sourceVersion: z.string().min(1).max(1024),
  intent: z.enum(["payment_claim", "unclear", "not_payment_claim"]),
  claimMessageId: z.string().min(1).max(100), throughMessageId: z.string().min(1).max(100),
  invoice: z.object({ value: z.string().min(1).max(80).nullable(), evidence: Evidence }).strict(),
  amount: z.object({ value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(), evidence: Evidence }).strict(),
  date: z.object({ value: z.iso.date().nullable(), evidence: Evidence }).strict(),
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
  for (const slot of [claim.invoice, claim.amount, claim.date]) {
    if (slot.value !== null && !slot.evidence.length) throw new Error("Interpreted values require conversation evidence");
    let customerEvidence = false;
    for (const ref of slot.evidence) {
      const index = input.messages.findIndex((m) => m.id === ref.messageId), message = input.messages[index];
      if (!message || index > through || message.channel !== "customer" || message.disposition === "late" || !message.text.includes(ref.quote)) throw new Error("Payment interpretation cites missing, future or non-customer-conversation evidence");
      if (message.speaker === "customer" && index >= start) customerEvidence = true;
    }
    if (slot.value !== null && !customerEvidence) throw new Error("Account facts and agent questions alone cannot establish a customer claim");
  }
  return claim;
}

export function requireInvestigableClaim(value: unknown, input: Investigation): PaymentClaim {
  const claim = validatePaymentClaim(value, input);
  if (claim.throughMessageId !== input.messages.findLast((m) => m.channel === "customer" && m.speaker === "customer")?.id) throw new Error("Review newer messages before investigating or recognizing this payment.");
  if (claim.intent !== "payment_claim" || claim.invoice.value !== input.facts.invoiceId) throw new Error("Clarify the payment claim and matching invoice before business investigation");
  return claim;
}
