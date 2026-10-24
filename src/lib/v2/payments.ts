import { z } from "zod";
import { localDate } from "../time";
import { PaymentProposal, paymentOptions, proposalIsCurrent } from "./options";
import type { CaseFacts, Verification } from "./contracts";

export const SimulationOutcome = z.enum(["succeeded", "failed", "pending", "unknown"]);
export type SimulationOutcome = z.infer<typeof SimulationOutcome>;
export type PaymentAgreement = { id: string; proposal: PaymentProposal; proposalAuditId: string; confirmedAt: string };
export type PaymentOperation = {
  id: string; agreementId: string; installment: number; invoiceId: string; amountCents: number; at: string;
  outcome: SimulationOutcome; provenance: "simulated_processor"; balanceBeforeCents: number; balanceAfterCents: number;
  sourceVersionBefore: string; sourceVersionAfter: string; receiptId: string | null;
};

export function paymentHold(facts: CaseFacts, operations: PaymentOperation[] = [], verification?: Verification | null, requestId?: string | null): string | null {
  if (operations.some((op) => op.outcome === "pending" || op.outcome === "unknown")) return "A pending or unknown attempt needs operator reconciliation before another payment or plan confirmation.";
  if (facts.payments.some((p) => p.invoiceId === facts.invoiceId && p.status === "pending" && !p.includedInBalance)) return "An existing pending payment needs verification before another payment or plan confirmation.";
  if (verification && verification.outcome !== "not_found" && !(requestId && facts.payments.some((p) => p.requestId === requestId && p.includedInBalance))) return "Resolve existing business payment evidence before starting a new payment plan.";
  return null;
}

export function confirmPlan(id: string, proposal: PaymentProposal, proposalAuditId: string, facts: CaseFacts, now: string): PaymentAgreement {
  const checked = PaymentProposal.parse(proposal);
  if (!proposalIsCurrent(checked, facts, now)) throw new Error("This proposal is outdated. Request a fresh reviewed offer before confirming.");
  return { id, proposal: checked, proposalAuditId, confirmedAt: now };
}

export function nextPayment(agreement: PaymentAgreement, facts: CaseFacts, operations: PaymentOperation[], now: string) {
  const hold = paymentHold(facts, operations);
  if (hold) throw new Error(hold);
  const proposal = agreement.proposal, policy = paymentOptions(facts);
  if (!proposalIsCurrent(proposal, { ...facts, balanceCents: proposal.balanceCents, sourceVersion: proposal.sourceVersion }, agreement.confirmedAt)) throw new Error("The confirmed plan no longer matches business policy or invoice. Request a fresh reviewed offer.");
  if (policy.status !== "available" || !policy.executionMethods.includes(proposal.method)) throw new Error("This method needs operator receipt approval; automatic simulation is unavailable for it.");
  const succeeded = operations.filter((op) => op.agreementId === agreement.id && op.outcome === "succeeded");
  const index = succeeded.length, part = proposal.schedule[index];
  if (!part) throw new Error("This plan is already fully paid in the simulation.");
  const latest = succeeded.at(-1);
  const expectedBalance = proposal.balanceCents - succeeded.reduce((sum, op) => sum + op.amountCents, 0);
  if (facts.sourceVersion !== (latest?.sourceVersionAfter ?? proposal.sourceVersion) || facts.balanceCents !== expectedBalance) throw new Error("The account changed after confirmation. Reconcile it before another attempt.");
  if (!Number.isSafeInteger(part.amountCents) || part.amountCents <= 0 || part.amountCents > facts.balanceCents) throw new Error("The due installment does not match the current balance.");
  if (!Number.isFinite(Date.parse(now)) || part.date > localDate(new Date(now), facts.timezone)) throw new Error(`The next installment is due ${part.date}; future payments do not execute automatically.`);
  return { ...part, installment: index };
}

// This bounded demo processor has no network or real payment credentials; its selected result is test evidence only.
export function simulatePayment(id: string, agreement: PaymentAgreement, facts: CaseFacts, operations: PaymentOperation[], now: string, outcome: SimulationOutcome) {
  const result = SimulationOutcome.parse(outcome), due = nextPayment(agreement, facts, operations, now);
  const updated = structuredClone(facts), receiptId = result === "succeeded" ? `sim-${id}` : null;
  if (receiptId) {
    updated.balanceCents -= due.amountCents;
    updated.balanceAsOf = now;
    updated.sourceVersion = `${facts.sourceVersion}:simulated:${id}`;
    if (updated.sourceVersion.length > 1024 || updated.payments.length >= 100) throw new Error("Account evidence limit reached; operator review is required.");
    updated.payments.push({ id: receiptId, invoiceId: facts.invoiceId, amountCents: due.amountCents, date: localDate(new Date(now), facts.timezone), status: "settled", includedInBalance: true, provenance: "simulated_operation", operationId: id, agreementId: agreement.id });
  }
  const operation: PaymentOperation = { id, agreementId: agreement.id, installment: due.installment, invoiceId: facts.invoiceId, amountCents: due.amountCents, at: now, outcome: result, provenance: "simulated_processor", balanceBeforeCents: facts.balanceCents, balanceAfterCents: updated.balanceCents, sourceVersionBefore: facts.sourceVersion, sourceVersionAfter: updated.sourceVersion, receiptId };
  return { operation, facts: updated };
}
