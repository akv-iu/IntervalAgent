import { localDate } from "../time";
import { Verification, validateUpdates, type Investigation, type InvestigationResult, type Payment } from "./contracts";
import { paymentHold, type FinancialDecision } from "./payments";

export type FinancialCommand = Extract<import("./contracts").CaseCommand, { action: "approve_recognition" | "reconcile_payment" | "approve_credit" | "approve_extension" | "reverse_receipt" | "reconcile_record" }>;
type WithoutIdentity<T> = T extends unknown ? Omit<T, "id" | "caseId"> : never;
export type FinancialRequest = WithoutIdentity<FinancialCommand>;

export function recognitionCandidate(input: Investigation, reviewed: InvestigationResult | null) {
  const v = reviewed?.verification;
  if (!reviewed?.review.accepted || !v || v.outcome !== "business_confirmed" || !input.requestId || !input.verification || JSON.stringify(Verification.parse(v)) !== JSON.stringify(Verification.parse(input.verification))) throw new Error("A current accepted review with complete business confirmation is required.");
  if (!input.facts.recognitionPolicy) throw new Error("The business has no recognition authority configured.");
  const hold = paymentHold(input.facts, input.operations, undefined, undefined, input.financialDecisions);
  if (hold) throw new Error(hold);
  const reply = input.messages.filter((m) => m.speaker === "business" && m.requestId === input.requestId && m.disposition !== "late").at(-1);
  if (!reply) throw new Error("A linked business reply is required.");
  const update = { kind: "payment_recognized" as const, amountCents: v.amountCents!, date: v.paymentDate!, invoiceId: v.invoiceId!, reference: v.reference, sourceMessageId: v.claimMessageId, businessMessageId: reply.id };
  // Operator authority replaces only the policy gate; matching, duplicate, date and balance guards still apply.
  validateUpdates([update], { ...input, paymentAction: undefined, verification: v, paymentClaim: reviewed.paymentClaim ?? input.paymentClaim, facts: { ...input.facts, recognitionPolicy: "business_confirmation" } });
  return update;
}

