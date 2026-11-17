import { renderToStaticMarkup } from "react-dom/server";
import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { randomUUID } from "node:crypto";
import PaymentPanel from "../src/components/v2/PaymentPanel";
import { CaseRecords } from "../src/components/v2/BusinessDashboard";
import { calculateProposal } from "../src/lib/v2/options";
import { confirmPlan, nextPayment, simulatePayment, paymentHold } from "../src/lib/v2/payments";
import { CaseCommand, validateUpdates, type Investigation } from "../src/lib/v2/contracts";
import { startingCases } from "../src/lib/v2/fixtures";
import { investigate } from "../src/lib/v2/agents";
import { loadSourceInput, syntheticSource } from "../src/lib/v2/source";
import type { CaseState } from "../src/lib/v2/store";

const now = "2026-10-24T18:00:00Z", facts = startingCases(new Date(now))[1];
const proposal = calculateProposal(facts, now, { method: "card", count: 2, firstDate: "2026-10-24", sourceMessageId: "customer" });
const agreement = confirmPlan(randomUUID(), proposal, randomUUID(), facts, now);
const input: Investigation = { facts, now, messages: [{ id: "customer", speaker: "customer", channel: "customer", text: "Two card installments starting today", at: now }], verification: null };

test("confirmation preserves exact reviewed terms and receives no money", () => {
  expect(agreement.proposal).toEqual(proposal); expect(facts.balanceCents).toBe(7900);
  expect(() => confirmPlan("id", { ...proposal, policyVersion: "old" }, "audit", facts, now)).toThrow("outdated");
  expect(() => confirmPlan("id", proposal, "audit", { ...facts, balanceCents: 1 }, now)).toThrow("outdated");
});

test.each(["succeeded", "failed", "pending", "unknown"] as const)("%s processor result has honest accounting and immutable input", async (outcome) => {
  const before = structuredClone(facts), saved = simulatePayment(randomUUID(), agreement, facts, [], now, outcome);
  expect(saved.operation).toMatchObject({ outcome, amountCents: 3950, balanceBeforeCents: 7900, provenance: "simulated_processor" });
  expect(facts).toEqual(before);
  expect(saved.facts.balanceCents).toBe(outcome === "succeeded" ? 3950 : 7900);
  expect(saved.facts.payments.length).toBe(facts.payments.length + (outcome === "succeeded" ? 1 : 0));
  expect(!!saved.operation.receiptId).toBe(outcome === "succeeded");
  if (outcome === "succeeded") {
    expect(saved.facts.payments.at(-1)).toMatchObject({ provenance: "simulated_operation", operationId: saved.operation.id, agreementId: agreement.id, amountCents: 3950, includedInBalance: true });
    const savedInput = { ...input, facts: saved.facts, operations: [saved.operation] };
    expect((await loadSourceInput(savedInput, syntheticSource([saved.facts]))).input.facts).toEqual(saved.facts);
    await expect(loadSourceInput(savedInput, syntheticSource([facts]))).rejects.toMatchObject({ reason: "reconciliation_required" });
  }
  if (outcome === "pending" || outcome === "unknown") expect(() => nextPayment(agreement, saved.facts, [saved.operation], now)).toThrow("reconciliation");
  if (outcome === "failed") expect(nextPayment(agreement, saved.facts, [saved.operation], now).installment).toBe(0);
});

test("only the next due installment executes; own receipts reconcile without double counting", () => {
  const first = simulatePayment("first", agreement, facts, [], now, "succeeded");
  expect(() => nextPayment(agreement, first.facts, [first.operation], now)).toThrow("due 2026-11-24");
  const second = simulatePayment("second", agreement, first.facts, [first.operation], "2026-11-24T18:00:00Z", "succeeded");
  expect(second.facts.balanceCents).toBe(0); expect(second.operation.installment).toBe(1);
  expect(() => nextPayment(agreement, second.facts, [first.operation, second.operation], "2026-11-24T18:00:00Z")).toThrow("fully paid");
  expect(() => nextPayment(agreement, { ...facts, sourceVersion: "changed" }, [], now)).toThrow("account changed");
  expect(() => nextPayment(agreement, { ...facts, balanceCents: 7800 }, [], now)).toThrow("account changed");
});

test("cash receipt approval, existing pending records, stale policy and future dates cannot be bypassed", () => {
  const cash = confirmPlan("cash", calculateProposal(facts, now, { method: "cash", count: 2, firstDate: "2026-10-24", sourceMessageId: "customer" }), "audit", facts, now);
  expect(() => nextPayment(cash, facts, [], now)).toThrow("operator receipt approval");
  expect(paymentHold({ ...facts, payments: [{ id: "pending", invoiceId: facts.invoiceId, amountCents: 7900, status: "pending", includedInBalance: false, date: "2026-10-24" }] })).toContain("existing pending");
  const future = confirmPlan("future", calculateProposal(facts, now, { method: "card", count: 1, firstDate: "2026-10-25", sourceMessageId: "customer" }), "audit", facts, now);
  expect(() => nextPayment(future, facts, [], now)).toThrow("future payments");
  expect(() => nextPayment({ ...agreement, proposal: { ...proposal, policyVersion: "old" } }, facts, [], now)).toThrow("business policy");
});

