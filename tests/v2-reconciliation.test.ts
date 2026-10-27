import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { randomUUID } from "node:crypto";
import { investigate } from "../src/lib/v2/agents";
import { validateCurrentClaim } from "../src/lib/v2/claim";
import { validateUpdates } from "../src/lib/v2/contracts";
import { samReconciliation, agreedSamClaim } from "./helpers/v2-reconciliation";

const output = (value: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const tool = (name: string, args: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "function_call", name, callId: randomUUID(), arguments: JSON.stringify(name === "business_verification" ? { paymentClaim: args } : args) }] });

test("Sam's agreement refreshes the stale full-balance claim before review without an extra model call", async () => {
  const input = samReconciliation(), fresh = agreedSamClaim(input), roles: string[] = [];
  const model: Model = { async getResponse(request) {
    const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
    if (role === "reviewer") {
      expect(JSON.stringify(request.input)).toContain('\\"value\\":4000');
      expect(JSON.stringify(request.input)).toContain('\\"stance\\":\\"agrees\\"');
      return output({ accepted: true, reasons: [] });
    }
    return output({ reply: "Thanks for confirming the business's $40 report for INV-102.", needsOperator: false, paymentClaim: fresh });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(input, model);
  expect(result.paymentClaim).toEqual(fresh); expect(result.review.accepted).toBe(true);
  expect(roles).toEqual(["customer", "reviewer"]);
  expect(input.paymentClaim!.amount.value).toBe(7900);
});

test.each(["foreign-business", "later-business", "missing-confirmation", "stale-context"])("report agreement rejects %s evidence", (kind) => {
  const input = samReconciliation(), fresh = agreedSamClaim(input);
  if (kind === "foreign-business") fresh.reportResponse.businessMessageId = "other-workspace";
  if (kind === "later-business") input.messages.push({ id: fresh.reportResponse.businessMessageId = "future", channel: "business", speaker: "business", text: "40 received", requestId: input.requestId!, at: input.now });
  if (kind === "missing-confirmation") fresh.amount.evidence = [];
  if (kind === "stale-context") fresh.throughMessageId = input.messages[1].id;
  expect(() => validateCurrentClaim(fresh, input)).toThrow();
});

test("agreement can cite the linked business report plus the customer's contextual confirmation, never a report alone", () => {
  const input = samReconciliation(), claim = agreedSamClaim(input);
  claim.amount.evidence.push({ messageId: claim.reportResponse.businessMessageId, quote: "40 dollars paid" });
  expect(validateCurrentClaim(claim, input).amount.value).toBe(4000);
  claim.amount.evidence = claim.amount.evidence.filter((e) => e.messageId !== claim.throughMessageId);
  expect(() => validateCurrentClaim(claim, input)).toThrow("customer evidence");
});

test("SDK tool feedback exposes a mistyped report ID for repair instead of its generic error", async () => {
  const input = samReconciliation(), fresh = agreedSamClaim(input);
  let calls = 0;
  const model: Model = { async getResponse(request) {
    const role = request.modelSettings.providerData?.metadata?.agent_role;
    if (role === "business_verification") return output({ ...input.verification!, outcome: "needs_facts", businessMessage: "Was the $40 new and settled after the snapshot, and on what date?" });
    if (role === "reviewer") return output({ accepted: true, reasons: [] });
    if (++calls === 1) return tool("business_verification", { ...fresh, reportResponse: { ...fresh.reportResponse, businessMessageId: "mistyped-uuid" } });
    if (calls === 2) {
      expect(JSON.stringify(request.input)).toContain("Report response must cite");
      expect(JSON.stringify(request.input)).toContain(fresh.reportResponse.businessMessageId);
      return tool("business_verification", fresh);
    }
    return output({ reply: "Thank you; we asked the business for the remaining receipt details.", needsOperator: false, paymentClaim: fresh });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(input, model);
  expect(result.review.accepted).toBe(true); expect(result.paymentClaim).toEqual(fresh);
  expect(result.activity.filter((a) => a.action === "delegated")).toHaveLength(1);
});

test("agreement goes back to the business for only the missing financial facts, then complete confirmation supports one $40 recognition", async () => {
  const input = samReconciliation(), fresh = agreedSamClaim(input), roles: string[] = [];
  const followup = { ...input.verification!, outcome: "needs_facts" as const, businessMessage: "Was the $40 received and settled today, 2026-10-26, after the snapshot, and not already included in the $79 balance or its $50 receipt?" };
  let customerCalls = 0;
  const model: Model = { async getResponse(request) {
    const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
    if (role === "business_verification") { expect(JSON.stringify(request.input)).toContain('\\"stance\\":\\"agrees\\"'); return output(followup); }
    if (role === "reviewer") return output({ accepted: true, reasons: [] });
    if (++customerCalls === 1) return tool("business_verification", fresh);
    return output({ reply: "Thanks for confirming the $40. We asked the business to confirm the remaining receipt details before updating the balance.", needsOperator: false, paymentClaim: fresh });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const pending = await investigate(input, model);
  expect(pending).toMatchObject({ paymentClaim: fresh, verification: followup, review: { accepted: true }, draft: { needsOperator: false } });
  expect(roles).toEqual(["customer", "business_verification", "customer", "reviewer"]);
  const confirmed = { ...followup, outcome: "business_confirmed" as const, businessMessage: null, paymentDate: "2026-10-26", settlementStatus: "settled" as const, missingFacts: [] };
  const replyInput = { ...input, paymentClaim: fresh, verification: followup, messages: [...input.messages, { id: "followup", channel: "business" as const, speaker: "agent" as const, text: followup.businessMessage, requestId: input.requestId!, at: input.now }, { id: "new-confirmation", channel: "business" as const, speaker: "business" as const, text: "Yes, new $40 received and settled today; not included in the $79 or the prior $50 receipt.", requestId: input.requestId!, at: input.now }] };
  const update = { kind: "payment_recognized" as const, sourceMessageId: fresh.claimMessageId, businessMessageId: "new-confirmation", invoiceId: input.facts.invoiceId, amountCents: 4000, date: "2026-10-26", reference: null };
  let calls = 0;
  const resolutionModel: Model = { async getResponse(request) {
    const role = request.modelSettings.providerData?.metadata?.agent_role;
    if (role === "business_verification") return output(confirmed);
    if (role === "account_resolution") { expect(JSON.stringify(request.input)).toContain('\\"value\\":4000'); return output({ summary: "Record the new business-confirmed $40 once", needsOperator: false, updates: [update] }); }
    if (role === "reviewer") return output({ accepted: true, reasons: [] });
    if (++calls === 1) return tool("business_verification", fresh);
    if (calls === 2) return tool("account_resolution", { input: "Reconcile the new confirmed payment", paymentClaim: null });
    return output({ reply: "The confirmed $40 payment was recorded; $39 remains for INV-102.", needsOperator: false, paymentClaim: null });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(replyInput, resolutionModel);
  expect(result.review.accepted).toBe(true);
  expect(result.paymentClaim).toEqual(fresh);
  expect(validateUpdates(result.resolution!.updates, { ...replyInput, verification: result.verification, paymentClaim: result.paymentClaim })).toEqual([update]);
  expect(() => validateUpdates([update], { ...replyInput, verification: followup })).toThrow("business confirmation");
  expect(() => validateUpdates([update], { ...replyInput, verification: confirmed, facts: { ...input.facts, balanceCents: 3900 } })).toThrow("exceeds");
});
