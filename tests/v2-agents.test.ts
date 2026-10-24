import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { buildAgents, investigate } from "../src/lib/v2/agents";
import { CaseUpdate, Verification, validateUpdates, validateVerification, type Investigation } from "../src/lib/v2/contracts";
import { startingCases } from "../src/lib/v2/fixtures";
import { boundedModel } from "../src/lib/v2/model";

const now = "2026-10-23T18:00:00.000Z";
const input: Investigation = { facts: startingCases(new Date(now))[0], now, verification: null, messages: [{ id: "c1", channel: "customer", speaker: "customer", text: "I paid today for INV-101", at: now }, { id: "b1", channel: "business", speaker: "business", text: "Yes", at: now }] };
function textResult(value: unknown): ModelResponse {
  return { usage: new Usage({ requests: 1, inputTokens: 100, outputTokens: 20 }), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}
function fakeModel(response: (request: ModelRequest) => ModelResponse | Promise<ModelResponse>): Model {
  return { getResponse: async (request) => response(request), async *getStreamedResponse() { throw new Error("not supported"); } };
}

describe("V2 role and write boundaries", () => {
  test("an attributed business report needs no settlement date but cannot authorize recognition", () => {
    const report = { claimMessageId: "c1", outcome: "business_reported", businessMessage: null, summary: "The business reports $50, not $129, for this invoice.", amountCents: 5000, paymentDate: null, invoiceId: "INV-101", reference: null, settlementStatus: "unknown", missingFacts: ["date", "settlement"] };
    expect(Verification.safeParse(report).success).toBe(true);
    const correlated = { ...input, verification: Verification.parse(report), requestId: "r1", messages: input.messages.map((m) => m.speaker === "business" ? { ...m, requestId: "r1" } : m) };
    expect(validateVerification(Verification.parse(report), correlated).outcome).toBe("business_reported");
    expect(() => validateUpdates([{ kind: "payment_recognized", amountCents: 5000, date: "2026-10-23", invoiceId: "INV-101", reference: null, sourceMessageId: "c1", businessMessageId: "b1" }], correlated)).toThrow("business confirmation");
  });
  test("roles have only source, delegation or date tools; writes require reviewed proposals", () => {
    const agents = buildAgents(input, fakeModel(() => textResult({})));
    expect(agents.customer.tools.map((t) => t.name)).toEqual(["read_case", "business_verification", "account_resolution"]);
    expect(agents.business.tools).toEqual([]);
    expect(agents.account.tools.map((t) => t.name)).toEqual(["resolve_relative_date"]);
    expect(agents.reviewer.tools).toEqual([]);
  });
  test("the same role definitions receive the selected business facts without another business's context", async () => {
    const facts = startingCases(new Date(now)).find((c) => c.id === "cedar-cancellation-overlap")!;
    const requests: ModelRequest[] = [];
    const model = fakeModel((request) => {
      requests.push(request);
      return textResult(requests.length === 1 ? { reply: "Your cancellation request is recorded; no credit is approved.", needsOperator: false } : { accepted: true, reasons: [] });
    });
    await investigate({ facts, now, verification: null, messages: [{ id: "cedar-question", channel: "customer", speaker: "customer", text: "What does your record say about my cancellation?", at: now }] }, model);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const context = JSON.stringify(request.input);
      expect(context).toContain("Cedar Home Services"); expect(context).toContain("CED-204"); expect(context).toContain("operator_review"); expect(context).toContain("annual service-plan cancellation");
      expect(context).not.toContain("Northside Fitness"); expect(context).not.toContain("INV-101");
    }
  });
  test("model output cannot add a balance write or approve an extension", () => {
    expect(CaseUpdate.safeParse({ kind: "payment", amountCents: 12900 }).success).toBe(false);
    expect(CaseUpdate.safeParse({ kind: "extension_approved", date: "2026-10-30", sourceMessageId: "c1" }).success).toBe(false);
    expect(CaseUpdate.safeParse({ kind: "promise", amountCents: 5000, date: "2026-10-30", sourceMessageId: "c1", balanceCents: 0 }).success).toBe(false);
  });
  test("foreign or business messages cannot support a customer commitment", () => {
    const promise = { kind: "promise" as const, amountCents: 5000, date: "2026-10-24", sourceMessageId: "foreign" };
    expect(() => validateUpdates([promise], input)).toThrow("customer source");
    expect(() => validateUpdates([{ ...promise, sourceMessageId: "b1" }], { ...input, messages: [{ id: "b1", channel: "business", speaker: "business", text: "Yes", at: now }] })).toThrow("customer source");
    expect(() => validateUpdates([{ ...promise, sourceMessageId: "c1", amountCents: 13000 }], input)).toThrow("balance");
  });
  test("an old business reply cannot confirm a new claim, even for the same invoice", () => {
    const verified = { claimMessageId: "c1", outcome: "business_confirmed" as const, businessMessage: null, summary: "Confirmed", amountCents: 5000, paymentDate: "2026-10-23", invoiceId: "INV-101", reference: null, settlementStatus: "settled" as const, missingFacts: [] };
    expect(() => validateVerification(verified, input)).toThrow("linked reply");
    const correlated = { ...input, requestId: "r1", verification: verified, messages: input.messages.map((m) => m.speaker === "business" ? { ...m, requestId: "r1" } : m) };
    expect(validateVerification(verified, correlated)).toEqual(verified);
    expect(() => validateVerification({ ...verified, claimMessageId: "c2" }, { ...correlated, messages: [...correlated.messages, { ...input.messages[0], id: "c2" }] })).toThrow("linked reply");
    expect(() => validateVerification({ ...verified, invoiceId: "WRONG" }, correlated)).toThrow("matching");
  });
  test("a new business request requires a customer-supplied matching invoice", () => {
    const pending = { claimMessageId: "c1", outcome: "awaiting_business" as const, businessMessage: "Did this payment reach INV-101?", summary: "Awaiting business", amountCents: 12900, paymentDate: "2026-10-23", invoiceId: "INV-101", reference: null, settlementStatus: "unknown" as const, missingFacts: ["receipt"] };
    expect(() => validateVerification(pending, { ...input, messages: [{ ...input.messages[0], text: "I paid today" }] })).toThrow("customer invoice");
    expect(() => validateVerification(pending, { ...input, messages: [{ ...input.messages[0], text: "My invoice is INV-1010" }] })).toThrow("customer invoice");
    expect(validateVerification(pending, { ...input, messages: [...input.messages, { ...input.messages[0], id: "c2", text: "Invoice INV-101." }] })).toEqual(pending);
  });
  test("a recognition proposal needs correlated reviewed business evidence, not a promise", () => {
    const update = { kind: "payment_recognized", amountCents: 5000, date: "2026-10-23", invoiceId: "INV-101", reference: null, sourceMessageId: "c1", businessMessageId: "b1" };
    expect(CaseUpdate.safeParse(update).success).toBe(true);
    expect(() => validateUpdates([CaseUpdate.parse(update)], input)).toThrow("business confirmation");
  });
  test("SDK executes nested business work with the same bounded model", async () => {
    let calls = 0;
    const verification = { claimMessageId: "c1", outcome: "awaiting_business", businessMessage: "Please confirm amount, date, invoice and settlement status.", summary: "More evidence is required.", amountCents: null, paymentDate: null, invoiceId: null, reference: null, settlementStatus: "unknown", missingFacts: ["amount", "date", "invoice", "status"] };
    const model = boundedModel({ apiKey: "unused", reserve: async () => { calls++; }, record: () => {}, model: fakeModel((request) => {
      if (request.systemInstructions?.includes("Independently challenge")) return textResult({ accepted: true, reasons: [] });
      if (request.systemInstructions?.includes("Own the separate business")) return textResult(verification);
      if (calls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "delegate-1", name: "business_verification", arguments: JSON.stringify({ claimMessageId: "c1" }) }] };
      expect(request.tools.some((t) => t.name === "business_verification")).toBe(false);
      return textResult({ reply: "We need more payment details from the business. Verification is pending.", needsOperator: false });
    }) });
    const result = await investigate(input, model);
    expect(calls).toBe(4);
    expect(result.verification?.outcome).toBe("awaiting_business");
    expect(result.activity.filter((a) => a.action !== "delegated").map((a) => a.role)).toEqual(["business_verification", "reviewer"]);
  });
  test("a business report gives the customer agent attribution scope rather than a settlement checklist", async () => {
    const report = { claimMessageId: "c1", outcome: "business_reported" as const, businessMessage: null, summary: "The business reports $50; date and settlement are unknown.", amountCents: 5000, paymentDate: null, invoiceId: "INV-101", reference: null, settlementStatus: "unknown" as const, missingFacts: ["date", "settlement"] };
    const correlated = { ...input, requestId: "r1", verification: { ...report, outcome: "awaiting_business" as const }, messages: input.messages.map((m) => m.speaker === "business" ? { ...m, requestId: "r1" } : m) };
    let customerCalls = 0;
    const model = fakeModel((request) => {
      if (request.systemInstructions?.includes("Own the separate business")) return textResult(report);
      if (request.systemInstructions?.includes("Independently challenge")) return textResult({ accepted: true, reasons: [] });
      if (++customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "report-1", name: "business_verification", arguments: JSON.stringify({ claimMessageId: "c1" }) }] };
      expect(JSON.stringify(request.input)).toContain("canAttribute");
      expect(JSON.stringify(request.input)).toContain("canRecognizePayment");
      return textResult({ reply: "The business reports $50 for INV-101. Would you like to dispute that report?", needsOperator: false });
    });
    const result = await investigate(correlated, model);
    expect(result.verification?.settlementStatus).toBe("unknown");
    expect(result.verification?.missingFacts).toEqual(["date", "settlement"]);
    expect(result.review.accepted).toBe(true);
  });
  test("two rejected reviews remain rejected instead of accepting a fallback", async () => {
    const model = fakeModel((request) => request.systemInstructions?.includes("Independently challenge")
      ? textResult({ accepted: false, reasons: ["Unsupported settlement"] })
      : textResult({ reply: "Already settled", needsOperator: false }));
    const result = await investigate(input, model);
    expect(result.review.accepted).toBe(false);
    expect(result.activity.filter((a) => a.action === "rejected")).toHaveLength(2);
  });
  test("an early delegation attempt can recover with an invoice question without running a specialist", async () => {
    let calls = 0;
    const model = fakeModel((request) => {
      calls++;
      if (request.systemInstructions?.includes("Own the separate business")) throw new Error("Specialist must not run before the invoice is supplied");
      if (request.systemInstructions?.includes("Independently challenge")) return textResult({ accepted: true, reasons: [] });
      if (calls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "too-early", name: "business_verification", arguments: JSON.stringify({ claimMessageId: "c1" }) }] };
      return textResult({ reply: "What is your invoice number?", needsOperator: false });
    });
    const result = await investigate({ ...input, messages: [{ ...input.messages[0], text: "I paid today" }] }, model);
    expect(result.review.accepted).toBe(true);
    expect(result.verification).toBeNull();
    expect(calls).toBe(3);
  });
  test("SDK stops exposing the same source snapshot after a successful read", async () => {
    let calls = 0;
    const model = fakeModel((request) => {
      calls++;
      if (request.systemInstructions?.includes("Independently challenge")) return textResult({ accepted: true, reasons: [] });
      if (calls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "read-once", name: "read_case", arguments: "{}" }] };
      expect(request.tools.some((t) => t.name === "read_case")).toBe(false);
      return textResult({ reply: "The record is dated yesterday; receipt is not confirmed.", needsOperator: false });
    });
    expect((await investigate(input, model)).review.accepted).toBe(true);
    expect(calls).toBe(3);
  });
  test("invoice mismatch preserves the actual blocked handoff status for resolution and review", async () => {
    const mismatch: Investigation = { ...input, messages: [
      { ...input.messages[0], text: "I have paid" },
      { ...input.messages[0], id: "c2", text: "Inv01 and I have paid 129 dollars , today" },
    ] };
    let customerCalls = 0;
    const model = fakeModel((request) => {
      if (request.systemInstructions?.includes("Own the separate business")) throw new Error("No business agent may run for an unmatched invoice");
      if (request.systemInstructions?.includes("Interpret commitments")) {
        expect(JSON.stringify(request.input)).toContain("blocked_invoice");
        return textResult({ summary: "The invoice is unmatched; no business request was sent.", updates: [], needsOperator: false });
      }
      if (request.systemInstructions?.includes("Independently challenge")) {
        expect(JSON.stringify(request.input)).toContain("blocked_invoice");
        return textResult({ accepted: true, reasons: [] });
      }
      customerCalls++;
      if (customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "blocked-1", name: "business_verification", arguments: JSON.stringify({ claimMessageId: "c1" }) }] };
      if (customerCalls === 2) return { usage: new Usage(), output: [{ type: "function_call", callId: "resolve-1", name: "account_resolution", arguments: JSON.stringify({ input: "What should we do next?" }) }] };
      return textResult({ reply: "This account shows INV-101. Could you confirm the invoice number?", needsOperator: false });
    });
    const result = await investigate(mismatch, model);
    expect(result.review.accepted).toBe(true);
    expect(result.verification).toBeNull();
    expect(result.activity.some((a) => a.action === "blocked_invoice")).toBe(true);
    expect(result.activity.some((a) => a.role === "business_verification" && a.action === "delegated")).toBe(false);
  });
  test("a rejected specialist summary can be revised using explicit Reviewer feedback", async () => {
    let customerCalls = 0, accountCalls = 0, reviewCalls = 0;
    const model = fakeModel((request) => {
      if (request.systemInstructions?.includes("Interpret commitments")) {
        accountCalls++;
        expect(JSON.stringify(request.input)).toContain("not_requested");
        if (accountCalls === 2) expect(JSON.stringify(request.input)).toContain("invented failure");
        return textResult({ summary: accountCalls === 1 ? "Business verification failed" : "No business verification was performed; clarify the invoice.", needsOperator: false, updates: [] });
      }
      if (request.systemInstructions?.includes("Independently challenge")) {
        reviewCalls++;
        return textResult({ accepted: reviewCalls === 2, reasons: reviewCalls === 1 ? ["Correct the invented failure in the Account Resolution summary"] : [] });
      }
      customerCalls++;
      if (customerCalls % 2 === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: `resolve-${customerCalls}`, name: "account_resolution", arguments: JSON.stringify({ input: "Assess the next step" }) }] };
      return textResult({ reply: "Could you confirm the invoice number?", needsOperator: false });
    });
    const result = await investigate(input, model);
    expect(result.review.accepted).toBe(true);
    expect(result.resolution?.summary).toBe("No business verification was performed; clarify the invoice.");
    expect(accountCalls).toBe(2);
    expect(reviewCalls).toBe(2);
  });
});