test("financial commands cannot accept invented amount, approval, receipt or execution through chat", () => {
  const base = { id: randomUUID(), caseId: facts.id, action: "simulate_payment", revision: 1, agreementId: agreement.id, outcome: "succeeded" };
  expect(CaseCommand.safeParse(base).success).toBe(true);
  for (const extra of [{ amountCents: 1 }, { approved: true }, { receiptId: "fake" }, { outcome: "settled" }]) expect(CaseCommand.safeParse({ ...base, ...extra }).success).toBe(false);
  expect(() => validateUpdates([proposal], { ...input, paymentAction: { kind: "agreement_confirmed", id: agreement.id } })).toThrow("assessment cannot");
});

function state(): CaseState {
  return { ...input, updates: [proposal], agreements: [agreement], revision: 2, turns: 1, businessReplies: 0, stopped: false, takeover: false, status: "ready", requestId: null, run: null, events: [], activity: [], preferredChannel: null, commands: [], retries: 0, audit: [], lastReview: null };
}

test("payment controls distinguish consent, due actions, future dates and saved outcomes", () => {
  const c = state(), render = () => renderToStaticMarkup(<PaymentPanel c={c} busy={false} onConfirm={() => {}} onPay={() => {}} />);
  expect(render()).toContain("Simulate due payment of $39.50"); expect(render()).toContain("Demo processor outcome");
  expect(render()).not.toContain("Confirm this simulated plan");
  c.agreements = [];
  expect(render()).toContain("Confirm this simulated plan"); expect(render()).not.toContain("Simulate due payment");
  c.stopped = true; expect(render()).toMatch(/disabled=""[^>]*>Confirm this simulated plan/);
  c.stopped = false; c.agreements = [agreement];
  const saved = simulatePayment("pending", agreement, facts, [], now, "pending"); c.operations = [saved.operation];
  expect(render()).toContain("reconciliation"); expect(render()).not.toContain("Simulate due payment");
  const records = renderToStaticMarkup(<CaseRecords c={c} />);
  expect(records).toContain("Consent saved; this is not a receipt."); expect(records).toContain("No receipt or balance reduction at attempt time."); expect(records).not.toContain("Not agreed.");
  expect(records).toContain("Confirmed plan terms"); expect(records).not.toContain("Outdated; needs recalculation");
  c.agreements = [{ ...agreement, proposal: Object.fromEntries(Object.entries(proposal).reverse()) as typeof proposal }];
  expect(render()).not.toContain("Confirm this simulated plan");
  c.operations = []; c.now = "2026-10-23T18:00:00Z";
  expect(render()).toContain("future payments");
  expect(renderToStaticMarkup(<PaymentPanel c={c} now={now} busy={false} onConfirm={() => {}} onPay={() => {}} />)).toContain("Simulate due payment of $39.50");
});

const output = (value: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
test.each(["succeeded", "unknown"] as const)("agents assess saved %s evidence through SDK delegation without an execution tool", async (outcome) => {
  const saved = simulatePayment(randomUUID(), agreement, facts, [], now, outcome);
  let customerCalls = 0, resolutionCalls = 0;
  const model: Model = { async getResponse(request) {
    const context = JSON.stringify(request.input);
    expect(context).toContain(saved.operation.id); expect(context).toContain("simulated_processor");
    expect(request.tools.some((t) => /execute|simulate_payment|confirm_plan/.test(t.name))).toBe(false);
    if (request.systemInstructions?.includes("Independently challenge")) return output({ accepted: true, reasons: [] });
    if (request.systemInstructions?.includes("Interpret commitments")) { resolutionCalls++; return output({ summary: `${outcome}; no replay`, needsOperator: outcome === "unknown", updates: [] }); }
    if (++customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "assess", name: "account_resolution", arguments: JSON.stringify({ input: "Assess the saved processor result" }) }] };
    return output({ reply: outcome === "succeeded" ? "The simulated receipt records $39.50; $39.50 remains." : "The simulated outcome is unknown; an operator must reconcile it before another attempt.", needsOperator: outcome === "unknown" });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate({ ...input, facts: saved.facts, agreements: [agreement], operations: [saved.operation], paymentAction: { kind: "payment_attempted", id: saved.operation.id } }, model);
  expect(result.review.accepted).toBe(true); expect(resolutionCalls).toBe(1); expect(result.resolution?.updates).toEqual([]);
  expect(saved.facts.balanceCents).toBe(outcome === "succeeded" ? 3950 : 7900);
});
