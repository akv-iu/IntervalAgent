import { syntheticSource } from "../src/lib/v2/source";
import { startingCases } from "../src/lib/v2/fixtures";
import { isGlobalStop } from "../src/lib/v2/contact";

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
