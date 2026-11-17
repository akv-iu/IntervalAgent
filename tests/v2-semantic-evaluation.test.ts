import { semanticSuite, semanticInput, semanticChecks } from "../scripts/v2-semantic-evaluation";
import type { InvestigationResult } from "../src/lib/v2/contracts";
import { scriptedClaim } from "./helpers/v2-claim";

const blank = (): InvestigationResult => ({ draft: { reply: "Which invoice do you mean?", needsOperator: false }, verification: null, resolution: null, review: { accepted: true, reasons: [] }, activity: [] });

test("declared matched cases cover both businesses with identical raw context and no expected answers in model input", () => {
  expect(new Set(semanticSuite.cases.map((c) => c.id)).size).toBe(9);
  expect(new Set(semanticSuite.cases.map((c) => semanticInput(c).facts.businessId)).size).toBe(2);
  for (const sample of semanticSuite.cases) {
    const a = semanticInput(sample), b = semanticInput(sample);
    expect(a).toEqual(b); expect(a).not.toHaveProperty("expected"); expect(a).not.toHaveProperty("category");
    a.facts.balanceCents = 0; expect(b.facts.balanceCents).toBeGreaterThan(0);
    expect(b.messages[0].origin).toBe("synthetic_opening");
  }
});

test("an accepted clarification alone does not pass a case where the known context supports investigation", () => {
  expect(semanticChecks(semanticSuite.cases[0], blank(), true)).toContain("Expected a targeted business investigation");
});

test("correct routing cannot hide invented customer dates or an unsupported receipt", () => {
  const sample = semanticSuite.cases[0], input = semanticInput(sample), result = blank();
  result.paymentClaim = scriptedClaim(input, { claimMessageId: "claim", amountCents: 12900 });
  result.activity.push({ role: "business_verification", action: "delegated", summary: "Requested" });
  result.verification = { claimMessageId: "claim", outcome: "awaiting_business", businessMessage: "Please check the claimed payment", summary: "Awaiting the business", amountCents: 12900, paymentDate: null, invoiceId: input.facts.invoiceId, reference: null, settlementStatus: "unknown", missingFacts: ["date", "receipt"] };
  expect(semanticChecks(sample, result, true)).toEqual([]);
  result.verification.paymentDate = "2026-10-26";
  expect(semanticChecks(sample, result, true)).toContain("Proposed payment terms differ from supported conversation meaning");
  result.resolution = { summary: "Unsupported receipt", needsOperator: false, updates: [{ kind: "payment_recognized", amountCents: 12900, date: "2026-10-26", invoiceId: input.facts.invoiceId, reference: null, sourceMessageId: "claim", businessMessageId: "none" }] };
  expect(semanticChecks(sample, result, true)).toContain("No case supplies authority for recognition");
});

test("a vague business yes cannot become a dated, settled payment or pass by doing nothing", () => {
  const sample = semanticSuite.cases.at(-1)!, result = blank();
  expect(semanticChecks(sample, result, false)).toHaveLength(1);
  result.verification = { ...semanticInput(sample).verification!, outcome: "needs_facts", businessMessage: "What amount and date does your Yes refer to?" };
  expect(semanticChecks(sample, result, false)).toEqual([]);
  result.verification.outcome = "business_confirmed";
  expect(semanticChecks(sample, result, false)).toHaveLength(1);
});

test.each(semanticSuite.cases.filter((c) => c.expected.action === "do_not_investigate"))("$id cannot pass after an inappropriate business delegation", (sample) => {
  const result = blank(); expect(semanticChecks(sample, result, true)).toEqual([]);
  result.activity.push({ role: "business_verification", action: "delegated", summary: "Requested" });
  expect(semanticChecks(sample, result, true)).toHaveLength(1);
});
