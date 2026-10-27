import raw from "../fixtures/v2/business-confirmation-20261026-1/jordan.json";
import { validateCurrentClaim } from "../src/lib/v2/claim";
import { recognitionBalance, validateUpdates, type Investigation, type Verification } from "../src/lib/v2/contracts";
import { investigate } from "../src/lib/v2/agents";
import { boundedModel } from "../src/lib/v2/model";
import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { randomUUID } from "node:crypto";

export const jordan = () => structuredClone(raw) as Investigation;
test("a customer's response stays linked to the report it answered across later business follow-ups", () => {
  const input = jordan(), claim = input.paymentClaim!;
  claim.reportResponse!.businessMessageId = input.messages[4].id;
  expect(validateCurrentClaim(claim, input).amount.value).toBe(5000);
});

function correctionInput() {
  const input = jordan(), original = input.messages[4];
  input.facts.balanceCents = 4900; input.facts.balanceAsOf = input.now;
  input.facts.sourceVersion += ":recognized:original";
  input.paymentClaim!.sourceVersion = input.facts.sourceVersion;
  input.paymentClaim!.reportResponse!.businessMessageId = original.id;
  const receipt = { id: "local-business-receipt", amountCents: 8000, invoiceId: "INV-103", date: "2026-10-26", status: "settled" as const, includedInBalance: true, provenance: "business_confirmation" as const, requestId: input.requestId!, businessMessageId: original.id, reference: null };
  input.facts.payments = [receipt];
  const recognized = { kind: "payment_recognized" as const, amountCents: 8000, date: receipt.date, invoiceId: receipt.invoiceId, sourceMessageId: input.paymentClaim!.claimMessageId, businessMessageId: original.id, reference: null };
  input.caseUpdates = [recognized];
  const update = { ...recognized, amountCents: 5000, businessMessageId: input.messages.at(-1)!.id, replacesReceiptId: receipt.id };
  input.verification = { ...input.verification!, outcome: "business_confirmed", amountCents: 5000, paymentDate: receipt.date, settlementStatus: "settled", businessMessage: null, missingFacts: [] };
  return { input, update };
}

test("a corrected total replaces the active local receipt instead of deducting a second payment", () => {
  const { input, update } = correctionInput();
  expect(validateUpdates([update], input)).toEqual([update]);
  expect(recognitionBalance(input.facts, update)).toBe(7900);
  expect(input.facts.payments[0].amountCents).toBe(8000);
});

test.each(["imported", "operator", "simulated", "reversed", "other-request", "wrong-date", "stale-reply", "unknown-receipt", "no-original-update", "too-large", "no-policy", "pending"])("%s cannot authorize an automatic receipt correction", (kind) => {
  const { input, update } = correctionInput(), receipt = input.facts.payments[0];
  if (kind === "imported") delete receipt.provenance;
  if (kind === "operator") receipt.provenance = "operator_decision";
  if (kind === "simulated") receipt.provenance = "simulated_operation";
  if (kind === "reversed") receipt.reversedBy = "already-reversed";
  if (kind === "other-request") receipt.requestId = "another-request";
  if (kind === "wrong-date") update.date = input.verification!.paymentDate = "2026-10-25";
  if (kind === "stale-reply") update.businessMessageId = receipt.businessMessageId!;
  if (kind === "unknown-receipt") update.replacesReceiptId = "not-here";
  if (kind === "no-original-update") input.caseUpdates = [];
  if (kind === "too-large") update.amountCents = input.verification!.amountCents = 20000;
  if (kind === "no-policy") input.facts.recognitionPolicy = "operator_review";
  if (kind === "pending") input.verification!.settlementStatus = "pending";
  expect(() => validateUpdates([update], input)).toThrow();
});

const output = (value: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const call = (name: string, args: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "function_call", name, callId: randomUUID(), arguments: JSON.stringify(args) }] });

test("Jordan's full history repairs one invalid report reference then completes business reconciliation within the unchanged context bound", async () => {
  const input = jordan(), bytes: number[] = [], roles: string[] = [];
  const v: Verification = { ...input.verification!, outcome: "business_confirmed", amountCents: 5000, paymentDate: "2026-10-26", settlementStatus: "settled", businessMessage: null, missingFacts: [] };
  const update = { kind: "payment_recognized", amountCents: 5000, date: v.paymentDate, invoiceId: "INV-103", reference: null, sourceMessageId: input.paymentClaim!.claimMessageId, businessMessageId: input.messages.at(-1)!.id };
  let customer = 0;
  const scripted: Model = { async getResponse(request) {
    bytes.push(Buffer.byteLength(JSON.stringify(request), "utf8"));
    const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
    if (role === "business_verification") return output(v);
    if (role === "account_resolution") return output({ summary: "The business confirmed the corrected $50; $79 remains", needsOperator: false, updates: [update] });
    if (role === "reviewer") return output({ accepted: true, reasons: [] });
    if (++customer === 1) return call("business_verification", { paymentClaim: { ...input.paymentClaim, reportResponse: { stance: "disputes", businessMessageId: input.messages.at(-1)!.id } } });
    if (customer === 2) return call("business_verification", { paymentClaim: null });
    if (customer === 3) return call("account_resolution", { input: "Record the business-confirmed $50", paymentClaim: null });
    return output({ reply: "Northside confirmed $50 received for INV-103; $79 remains.", needsOperator: false, paymentClaim: null });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(input, boundedModel({ apiKey: "scripted", model: scripted, reserve: async () => {}, record: async () => {} }));
  expect(result.review.accepted).toBe(true); expect(result.draft.needsOperator).toBe(false);
  expect(Math.max(...bytes)).toBeLessThan(32000);
  expect(roles).toEqual(["customer", "customer", "business_verification", "customer", "account_resolution", "customer", "reviewer"]);
  expect(validateUpdates(result.resolution!.updates, { ...input, verification: result.verification, paymentClaim: result.paymentClaim })).toHaveLength(1);
});
