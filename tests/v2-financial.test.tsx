import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { CaseCommand, type Investigation, type InvestigationResult } from "../src/lib/v2/contracts";
import { startingCases } from "../src/lib/v2/fixtures";
import { calculateProposal } from "../src/lib/v2/options";
import { confirmPlan, effectiveOperations, nextPayment, paymentHold, simulatePayment } from "../src/lib/v2/payments";
import { decideFinancial, recognitionCandidate } from "../src/lib/v2/financial";
import { investigate } from "../src/lib/v2/agents";
import { loadSourceInput, syntheticSource } from "../src/lib/v2/source";
import FinancialReview from "../src/components/v2/FinancialReview";
import { CaseRecords } from "../src/components/v2/BusinessDashboard";
import type { CaseState } from "../src/lib/v2/store";

const now = "2026-10-24T18:00:00Z", facts = startingCases(new Date(now))[0];
const proposal = calculateProposal(facts, now, { method: "card", count: 2, firstDate: "2026-10-24", sourceMessageId: "claim" });
const agreement = confirmPlan(randomUUID(), proposal, randomUUID(), facts, now);
const base: Investigation = { facts, messages: [{ id: "claim", channel: "customer", speaker: "customer", text: "Two payments starting today", at: now }], now, verification: null, agreements: [agreement] };
const evidence = { note: "Checked the synthetic processor's settlement evidence.", evidenceReference: "settlement-demo-1" };
function unresolved(outcome: "pending" | "unknown" = "unknown") {
  const saved = simulatePayment(randomUUID(), agreement, facts, [], now, outcome);
  const input = { ...base, facts: saved.facts, operations: [saved.operation] };
  const command = { id: randomUUID(), caseId: facts.id, action: "reconcile_payment" as const, revision: 1, operationId: saved.operation.id, outcome: "succeeded" as const, ...evidence };
  return { input, command };
}

test.each(["pending", "unknown"] as const)("%s reconciliation keeps the original attempt and advances the existing plan only on settlement", async (prior) => {
  for (const outcome of ["succeeded", "failed"] as const) {
    const { input, command } = unresolved(prior), original = structuredClone(input);
    const saved = decideFinancial(input, null, { ...command, outcome }, now);
    expect(input).toEqual(original);
    expect(saved.facts.balanceCents).toBe(outcome === "succeeded" ? 6450 : 12900);
    expect(saved.facts.payments).toHaveLength(outcome === "succeeded" ? 1 : 0);
    const context = { ...input, facts: saved.facts, financialDecisions: [saved.decision] };
    expect(effectiveOperations(context.operations, context.financialDecisions)[0].outcome).toBe(outcome);
    expect(paymentHold(context.facts, context.operations, null, null, context.financialDecisions)).toBeNull();
    if (outcome === "succeeded") {
      expect(() => nextPayment(agreement, context.facts, context.operations, now, context.financialDecisions)).toThrow("due 2026-11-24");
      await expect(loadSourceInput(context, syntheticSource([facts]))).rejects.toMatchObject({ reason: "reconciliation_required" });
      expect((await loadSourceInput(context, syntheticSource([saved.facts]))).input.facts.payments[0].decisionId).toBe(command.id);
    } else expect(nextPayment(agreement, context.facts, context.operations, now, context.financialDecisions).amountCents).toBe(6450);
    expect(() => decideFinancial(context, null, { ...command, id: randomUUID() }, now)).toThrow("unresolved");
  }
});

test.each(["missing-operation", "changed-source", "changed-balance", "wrong-invoice", "wrong-installment", "already-settled"])("%s cannot be reconciled into a receipt", (kind) => {
  const { input, command } = unresolved();
  if (kind === "missing-operation") command.operationId = randomUUID();
  if (kind === "changed-source") input.facts.sourceVersion = "new-source";
  if (kind === "changed-balance") input.facts.balanceCents--;
  if (kind === "wrong-invoice") input.operations[0].invoiceId = "OTHER";
  if (kind === "wrong-installment") input.operations[0].installment = 99;
  if (kind === "already-settled") input.operations[0].outcome = "succeeded";
  expect(() => decideFinancial(input, null, command, now)).toThrow();
  expect(input.facts.payments).toHaveLength(0);
});

