import { syntheticSource } from "../src/lib/v2/source";
import { startingCases } from "../src/lib/v2/fixtures";
import { isGlobalStop } from "../src/lib/v2/contact";
import { validateUpdates, type Investigation } from "../src/lib/v2/contracts";

test("two businesses have six factual starting situations each, unique identities and independent records", async () => {
  const records = startingCases(new Date("2026-10-24T01:00:00Z"));
  expect(records).toHaveLength(12);
  expect(new Set(records.map((c) => c.id)).size).toBe(12);
  expect(new Set(records.map((c) => c.invoiceId)).size).toBe(12);
  for (const businessId of ["northside", "cedar"]) {
    const cases = records.filter((c) => c.businessId === businessId);
    expect(cases).toHaveLength(6);
    expect(new Set(cases.map((c) => c.scenario)).size).toBe(6);
    expect(cases.every((c) => c.accountNotes?.length && c.balanceCents > 0)).toBe(true);
    const partial = cases.find((c) => c.scenario === "partial_payment")!;
    expect(partial.payments[0]).toMatchObject({ status: "settled", includedInBalance: true, date: "2026-10-22" });
    expect(cases.find((c) => c.scenario === "pending_payment")!.payments[0]).toMatchObject({ status: "pending", includedInBalance: false });
  }
  expect(records[0]).toMatchObject({ id: "late-payment", customer: "Alex", balanceCents: 12900, recognitionPolicy: "business_confirmation" });
  const cedar = records.find((c) => c.id === "cedar-late-payment")!;
  expect(cedar).toMatchObject({ customer: "Riley", invoiceId: "CED-201", balanceCents: 18500, recognitionPolicy: "operator_review" });
  const source = syntheticSource(records);
  expect((await source.readAccount({ businessId: "northside", caseId: cedar.id })).status).toBe("missing");
  records[6].accountNotes!.push("Only Cedar's record changed");
  expect(records[0].accountNotes).not.toContain("Only Cedar's record changed");
});

test("the second business cannot automatically recognize a payment even with complete confirmation", () => {
  const facts = startingCases(new Date("2026-10-23T12:00:00Z")).find((c) => c.id === "cedar-late-payment")!;
  const input: Investigation = { facts, now: "2026-10-23T12:00:00Z", requestId: "cedar-request", messages: [
    { id: "claim", channel: "customer", speaker: "customer", text: "I paid $185 today for CED-201", at: "2026-10-23T12:00:00Z" },
    { id: "reply", channel: "business", speaker: "business", text: "Yes, received and settled", at: "2026-10-23T12:00:01Z", requestId: "cedar-request" },
  ], verification: { claimMessageId: "claim", outcome: "business_confirmed", businessMessage: null, summary: "Confirmed by Cedar", amountCents: 18500, paymentDate: "2026-10-23", invoiceId: "CED-201", reference: null, settlementStatus: "settled", missingFacts: [] } };
  expect(() => validateUpdates([{ kind: "payment_recognized", sourceMessageId: "claim", businessMessageId: "reply", amountCents: 18500, date: "2026-10-23", invoiceId: "CED-201", reference: null }], input)).toThrow("operator approval");
});

test("adapter scopes duplicate case identifiers by business and retains dated provenance", async () => {
  const facts = startingCases(new Date("2026-10-23T12:00:00Z"))[0];
  const source = syntheticSource([facts, { ...facts, businessId: "other-business", balanceCents: 1 }]);
  const result = await source.readAccount({ businessId: "northside", caseId: facts.id });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected source record");
  expect(result.facts.balanceCents).toBe(12900);
  expect(result.asOf).toBe(facts.balanceAsOf);
  expect(result.references).toContain(facts.invoiceId);
  result.facts.balanceCents = 0;
  const again = await source.readAccount({ businessId: "northside", caseId: facts.id });
  expect(again.status === "available" && again.facts.balanceCents).toBe(12900);
});

test("unavailable account identity stays missing, never a fabricated zero balance", async () => {
  const source = syntheticSource(startingCases(new Date()));
  expect(await source.readAccount({ businessId: "foreign", caseId: "late-payment" })).toEqual({ status: "missing", scope: { businessId: "foreign", caseId: "late-payment" }, provenance: "synthetic" });
});

test("explicit alternative channels remain preferences while global STOP wins", () => {
  expect(isGlobalStop("Don't call me. Please email me instead.")).toBe(false);
  expect(isGlobalStop("Do not email me. Call me instead.")).toBe(false);
  expect(isGlobalStop("STOP. Email me instead.")).toBe(true);
  expect(isGlobalStop("Don't contact me. Email me instead.")).toBe(true);
  expect(isGlobalStop("Don't call me; don't email me instead.")).toBe(true);
});
