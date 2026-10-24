import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { calculateProposal, paymentOptions, PaymentProposal, proposalIsCurrent } from "../src/lib/v2/options";
import { CaseCommand, CaseUpdate, validateUpdates, type Investigation } from "../src/lib/v2/contracts";
import { startingCases } from "../src/lib/v2/fixtures";
import { investigate } from "../src/lib/v2/agents";
import { boundedModel } from "../src/lib/v2/model";

const now = "2026-10-23T18:00:00Z";
const facts = startingCases(new Date(now))[1];
const terms = { method: "cash" as const, count: 2, firstDate: "2026-10-24", sourceMessageId: "request" };
const input: Investigation = { facts, now, verification: null, messages: [{ id: "request", channel: "customer", speaker: "customer", text: "Can I pay cash in two monthly installments starting tomorrow?", at: now }] };

test("business policies are separate, cloned, and never default an unknown business", () => {
  const northside = paymentOptions(facts), cedar = paymentOptions({ ...facts, businessId: "cedar" });
  expect(northside).toMatchObject({ status: "available", methods: ["card", "bank_transfer", "cash"], counts: [1, 2, 3], addedFeesCents: 0, executionEnabled: false, agreementEnabled: false });
  expect(cedar).toMatchObject({ status: "available", methods: ["card", "bank_transfer"], counts: [1, 2, 3, 4, 6] });
  if (northside.status === "available") northside.methods.length = 0;
  expect(paymentOptions(facts)).toMatchObject({ methods: ["card", "bank_transfer", "cash"] });
  expect(paymentOptions({ ...facts, businessId: "constructor" }).status).toBe("unavailable");
});

test.each([1, 2, 3])("%i installments keep every cent, including uneven splits", (count) => {
  const proposal = calculateProposal({ ...facts, balanceCents: 7901 }, now, { ...terms, count });
  expect(proposal.schedule.reduce((sum, p) => sum + p.amountCents, 0)).toBe(7901);
  expect(proposal.schedule.every((p) => Number.isSafeInteger(p.amountCents) && p.amountCents > 0)).toBe(true);
  expect(proposal.schedule.at(-1)!.amountCents - proposal.schedule[0].amountCents).toBeLessThanOrEqual(1);
});

