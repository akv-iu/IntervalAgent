import { z } from "zod";
import { localDate } from "../time";
import { PaymentProposal, proposalIsCurrent } from "./options";
import { SimulationOutcome, type FinancialDecision, type PaymentAgreement, type PaymentOperation } from "./payments";
import type { LessonInstruction } from "./learning";
import { requireInvestigableClaim, type PaymentClaim } from "./claim";

export const ROLE_VERSION = "v2-reconciliation-3";

const CommandIdentity = { id: z.uuid(), caseId: z.string().regex(/^[a-z-]{1,60}$/) };
const Revision = z.number().int().nonnegative();
export const CorrectionRole = z.enum(["customer", "business_verification", "account_resolution", "reviewer"]);
const FinancialEvidence = { note: z.string().trim().min(10).max(1200), evidenceReference: z.string().trim().min(1).max(80) };
export const CaseCommand = z.discriminatedUnion("action", [
  z.object({ ...CommandIdentity, action: z.literal("approve_credit"), revision: Revision, targetAuditId: z.uuid(), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), ...FinancialEvidence }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("approve_extension"), revision: Revision, sourceMessageId: z.string().min(1).max(100), ...FinancialEvidence }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("reverse_receipt"), revision: Revision, receiptId: z.string().min(1).max(100), ...FinancialEvidence }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("reconcile_record"), revision: Revision, paymentId: z.string().min(1).max(100), outcome: z.enum(["succeeded", "failed"]), ...FinancialEvidence }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("approve_recognition"), revision: Revision, targetAuditId: z.uuid(), ...FinancialEvidence }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("reconcile_payment"), revision: Revision, operationId: z.uuid(), outcome: z.enum(["succeeded", "failed"]), ...FinancialEvidence }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("confirm_plan"), revision: Revision, proposal: PaymentProposal }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("simulate_payment"), revision: Revision, agreementId: z.uuid(), outcome: SimulationOutcome }).strict(),
  z.object({ ...CommandIdentity, action: z.enum(["customer", "business", "retry", "takeover", "resume"]), text: z.string().trim().min(1).max(1800).optional(), requestId: z.uuid().optional() }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("correct"), revision: Revision, targetAuditId: z.uuid(), targetRole: CorrectionRole, text: z.string().trim().min(1).max(1200) }).strict(),
  z.object({ ...CommandIdentity, action: z.literal("retry_correction"), revision: Revision, correctionId: z.uuid() }).strict(),
]);
export type CaseCommand = z.infer<typeof CaseCommand>;

export const DateOnly = z.iso.date();
const Text = z.string().min(1).max(1200);
export const CaseUpdate = z.discriminatedUnion("kind", [
  PaymentProposal,
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

export type Message = { id: string; channel: "customer" | "business"; speaker: "customer" | "business" | "agent"; text: string; at: string; requestId?: string; disposition?: "late"; origin?: "synthetic_opening" | "operator_revision" };
export type Payment = { id: string; invoiceId: string; amountCents: number; date: string; status: "settled" | "pending"; includedInBalance: boolean; provenance?: "business_confirmation" | "simulated_operation" | "operator_decision"; businessMessageId?: string; requestId?: string; reference?: string | null; operationId?: string; agreementId?: string; decisionId?: string; reversedBy?: string; reconciledBy?: string };
export type CaseFacts = {
  id: string; businessId: string; businessName: string; customer: string; invoiceId: string;
  balanceCents: number; balanceAsOf: string; sourceVersion: string; timezone: "America/Denver";
  phone: string | null; email: string | null;
  payments: Payment[];
  recognitionPolicy?: "business_confirmation" | "operator_review";
  scenario?: "late_payment" | "partial_payment" | "conflicting_reference" | "cancellation_overlap" | "affordability" | "pending_payment";
  accountNotes?: string[];
};
export type Investigation = {
  facts: CaseFacts; messages: Message[]; now: string; verification: Verification | null; paymentClaim?: PaymentClaim | null; requestId?: string | null; caseUpdates?: CaseUpdate[];
  agreements?: PaymentAgreement[]; operations?: PaymentOperation[]; financialDecisions?: FinancialDecision[]; paymentAction?: { kind: "agreement_confirmed" | "payment_attempted" | "financial_decided"; id: string };
  operatorFeedback?: { correctionId: string; targetAuditId: string; targetRole: z.infer<typeof CorrectionRole>; text: string; original: InvestigationResult };
  lessons?: LessonInstruction[];
};
export type Activity = { role: "customer" | "business_verification" | "account_resolution" | "reviewer"; action: string; summary: string };
export type InvestigationResult = {
  draft: Draft; verification: Verification | null; resolution: Resolution | null; paymentClaim?: PaymentClaim | null;
  review: z.infer<typeof Review>; activity: Activity[];
};

export function validateUpdates(updates: CaseUpdate[], input: Investigation): CaseUpdate[] {
  if (input.paymentAction && updates.some((u) => u.kind === "payment_recognized" || u.kind === "payment_proposed")) throw new Error("Payment assessment cannot propose another payment or replay recognition; use the saved outcome.");
  if (updates.filter((u) => u.kind === "payment_recognized").length > 1) throw new Error("Only one payment can be recognized per reviewed result");
  if (updates.filter((u) => u.kind === "payment_proposed").length > 1 || (updates.some((u) => u.kind === "payment_proposed") && updates.some((u) => u.kind === "payment_recognized"))) throw new Error("Use one current proposal per result, separately from payment recognition");
  return updates.map((value) => {
    const update = CaseUpdate.parse(value);
    const source = input.messages.find((m) => m.id === update.sourceMessageId);
    if (!source || source.channel !== "customer" || source.speaker !== "customer") throw new Error("Update needs a customer source message");
    if (update.kind === "payment_proposed" && !proposalIsCurrent(update, input.facts, input.now)) throw new Error("Proposal does not match current business policy, source, balance or calculated schedule");
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

export function validateVerification(value: Verification, input: Investigation): Verification {
  if (!input.messages.some((m) => m.id === value.claimMessageId && m.speaker === "customer")) throw new Error("Verification requires a claim from this customer conversation");
  const claim = requireInvestigableClaim(input.paymentClaim, input);
  if (claim.intent !== "payment_claim" || claim.claimMessageId !== value.claimMessageId || claim.invoice.value !== input.facts.invoiceId) throw new Error("Verification requires an evidence-backed matching customer invoice and payment claim");
  if (value.outcome === "awaiting_business" && (value.amountCents !== null && value.amountCents !== claim.amount.value || value.paymentDate !== null && value.paymentDate !== claim.date.value || value.invoiceId !== null && value.invoiceId !== claim.invoice.value)) throw new Error("A business question cannot invent missing customer payment terms");
  const replyExists = input.verification?.claimMessageId === value.claimMessageId && input.requestId && input.messages.some((m) => m.channel === "business" && m.speaker === "business" && m.requestId === input.requestId && m.disposition !== "late");
  if (value.outcome !== "awaiting_business" && !replyExists) throw new Error("Business evidence requires an actual linked reply");
  if (value.outcome === "business_reported" && (value.amountCents === null || value.amountCents <= 0 || value.invoiceId !== input.facts.invoiceId || value.businessMessage !== null)) throw new Error("A business report needs a matching invoice and amount; no further questionnaire is sent");
  if (value.outcome === "business_confirmed" && (value.amountCents === null || value.amountCents <= 0 || !value.paymentDate || value.invoiceId !== input.facts.invoiceId || value.settlementStatus !== "settled")) throw new Error("Business confirmation needs complete matching settled evidence");
  return value;
}