function businessEvidence() {
  const scoped = startingCases(new Date(now)).find((f) => f.id === "cedar-late-payment")!;
  const requestId = randomUUID();
  const verification: NonNullable<Investigation["verification"]> = { claimMessageId: "claim", outcome: "business_confirmed", businessMessage: null, summary: "The business confirms $50 received and settled today", amountCents: 5000, paymentDate: "2026-10-24", invoiceId: scoped.invoiceId, reference: "business-receipt", settlementStatus: "settled", missingFacts: [] };
  const input: Investigation = { facts: scoped, now, requestId, verification, messages: [{ id: "claim", channel: "customer", speaker: "customer", text: `I paid $50 today for ${scoped.invoiceId}`, at: now }, { id: "reply", channel: "business", speaker: "business", text: "Yes, $50 settled today", at: now, requestId }] };
  const reviewed: InvestigationResult = { verification, draft: { reply: "Operator approval is required before recording this payment.", needsOperator: true }, resolution: { summary: "Approval required", needsOperator: true, updates: [] }, review: { accepted: true, reasons: [] }, activity: [] };
  const command = { id: randomUUID(), caseId: scoped.id, action: "approve_recognition" as const, revision: 1, targetAuditId: randomUUID(), ...evidence };
  return { input, reviewed, command };
}

test("operator approval keeps matching/duplicate/date guards and distinct receipt provenance", () => {
  const { input, reviewed, command } = businessEvidence(), original = structuredClone(input);
  expect(recognitionCandidate(input, reviewed).amountCents).toBe(5000);
  const saved = decideFinancial(input, reviewed, command, now);
  expect(input).toEqual(original); expect(saved.facts.balanceCents).toBe(13500);
  expect(saved.facts.payments[0]).toMatchObject({ provenance: "operator_decision", decisionId: command.id, requestId: input.requestId, businessMessageId: "reply" });
  expect(() => decideFinancial({ ...input, facts: saved.facts, financialDecisions: [saved.decision] }, reviewed, { ...command, id: randomUUID() }, now)).toThrow();
  for (const outcome of ["business_reported", "pending", "not_found", "conflicting"] as const) expect(() => recognitionCandidate(input, { ...reviewed, verification: { ...reviewed.verification!, outcome } })).toThrow();
  expect(() => recognitionCandidate(input, { ...reviewed, review: { accepted: false, reasons: ["Unverified"] } })).toThrow();
  input.verification!.paymentDate = "2099-01-01";
  expect(() => recognitionCandidate(input, reviewed)).toThrow();
});

test("financial command inputs cannot forge amounts, receipts, authority or unsettled outcomes", () => {
  const { command } = unresolved();
  expect(CaseCommand.safeParse(command).success).toBe(true);
  for (const extra of [{ amountCents: 1 }, { receiptId: "fake" }, { approved: true }, { outcome: "pending" }, { note: " " }, { evidenceReference: " " }]) expect(CaseCommand.safeParse({ ...command, ...extra }).success).toBe(false);
});