test("monthly dates clamp month ends without drifting and include leap day", () => {
  const value = { ...terms, count: 3, firstDate: "2028-01-31" };
  expect(calculateProposal(facts, "2028-01-10T18:00:00Z", value).schedule.map((p) => p.date)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  expect(calculateProposal(facts, "2027-01-10T18:00:00Z", { ...value, firstDate: "2027-01-31" }).schedule.map((p) => p.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
});

test.each([
  { ...terms, count: 4 }, { ...terms, count: 0 }, { ...terms, count: 2.5 }, { ...terms, method: "crypto" },
  { ...terms, firstDate: "2026-10-22" }, { ...terms, firstDate: "2026-11-23" }, { ...terms, firstDate: "2026-02-30" },
])("unsupported terms are rejected: %j", (value) => {
  expect(() => calculateProposal(facts, now, value as typeof terms)).toThrow();
});

test("date limits use the business-local day and Cedar has its own methods/start horizon", () => {
  expect(calculateProposal(facts, "2026-10-24T02:00:00Z", { ...terms, firstDate: "2026-10-23" }).schedule[0].date).toBe("2026-10-23");
  expect(calculateProposal({ ...facts, businessId: "cedar" }, now, { ...terms, method: "bank_transfer", count: 6, firstDate: "2026-12-07" }).schedule).toHaveLength(6);
  expect(() => calculateProposal({ ...facts, businessId: "cedar" }, now, terms)).toThrow("business policy");
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1])("bad balances or sub-cent installments are rejected: %s", (balanceCents) => {
  expect(() => calculateProposal({ ...facts, balanceCents }, now, terms)).toThrow();
});

test("guarded proposals bind exact arithmetic to policy, source, invoice, balance and customer evidence", () => {
  const proposal = calculateProposal(facts, now, terms);
  expect(validateUpdates([proposal], input)).toEqual([proposal]);
  for (const forged of [
    { ...proposal, policyVersion: "other" }, { ...proposal, sourceVersion: "old" }, { ...proposal, invoiceId: "OTHER" }, { ...proposal, balanceCents: 1 },
    { ...proposal, schedule: [{ ...proposal.schedule[0], amountCents: 1 }, proposal.schedule[1]] },
    { ...proposal, schedule: [{ ...proposal.schedule[0], date: "2026-10-25" }, proposal.schedule[1]] },
  ]) expect(() => validateUpdates([forged], input)).toThrow("calculated schedule");
  expect(() => validateUpdates([{ ...proposal, sourceMessageId: "foreign" }], input)).toThrow("customer source");
  expect(() => validateUpdates([proposal], { ...input, messages: [{ ...input.messages[0], speaker: "business", channel: "business" }] })).toThrow("customer source");
  expect(proposalIsCurrent(proposal, { ...facts, balanceCents: 1 }, now)).toBe(false);
  expect(proposalIsCurrent(proposal, facts, "2026-10-25T18:00:00Z")).toBe(false);
  expect(() => validateUpdates([proposal, proposal], input)).toThrow("one current proposal");
  expect(PaymentProposal.safeParse({ ...proposal, approved: true }).success).toBe(false);
  expect(CaseUpdate.safeParse({ ...proposal, kind: "arrangement_approved" }).success).toBe(false);
  expect(CaseCommand.safeParse({ id: "00000000-0000-4000-8000-000000000001", caseId: facts.id, action: "pay", proposal }).success).toBe(false);
  expect(() => validateUpdates([proposal, { kind: "payment_recognized", amountCents: 1, date: terms.firstDate, invoiceId: facts.invoiceId, reference: null, sourceMessageId: "request", businessMessageId: "business" }], input)).toThrow("separately from payment recognition");
});

function output(value: unknown): ModelResponse {
  return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}
function call(name: string, args: unknown): ModelResponse {
  return { usage: new Usage(), output: [{ type: "function_call", callId: name, name, arguments: JSON.stringify(args) }] };
}

test("simple options stay with the orchestrator; no forced specialist pipeline", async () => {
  let calls = 0;
  const model: Model = { async getResponse(request) {
    calls++;
    if (request.systemInstructions?.includes("Independently challenge")) return output({ accepted: true, reasons: [] });
    expect(request.systemInstructions).toContain("Own the customer");
    expect(JSON.stringify(request.input)).toContain("northside-options-1");
    return output({ reply: "Card, bank transfer or cash; one payment or two/three monthly installments. What works for you?", needsOperator: false });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(input, model);
  expect(result.review.accepted).toBe(true); expect(result.resolution).toBeNull();
  expect(result.activity.map((a) => a.role)).toEqual(["reviewer"]); expect(calls).toBe(2);
});

test.each([true, false])("model-selected specialist calculates a proposal and Reviewer acceptance=%s controls publication eligibility", async (accepted) => {
  const proposal = calculateProposal(facts, now, terms), requests: ModelRequest[] = [];
  let customerCalls = 0, accountCalls = 0;
  const model: Model = { async getResponse(request) {
    requests.push(request);
    if (request.systemInstructions?.includes("Independently challenge")) {
      expect(JSON.stringify(request.input)).toContain("northside-options-1");
      return output({ accepted, reasons: accepted ? [] : ["Customer preference needs clarification"] });
    }
    if (request.systemInstructions?.includes("Interpret commitments")) {
      const step = ++accountCalls;
      expect(JSON.stringify(request.input)).toContain("northside-options-1");
      expect(JSON.stringify(request.input)).toContain("2026-10-24");
      expect(request.tools.some((t) => t.name === "get_payment_options")).toBe(false);
      if (step === 1) return call("calculate_payment_proposal", terms);
      expect(JSON.stringify(request.input)).toContain("3950");
      return output({ summary: "Two monthly cash payments proposed; not agreed", needsOperator: false, updates: [proposal] });
    }
    if (++customerCalls === 1) return call("account_resolution", { input: "Calculate the requested cash plan beginning tomorrow" });
    return output({ reply: "A proposal is $39.50 on October 24 and $39.50 on November 24, in cash. This is not yet an agreement; no payment has been received.", needsOperator: false });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  let reserved = 0;
  const result = await investigate(input, boundedModel({ apiKey: "unused", model, reserve: async () => { reserved++; }, record: () => {} }));
  expect(result.review.accepted).toBe(accepted); expect(result.resolution?.updates).toEqual([proposal]);
  expect(result.activity).toContainEqual(expect.objectContaining({ role: "account_resolution", action: "proposal_calculated" }));
  expect(result.activity.some((a) => a.role === "business_verification")).toBe(false);
  expect(requests.length).toBe(accepted ? 5 : 7); expect(reserved).toBe(requests.length); expect(accountCalls).toBe(2);
});

test("an invalid specialist schedule cannot be accepted even if the scripted Reviewer says yes", async () => {
  const proposal = calculateProposal(facts, now, terms);
  proposal.schedule[0].amountCents = 1;
  let customerCalls = 0;
  const model: Model = { async getResponse(request) {
    if (request.systemInstructions?.includes("Independently challenge")) return output({ accepted: true, reasons: [] });
    if (request.systemInstructions?.includes("Interpret commitments")) return output({ summary: "Forged calculation", needsOperator: false, updates: [proposal] });
    if (++customerCalls === 1) return call("account_resolution", { input: "Propose requested terms" });
    return output({ reply: "I need help reviewing these terms.", needsOperator: true });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  const result = await investigate(input, model);
  expect(result.review.accepted).toBe(false); expect(result.resolution).toBeNull();
  expect(result.review.reasons).toContain("A specialist did not return validated findings; operator attention is required.");
});
