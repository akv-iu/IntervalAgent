import { z } from "zod";
import { localDate } from "../time";

export const ROLE_VERSION = "v2-phase1-13";

export const DateOnly = z.iso.date();
const Text = z.string().min(1).max(1200);
export const CaseUpdate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("promise"), amountCents: z.number().int().positive(), date: DateOnly, sourceMessageId: z.string() }).strict(),
  z.object({ kind: z.literal("extension_requested"), date: DateOnly, sourceMessageId: z.string() }).strict(),
  z.object({ kind: z.literal("contact_preference"), channel: z.enum(["call", "email"]), sourceMessageId: z.string() }).strict(),
  z.object({ kind: z.literal("contact_requested"), channel: z.enum(["call", "email"]), date: DateOnly, window: z.enum(["morning", "afternoon", "evening", "unspecified"]), sourceMessageId: z.string() }).strict(),
  z.object({ kind: z.literal("payment_recognized"), amountCents: z.number().int().positive(), date: DateOnly, invoiceId: z.string().min(1).max(80), reference: z.string().max(80).nullable(), sourceMessageId: z.string(), businessMessageId: z.string() }).strict(),
]);
export type CaseUpdate = z.infer<typeof CaseUpdate>;

export const Verification = z.object({
  claimMessageId: z.string().min(1).max(100),
  outcome: z.enum(["awaiting_business", "needs_facts", "business_reported", "business_confirmed", "not_found", "conflicting", "pending"]),
  businessMessage: z.string().max(1200).nullable(),
  summary: Text,
  amountCents: z.number().int().nonnegative().nullable(),
  paymentDate: DateOnly.nullable(),
  invoiceId: z.string().max(80).nullable(),
  reference: z.string().max(80).nullable(),
  settlementStatus: z.enum(["settled", "pending", "failed", "unknown"]),
  missingFacts: z.array(z.string().max(100)).max(8),
}).strict();
export type Verification = z.infer<typeof Verification>;

export const Resolution = z.object({
  summary: Text,
  needsOperator: z.boolean(),
  updates: z.array(CaseUpdate).max(4),
}).strict();
export type Resolution = z.infer<typeof Resolution>;
export const Draft = z.object({ reply: Text, needsOperator: z.boolean() }).strict();
export type Draft = z.infer<typeof Draft>;
export const Review = z.object({ accepted: z.boolean(), reasons: z.array(z.string().max(300)).max(6) }).strict();

export type Message = { id: string; channel: "customer" | "business"; speaker: "customer" | "business" | "agent"; text: string; at: string; requestId?: string; disposition?: "late"; origin?: "synthetic_opening" };
export type Payment = { id: string; invoiceId: string; amountCents: number; date: string; status: "settled" | "pending"; includedInBalance: boolean; provenance?: "business_confirmation"; businessMessageId?: string; requestId?: string; reference?: string | null };
export type CaseFacts = {
  id: string; businessId: string; businessName: string; customer: string; invoiceId: string;
  balanceCents: number; balanceAsOf: string; sourceVersion: string; timezone: "America/Denver";
  phone: string | null; email: string | null;
  payments: Payment[];
  recognitionPolicy?: "business_confirmation";
};
export type Investigation = {
  facts: CaseFacts; messages: Message[]; now: string; verification: Verification | null; requestId?: string | null; caseUpdates?: CaseUpdate[];
};
export type Activity = { role: "customer" | "business_verification" | "account_resolution" | "reviewer"; action: string; summary: string };
export type InvestigationResult = {
  draft: Draft; verification: Verification | null; resolution: Resolution | null;
  review: z.infer<typeof Review>; activity: Activity[];
};

export function validateUpdates(updates: CaseUpdate[], input: Investigation): CaseUpdate[] {
  if (updates.filter((u) => u.kind === "payment_recognized").length > 1) throw new Error("Only one payment can be recognized per reviewed result");
  return updates.map((value) => {
    const update = CaseUpdate.parse(value);
    const source = input.messages.find((m) => m.id === update.sourceMessageId);
    if (!source || source.channel !== "customer" || source.speaker !== "customer") throw new Error("Update needs a customer source message");
    if (update.kind === "payment_recognized") {
      const v = input.verification;
      if (!v || v.outcome !== "business_confirmed") throw new Error("Recognition needs business confirmation");
      validateVerification(v, input);
      if (input.facts.recognitionPolicy !== "business_confirmation") throw new Error("Business recognition policy requires operator approval");
      const reply = input.messages.filter((m) => m.speaker === "business" && m.requestId === input.requestId && m.disposition !== "late").at(-1);
      if (!reply || reply.id !== update.businessMessageId || update.sourceMessageId !== v.claimMessageId || update.invoiceId !== v.invoiceId || update.amountCents !== v.amountCents || update.date !== v.paymentDate || update.reference !== v.reference) throw new Error("Recognition must match current business evidence");
      if (update.amountCents > input.facts.balanceCents) throw new Error("Recognition exceeds the current balance; operator review required");
      if (update.date > localDate(new Date(input.now), input.facts.timezone) || update.date <= localDate(new Date(input.facts.balanceAsOf), input.facts.timezone)) throw new Error("Payment date must be after the balance snapshot and not in the future; operator review required");
      if (input.facts.payments.some((p) => p.requestId === input.requestId || (update.reference && p.reference === update.reference) || (p.invoiceId === update.invoiceId && p.date === update.date && p.amountCents === update.amountCents))) throw new Error("Payment may already be included; operator review required");
    }
    if (update.kind === "promise" && update.amountCents > input.facts.balanceCents) throw new Error("Promise exceeds the current balance");
    if (update.kind === "contact_requested" && !(update.channel === "call" ? input.facts.phone : input.facts.email)) throw new Error("Contact destination needs clarification");
    return update;
  });
}

export function hasCustomerInvoice(input: Investigation, claimMessageId?: string): boolean {
  const claimIndex = claimMessageId ? input.messages.findIndex((m) => m.id === claimMessageId) : 0;
  if (claimIndex < 0) return false;
  const invoice = input.facts.invoiceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return input.messages.slice(claimIndex).some((m) => m.speaker === "customer" && new RegExp(`(?:^|[^A-Z0-9-])${invoice}(?=$|[^A-Z0-9-])`, "i").test(m.text));
}

export function validateVerification(value: Verification, input: Investigation): Verification {
  if (!input.messages.some((m) => m.id === value.claimMessageId && m.speaker === "customer")) throw new Error("Verification requires a claim from this customer conversation");
  if (!hasCustomerInvoice(input, value.claimMessageId)) throw new Error("Verification requires a matching customer invoice");
  const replyExists = input.verification?.claimMessageId === value.claimMessageId && input.requestId && input.messages.some((m) => m.channel === "business" && m.speaker === "business" && m.requestId === input.requestId);
  if (value.outcome !== "awaiting_business" && !replyExists) throw new Error("Business evidence requires an actual linked reply");
  if (value.outcome === "business_reported" && (value.amountCents === null || value.amountCents <= 0 || value.invoiceId !== input.facts.invoiceId || value.businessMessage !== null)) throw new Error("A business report needs a matching invoice and amount; no further questionnaire is sent");
  if (value.outcome === "business_confirmed" && (value.amountCents === null || value.amountCents <= 0 || !value.paymentDate || value.invoiceId !== input.facts.invoiceId || value.settlementStatus !== "settled")) throw new Error("Business confirmation needs complete matching settled evidence");
  return value;
}