test("credits are not receipts and a local receipt reversal is a single compensating entry", () => {
  const result: InvestigationResult = { verification: null, resolution: null, draft: { reply: "An operator can review the request", needsOperator: true }, review: { accepted: true, reasons: [] }, activity: [] };
  const credit = { ...evidence, id: randomUUID(), caseId: facts.id, revision: 1, action: "approve_credit" as const, targetAuditId: randomUUID(), amountCents: 1000 };
  const reduced = decideFinancial(base, result, credit, now);
  expect(reduced.facts.balanceCents).toBe(11900); expect(reduced.facts.payments).toEqual([]);
  expect(() => decideFinancial({ ...base, facts: reduced.facts, financialDecisions: [reduced.decision] }, result, { ...credit, id: randomUUID() }, now)).toThrow("already decided");
  expect(() => decideFinancial(base, result, { ...credit, amountCents: 12901 }, now)).toThrow("exceeds");
  const paid = simulatePayment(randomUUID(), agreement, facts, [], now, "succeeded");
  const reverse = { ...evidence, id: randomUUID(), caseId: facts.id, revision: 1, action: "reverse_receipt" as const, receiptId: paid.operation.receiptId! };
  const restored = decideFinancial({ ...base, facts: paid.facts, operations: [paid.operation] }, null, reverse, now);
  expect(restored.facts.balanceCents).toBe(12900); expect(restored.facts.payments).toHaveLength(1); expect(restored.facts.payments[0].reversedBy).toBe(reverse.id);
  expect(restored.decision.receiptId).toBeNull(); expect(paid.facts.payments[0].reversedBy).toBeUndefined();
  expect(() => decideFinancial({ ...base, facts: restored.facts }, null, { ...reverse, id: randomUUID() }, now)).toThrow("unreversed local");
  expect(() => nextPayment(agreement, restored.facts, [paid.operation], now)).toThrow("account changed");
  const single = confirmPlan(randomUUID(), calculateProposal(facts, now, { method: "card", count: 1, firstDate: "2026-10-24", sourceMessageId: "claim" }), randomUUID(), facts, now);
  const full = simulatePayment(randomUUID(), single, facts, [], now, "succeeded");
  const undone = decideFinancial({ ...base, facts: full.facts }, null, { ...reverse, id: randomUUID(), receiptId: full.operation.receiptId! }, now);
  expect(() => nextPayment(single, undone.facts, [full.operation], now)).toThrow("account changed");
});

test.each(["succeeded", "failed"] as const)("imported pending payment resolves as %s with original facts retained and explicit operator provenance", async (outcome) => {
  const pending = startingCases(new Date(now)).find((f) => f.id === "pending-payment")!;
  const value = { ...evidence, id: randomUUID(), caseId: pending.id, revision: 1, action: "reconcile_record" as const, paymentId: pending.payments[0].id, outcome };
  const saved = decideFinancial({ ...base, facts: pending, agreements: [] }, null, value, now);
  expect(saved.facts.payments[0]).toMatchObject({ status: "pending", includedInBalance: false, reconciledBy: value.id });
  expect(pending.payments[0].reconciledBy).toBeUndefined(); expect(saved.facts.balanceCents).toBe(outcome === "succeeded" ? 0 : 9900);
  expect(paymentHold(saved.facts)).toBeNull(); expect(saved.facts.payments).toHaveLength(outcome === "succeeded" ? 2 : 1);
  expect((await loadSourceInput({ ...base, facts: saved.facts }, syntheticSource([saved.facts]))).input.facts).toEqual(saved.facts);
  expect(() => decideFinancial({ ...base, facts: saved.facts }, null, { ...value, id: randomUUID() }, now)).toThrow("unresolved pending");
});

test("only the latest current extension can be approved and it does not reschedule an agreement", () => {
  const input: Investigation = { ...base, caseUpdates: [{ kind: "extension_requested", sourceMessageId: "claim", date: "2026-10-25" }] };
  const value = { ...evidence, id: randomUUID(), caseId: facts.id, revision: 1, action: "approve_extension" as const, sourceMessageId: "claim" };
  const saved = decideFinancial(input, null, value, now);
  expect(saved.facts).toEqual(facts); expect(saved.decision.extensionDate).toBe("2026-10-25"); expect(saved.decision.receiptId).toBeNull();
  const html = renderToStaticMarkup(<CaseRecords c={{ facts, now, updates: input.caseUpdates!, events: [], preferredChannel: null, financialDecisions: [saved.decision] }} />);
  expect(html).toContain("Approved by operator."); expect(html).not.toContain("Not approved.");
  expect(() => decideFinancial({ ...input, financialDecisions: [saved.decision] }, null, { ...value, id: randomUUID() }, now)).toThrow("undecided");
  input.caseUpdates!.push({ kind: "extension_requested", sourceMessageId: "newer", date: "2026-10-26" });
  expect(() => decideFinancial(input, null, value, now)).toThrow("undecided");
});

