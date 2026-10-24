import type { CaseFacts } from "../../src/lib/v2/contracts";
import type { AccountSource, SourceAdapter } from "../../src/lib/v2/source";

export function sourceContract(adapter: SourceAdapter, create: () => AccountSource, records: CaseFacts[]) {
  describe(`${adapter} shared account-source contract`, () => {
    test("all scoped records retain exact amounts, payment states, business policy and dated evidence", async () => {
      const source = create();
      for (const facts of records) {
        const result = await source.readAccount({ businessId: facts.businessId, caseId: facts.id });
        expect(result).toMatchObject({ status: "available", adapter, provenance: "synthetic", version: facts.sourceVersion, asOf: facts.balanceAsOf });
        if (result.status !== "available") throw new Error("Expected normalized facts");
        expect(result.facts).toEqual(facts);
        expect(result.references).toEqual([facts.invoiceId, ...facts.payments.map((p) => p.id)]);
      }
    });
    test("a case ID shared by two businesses returns only the requested business", async () => {
      const source = create();
      const northside = await source.readAccount({ businessId: "northside", caseId: "late-payment" });
      const cedar = await source.readAccount({ businessId: "cedar", caseId: "late-payment" });
      expect(northside.status === "available" && northside.facts.invoiceId).toBe("INV-101");
      expect(cedar.status === "available" && cedar.facts.invoiceId).toBe("CED-201");
    });
    test("missing or injection-shaped scope is explicit missing, never fabricated as a zero account", async () => {
      for (const scope of [{ businessId: "unknown", caseId: "late-payment" }, { businessId: "northside", caseId: "unknown" }, { businessId: "northside' OR true --", caseId: "late-payment" }]) {
        expect(await create().readAccount(scope)).toEqual({ status: "missing", adapter, provenance: "synthetic", scope });
      }
    });
    test("mutating returned evidence cannot change the source on a later read", async () => {
      const source = create(), scope = { businessId: "northside", caseId: "fresh-record" };
      const result = await source.readAccount(scope);
      if (result.status !== "available") throw new Error("Expected fresh record");
      result.facts.balanceCents = 0; result.facts.payments[0].amountCents = 0;
      const again = await source.readAccount(scope);
      expect(again.status === "available" && again.facts.balanceCents).toBe(7900);
      expect(again.status === "available" && again.facts.payments[0].amountCents).toBe(5000);
    });
  });
}
