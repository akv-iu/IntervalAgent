import { validateVerification, type Investigation, type Verification } from "../src/lib/v2/contracts";
import { startingCases } from "../src/lib/v2/fixtures";
import { requireInvestigableClaim, validatePaymentClaim } from "../src/lib/v2/claim";
import { investigate } from "../src/lib/v2/agents";
import { Usage, type Model, type ModelResponse } from "@openai/agents";

const now = "2026-10-26T18:00:00.000Z";
const input: Investigation = { facts: startingCases(new Date(now))[0], now, verification: null, messages: [
  { id: "opening", channel: "customer", speaker: "agent", text: "Invoice INV-101 has a recorded balance of $129.00. Have you paid?", at: now },
  { id: "claim", channel: "customer", speaker: "customer", text: "I have already made a payment", at: now },
  { id: "question", channel: "customer", speaker: "agent", text: "Do you mean invoice INV-101?", at: now },
  { id: "confirm", channel: "customer", speaker: "customer", text: "That's the one. I paid the full amount.", at: now },
] };
const paymentClaim = {
  businessId: input.facts.businessId, caseId: input.facts.id, sourceVersion: input.facts.sourceVersion,
  intent: "payment_claim" as const, claimMessageId: "claim", throughMessageId: "confirm",
  invoice: { value: "INV-101", evidence: [{ messageId: "question", quote: "Do you mean invoice INV-101?" }, { messageId: "confirm", quote: "That's the one." }] },
  amount: { value: 12900, evidence: [{ messageId: "opening", quote: "recorded balance of $129.00" }, { messageId: "confirm", quote: "I paid the full amount." }] },
  date: { value: null, evidence: [] }, uncertainties: ["Payment date is unknown"],
};
const pending: Verification = { claimMessageId: "claim", outcome: "awaiting_business", businessMessage: "Could you check the claimed $129 payment for INV-101? Its date is unknown.", summary: "Awaiting business evidence", amountCents: 12900, paymentDate: null, invoiceId: "INV-101", reference: null, settlementStatus: "unknown", missingFacts: ["date", "settlement"] };

test("contextual invoice confirmation and full amount can reach business verification with an unknown date", () => {
  expect(validateVerification(pending, { ...input, paymentClaim })).toEqual(pending);
});

test.each(["case", "business", "source", "quote", "foreign-message", "business-message", "agent-only", "future-message", "missing-evidence"])("rejects %s grounding errors without interpreting English in code", (kind) => {
  const claim = structuredClone(paymentClaim), context = structuredClone(input);
  if (kind === "case") claim.caseId = "another-case";
  if (kind === "business") claim.businessId = "another-business";
  if (kind === "source") claim.sourceVersion = "old-snapshot";
  if (kind === "quote") claim.invoice.evidence[1].quote = "Yes, I paid INV-101";
  if (kind === "foreign-message") claim.invoice.evidence[1].messageId = "not-in-this-conversation";
  if (kind === "business-message") context.messages.at(-1)!.channel = "business";
  if (kind === "agent-only") claim.invoice.evidence = [claim.invoice.evidence[0]];
  if (kind === "future-message") claim.throughMessageId = "claim";
  if (kind === "missing-evidence") claim.invoice.evidence = [];
  expect(() => validatePaymentClaim(claim, context)).toThrow();
});

test.each(["unclear", "not_payment_claim"] as const)("a model interpretation of %s cannot open an investigation", (intent) => {
  expect(() => requireInvestigableClaim({ ...paymentClaim, intent }, input)).toThrow("Clarify");
});

test("a different invoice is not silently normalized into this account", () => {
  expect(() => requireInvestigableClaim({ ...paymentClaim, invoice: { ...paymentClaim.invoice, value: "INV-1010" } }, input)).toThrow("matching invoice");
});

test("a later denial or correction invalidates an earlier interpretation before delegation or recognition", () => {
  const corrected: Investigation = { ...input, paymentClaim, messages: [...input.messages, { id: "correction", channel: "customer", speaker: "customer", text: "Actually, I have not sent it yet.", at: now }] };
  expect(() => requireInvestigableClaim(paymentClaim, corrected)).toThrow("Review newer messages");
  expect(() => validateVerification(pending, corrected)).toThrow("Review newer messages");
});

test("unknown customer terms cannot be invented in a business question", () => {
  expect(() => validateVerification({ ...pending, paymentDate: "2026-10-26" }, { ...input, paymentClaim })).toThrow("invent missing");
  expect(() => validateVerification({ ...pending, amountCents: 12800 }, { ...input, paymentClaim })).toThrow("invent missing");
});

test("a grounded claim still cannot substitute for a linked business reply", () => {
  expect(() => validateVerification({ ...pending, outcome: "business_confirmed", settlementStatus: "settled", paymentDate: "2026-10-26" }, { ...input, paymentClaim })).toThrow("actual linked reply");
});

function output(value: unknown): ModelResponse {
  return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}

test.each([12900, null])("the SDK passes one shared interpretation with amount %s and an unknown date to specialist and Reviewer in four calls", async (amount) => {
  const claim = { ...paymentClaim, amount: amount === null ? { value: null, evidence: [] } : paymentClaim.amount };
  const verification = { ...pending, amountCents: amount };
  const roles: string[] = [];
  let customerCalls = 0;
  const model: Model = { async getResponse(request) {
    const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
    const context = JSON.stringify(request.input);
    if (role === "business_verification" || role === "reviewer") {
      expect(context).toContain(JSON.stringify(claim).replaceAll('"', '\\"'));
      expect(context).toContain("Do you mean invoice INV-101?");
      expect(context).toContain("I paid the full amount.");
    }
    if (role === "business_verification") return output(verification);
    if (role === "reviewer") return output({ accepted: true, reasons: [] });
    if (++customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", name: "business_verification", callId: "interpret-and-delegate", arguments: JSON.stringify({ paymentClaim: claim }) }] };
    return output({ reply: "I asked Northside Fitness to check the claimed payment for INV-101; receipt is not confirmed.", needsOperator: false });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(input, model);
  expect(roles).toEqual(["customer", "business_verification", "customer", "reviewer"]);
  expect(result).toMatchObject({ paymentClaim: claim, verification, resolution: null, review: { accepted: true } });
});

test("Reviewer can reject a semantically wrong interpretation even when its quotations exist", async () => {
  const denial: Investigation = { ...input, messages: [...input.messages.slice(0, -1), { ...input.messages.at(-1)!, text: "That's the invoice, but I have not paid it." }] };
  const incorrect = { ...paymentClaim, invoice: { value: "INV-101", evidence: [{ messageId: "question", quote: "Do you mean invoice INV-101?" }, { messageId: "confirm", quote: "That's the invoice" }] }, amount: { value: null, evidence: [] } };
  expect(validatePaymentClaim(incorrect, denial)).toEqual(incorrect);
  let customerCalls = 0, reviews = 0;
  const model: Model = { async getResponse(request) {
    const role = request.modelSettings.providerData?.metadata?.agent_role;
    if (role === "business_verification") return output({ ...pending, amountCents: null });
    if (role === "reviewer") { reviews++; return output({ accepted: false, reasons: ["The latest customer message denies payment; the interpretation misreads negation."] }); }
    if (++customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", name: "business_verification", callId: "misinterpreted", arguments: JSON.stringify({ paymentClaim: incorrect }) }] };
    return output({ reply: "I asked the business to check.", needsOperator: false });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(denial, model);
  expect(result.review.accepted).toBe(false); expect(reviews).toBe(2);
  expect(result.paymentClaim).toEqual(incorrect);
});