test("business approval control requires takeover and the latest reviewed message", () => {
  const { input, reviewed, command } = businessEvidence();
  const c = { ...input, revision: 1, takeover: false, stopped: false, run: null, lastReview: reviewed, audit: [{ id: command.targetAuditId, sourceVersion: input.facts.sourceVersion, sourceMessageIds: ["claim", "reply"] }] } as unknown as CaseState;
  const render = () => renderToStaticMarkup(<FinancialReview c={c} now={now} busy={false} onDecide={async () => true} />);
  expect(render()).toContain("Approve existing payment"); expect(render()).toMatch(/<input[^>]*\sdisabled="/);
  c.takeover = true; expect(render()).not.toMatch(/<input[^>]*\sdisabled="/);
  expect(render()).toMatch(/<button[^>]*\sdisabled="/);
  c.messages.push({ id: "new-evidence", channel: "customer", speaker: "customer", text: "The business response is wrong", at: now });
  expect(render()).toContain("Review newer messages"); expect(render()).not.toContain("Approve existing payment");
});

test("operator panel separates takeover/evidence and retains honest original versus reconciled records", () => {
  const { input, command } = unresolved(), saved = decideFinancial(input, null, command, now);
  const c = { ...input, revision: 2, takeover: false, stopped: false, run: null, lastReview: null, audit: [], updates: [], events: [], preferredChannel: null } as unknown as CaseState;
  let html = renderToStaticMarkup(<FinancialReview c={c} now={now} busy={false} onDecide={async () => true} />);
  expect(html).toContain("Take over this case"); expect(html).toContain("Evidence reference"); expect(html).toMatch(/<button[^>]*\sdisabled="/);
  c.takeover = true; c.financialDecisions = [saved.decision]; c.facts = saved.facts;
  html = renderToStaticMarkup(<FinancialReview c={c} now={now} busy={false} onDecide={async () => true} />);
  expect(html).toContain("settlement-demo-1"); expect(html).not.toContain("Save reconciliation");
  html = renderToStaticMarkup(<CaseRecords c={c} />);
  expect(html).toContain("unknown"); expect(html).toContain("payment reconciled"); expect(html).toContain("Operator-authorized simulated receipt"); expect(html).not.toContain("Operator reconciliation required before another attempt");
});

const output = (value: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
test("SDK roles see original and reconciled evidence; reviewed explanation has no financial execution tools", async () => {
  const { input, command } = unresolved(), saved = decideFinancial(input, null, command, now);
  let resolutionCalls = 0, customerCalls = 0;
  const model: Model = { async getResponse(request) {
    const context = JSON.stringify(request.input);
    expect(context).toContain(saved.decision.id); expect(context).toContain("originalOperations"); expect(context).toContain("financialDecisions");
    expect(request.tools.some((t) => /approve_recognition|reconcile_payment|simulate_payment/.test(t.name))).toBe(false);
    if (request.systemInstructions?.includes("Independently challenge")) return output({ accepted: true, reasons: [] });
    if (request.systemInstructions?.includes("Interpret commitments")) { resolutionCalls++; return output({ summary: "Operator reconciliation saved; do not replay it", needsOperator: false, updates: [] }); }
    if (++customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "assess", name: "account_resolution", arguments: JSON.stringify({ input: "Assess the saved operator decision" }) }] };
    return output({ reply: "The operator recorded the simulated receipt; $64.50 remains.", needsOperator: false });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate({ ...input, facts: saved.facts, financialDecisions: [saved.decision], paymentAction: { kind: "financial_decided", id: command.id } }, model);
  expect(result.review.accepted).toBe(true); expect(resolutionCalls).toBe(1);
});