describe("nested model limits", () => {
  const request: ModelRequest = { input: "hello", modelSettings: {}, tools: [], handoffs: [], outputType: "text", tracing: false };
  test("reserve happens before transport and includes every nested call", async () => {
    const order: string[] = [];
    const model = boundedModel({ apiKey: "unused", reserve: async () => { order.push("reserved"); }, start: async () => { order.push("started"); }, record: () => {}, model: fakeModel((req) => {
      order.push("transport");
      expect(req.modelSettings.retry?.maxRetries).toBe(0);
      expect(req.modelSettings.store).toBe(false);
      return textResult({});
    }) });
    await model.getResponse(request);
    expect(order).toEqual(["reserved", "started", "transport"]);
  });
  test("budget rejection prevents any provider request", async () => {
    const model = boundedModel({ apiKey: "unused", reserve: async () => { throw new Error("cap"); }, record: () => {}, model: fakeModel(() => { throw new Error("transport must not run"); }) });
    await expect(model.getResponse(request)).rejects.toThrow("cap");
  });
  test("normalized zero counts without provider usage are explicitly unknown", async () => {
    let usageKnown = true;
    const model = boundedModel({ apiKey: "unused", reserve: async () => {}, record: (call) => { usageKnown = call.usageKnown; }, model: fakeModel(() => ({ usage: new Usage(), output: [] })) });
    await model.getResponse(request);
    expect(usageKnown).toBe(false);
  });
  test("oversized contexts and exhausted calls fail before dispatch", async () => {
    let calls = 0;
    const model = boundedModel({ apiKey: "unused", reserve: async () => { calls++; }, record: () => {}, model: fakeModel(() => textResult({})) });
    await expect(model.getResponse({ ...request, input: "x".repeat(33_000) })).rejects.toThrow("context");
    expect(calls).toBe(0);
    for (let n = 0; n < 19; n++) await model.getResponse(request);
    await expect(model.getResponse(request)).rejects.toThrow("limit");
    expect(calls).toBe(19);
  });
});