export function decideFinancial(input: Investigation, reviewed: InvestigationResult | null, command: FinancialCommand, now: string) {
  const facts = structuredClone(input.facts), decisions = input.financialDecisions ?? [];
  let amountCents: number, targetId: string, receipt: Payment | null = null;
  let kind: FinancialDecision["kind"], extensionDate: string | undefined, delta = 0;
  const outcome = "outcome" in command ? command.outcome : "succeeded";
  const receiptId = outcome === "succeeded" && ["approve_recognition", "reconcile_payment", "reconcile_record"].includes(command.action) ? `operator-${command.id}` : null;
  if (command.action === "approve_recognition") {
    kind = "recognition_approved";
    const update = recognitionCandidate({ ...input, now }, reviewed);
    if (decisions.some((d) => d.kind === "recognition_approved" && d.targetId === command.targetAuditId)) throw new Error("This review was already approved.");
    amountCents = update.amountCents; targetId = command.targetAuditId;
    receipt = { id: receiptId!, invoiceId: facts.invoiceId, amountCents, date: update.date, status: "settled", includedInBalance: true, provenance: "operator_decision", decisionId: command.id, businessMessageId: update.businessMessageId, requestId: input.requestId!, reference: update.reference };
  } else if (command.action === "reconcile_payment") {
    kind = "payment_reconciled";
    const op = input.operations?.find((item) => item.id === command.operationId);
    if (!op || !["pending", "unknown"].includes(op.outcome) || decisions.some((d) => d.kind === "payment_reconciled" && d.targetId === op.id)) throw new Error("Select an unresolved pending or unknown attempt in this case.");
    if (op.invoiceId !== facts.invoiceId || op.sourceVersionAfter !== facts.sourceVersion || op.balanceAfterCents !== facts.balanceCents) throw new Error("Account changed after this attempt; reconcile source evidence separately.");
    const agreement = input.agreements?.find((a) => a.id === op.agreementId);
    const part = agreement?.proposal.schedule[op.installment];
    if (!part || part.amountCents !== op.amountCents || part.date > localDate(new Date(now), facts.timezone)) throw new Error("Attempt does not match its saved due installment.");
    amountCents = op.amountCents; targetId = op.id;
    if (receiptId) receipt = { id: receiptId, invoiceId: facts.invoiceId, amountCents, date: localDate(new Date(now), facts.timezone), status: "settled", includedInBalance: true, provenance: "operator_decision", decisionId: command.id, operationId: op.id, agreementId: op.agreementId, reference: command.evidenceReference };
  } else if (command.action === "reconcile_record") {
    kind = "source_payment_reconciled";
    const payment = facts.payments.find((p) => p.id === command.paymentId && p.invoiceId === facts.invoiceId && p.status === "pending" && !p.includedInBalance && !p.reconciledBy);
    if (!payment || payment.date > localDate(new Date(now), facts.timezone)) throw new Error("Select an unresolved pending source payment for this invoice.");
    if (input.operations?.some((op) => ["pending", "unknown"].includes(op.outcome) && !decisions.some((d) => d.kind === "payment_reconciled" && d.targetId === op.id))) throw new Error("Resolve the simulated attempt first.");
    amountCents = payment.amountCents; targetId = payment.id; payment.reconciledBy = command.id;
    if (receiptId) receipt = { id: receiptId, invoiceId: facts.invoiceId, amountCents, date: localDate(new Date(now), facts.timezone), status: "settled", includedInBalance: true, provenance: "operator_decision", decisionId: command.id, reference: command.evidenceReference };
  } else if (command.action === "reverse_receipt") {
    kind = "receipt_reversed";
    const payment = facts.payments.find((p) => p.id === command.receiptId && p.invoiceId === facts.invoiceId && p.provenance && p.status === "settled" && p.includedInBalance && !p.reversedBy);
    if (!payment) throw new Error("Only an unreversed local receipt can be reversed; imported settled receipts are read-only.");
    const hold = paymentHold(facts, input.operations, undefined, undefined, decisions);
    if (hold) throw new Error(hold);
    amountCents = payment.amountCents; targetId = payment.id; delta = amountCents; payment.reversedBy = command.id;
  } else if (command.action === "approve_credit") {
    kind = "credit_approved";
    if (!reviewed?.review.accepted) throw new Error("Review the current case before approving a credit.");
    const hold = paymentHold(facts, input.operations, undefined, undefined, decisions);
    if (hold) throw new Error(hold);
    amountCents = command.amountCents; targetId = command.targetAuditId; delta = -amountCents;
    if (decisions.some((d) => d.kind === kind && d.targetId === targetId)) throw new Error("This reviewed credit was already decided.");
  } else {
    kind = "extension_approved";
    const update = input.caseUpdates?.findLast((u) => u.kind === "extension_requested");
    if (!update || update.kind !== "extension_requested" || update.sourceMessageId !== command.sourceMessageId || update.date < localDate(new Date(now), facts.timezone) || decisions.some((d) => d.kind === kind && d.targetId === command.sourceMessageId)) throw new Error("Select a current, undecided extension request.");
    amountCents = 0; targetId = command.sourceMessageId; extensionDate = update.date;
  }
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || kind !== "extension_approved" && amountCents === 0 || delta <= 0 && amountCents > facts.balanceCents) throw new Error("Amount exceeds the current balance or is invalid.");
  if (receipt) {
    if (facts.payments.length >= 100 || facts.payments.some((p) => p.id === receipt.id || p.operationId && p.operationId === receipt.operationId || receipt.reference && p.reference === receipt.reference)) throw new Error("Receipt may already be included or evidence limit reached.");
    delta = -amountCents;
    facts.payments.push(receipt);
  }
  if (delta || kind === "source_payment_reconciled") {
    facts.balanceCents += delta; facts.balanceAsOf = now; facts.sourceVersion = `${facts.sourceVersion}:operator:${command.id}`;
    if (!Number.isSafeInteger(facts.balanceCents) || facts.sourceVersion.length > 1024) throw new Error("Balance or source version limit reached.");
  }
  const decision: FinancialDecision = { id: command.id, kind, targetId, at: now, note: command.note, evidenceReference: command.evidenceReference, outcome, invoiceId: facts.invoiceId, amountCents, receiptId, balanceBeforeCents: input.facts.balanceCents, balanceAfterCents: facts.balanceCents, sourceVersionBefore: input.facts.sourceVersion, sourceVersionAfter: facts.sourceVersion, ...(extensionDate ? { extensionDate } : {}) };
  return { facts, decision };
}
