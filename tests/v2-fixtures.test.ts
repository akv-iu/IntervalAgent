import { readFileSync } from "node:fs";
import { Expected, Manifest, checkFixtures, fixtureTools, loadExpectation, loadInput, loadManifest, verifyBytes } from "../scripts/v2-eval/fixtures";
import { evidenceFor, previewProposal } from "../src/lib/v2/records";

test("the frozen set has 36 cases, disjoint families and all eight required categories per split", () => {
  const result = checkFixtures();
  expect(result.counts).toEqual({ development: 12, validation: 12, holdout: 12 });
  expect(result.holdoutEvaluated).toBe(false);
  const manifest = loadManifest();
  expect(new Set(manifest.cases.map((c) => c.familyId)).size).toBe(36);
  expect(new Set(manifest.cases.map((c) => c.inputSha256)).size).toBe(36);
});

test("reused declared families and identical input hashes are rejected", () => {
  const manifest = loadManifest();
  const families = structuredClone(manifest);
  families.cases[12].familyId = families.cases[0].familyId;
  expect(Manifest.safeParse(families).success).toBe(false);
  const copies = structuredClone(manifest);
  copies.cases[12].inputSha256 = copies.cases[0].inputSha256;
  expect(Manifest.safeParse(copies).success).toBe(false);
});

test("fault controls cannot silently turn a non-failure case into an outage", () => {
  const manifest = loadManifest();
  manifest.cases[0].controls.failure = { tools: ["payment_search"], mode: "unavailable" };
  expect(Manifest.safeParse(manifest).success).toBe(false);
});

test("financial answer keys need evidence and exactly the balances their actions affect", () => {
  const expected = loadExpectation("d01");
  expect(Expected.safeParse({ ...expected, remainingBalances: [] }).success).toBe(false);
  expect(Expected.safeParse({ ...expected, remainingBalances: [{ invoiceId: "other-invoice", balanceCents: 0 }] }).success).toBe(false);
  expect(Expected.safeParse({ ...expected, requiredEvidence: [] }).success).toBe(false);
});

test("changing pinned bytes fails closed rather than silently accepting edited fixtures", () => {
  const entry = loadManifest().cases[0];
  const bytes = readFileSync(`fixtures/v2/evaluation/billing-20261019-1/inputs/${entry.caseId}.json`, "utf8");
  expect(() => verifyBytes(bytes, entry.inputSha256)).not.toThrow();
  expect(() => verifyBytes(`${bytes} `, entry.inputSha256)).toThrow(/hash/);
});

test("runtime inputs contain facts and customer text, never split labels, controls or answer keys", () => {
  for (const entry of loadManifest().cases) {
    const input = loadInput(entry.caseId);
    expect(Object.keys(input).sort()).toEqual(["customerMessage", "records", "schemaVersion", "scope"]);
    expect(JSON.stringify(input)).not.toMatch(/familyId|expectedOutcome|disposition|remainingBalances|unavailableTools|groundTruth/);
  }
});

test.each(["../h01", "unknown", "H01"])("invalid or unknown fixture ID %s cannot read a file", (id) => {
  expect(() => loadInput(id)).toThrow();
});

test("holdout answers are blocked by default and the integrity command does not evaluate them", () => {
  expect(() => loadExpectation("h01")).toThrow(/holdout/i);
  expect(() => loadExpectation("h01", { allowHoldout: "false" as unknown as boolean })).toThrow(/holdout/i);
  expect(loadExpectation("d01").disposition).toBe("propose");
  expect(checkFixtures().holdoutEvaluated).toBe(false);
});

test("separately authored development/validation financial answers agree with current record invariants", () => {
  for (const entry of loadManifest().cases.filter((c) => c.split !== "holdout")) {
    const expected = loadExpectation(entry.caseId);
    if (expected.disposition !== "propose") continue;
    const { records, scope } = loadInput(entry.caseId);
    const tables = { account: records.accounts, invoice: records.invoices, payment: records.payments, cancellation: records.cancellations, policy: records.policies, allocation: records.allocations, credit: records.credits };
    const evidenceRefs = expected.requiredEvidence.map((ref) => {
      const row = tables[ref.recordType].find((r) => r.id === ref.recordId && r.businessId === scope.businessId && r.workspaceId === scope.workspaceId);
      if (!row) throw new Error("expected evidence record is missing");
      return evidenceFor(scope, ref.recordType, row);
    });
    const config = records.businesses.find((b) => b.businessId === scope.businessId)!;
    const actual = previewProposal(records, scope, {
      proposalId: "fixture-preview", accountId: scope.accountId, currency: "USD", policyVersion: config.policyVersion,
      approvalRequired: true, actions: expected.actions, evidenceRefs,
    });
    expect(actual.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))).toEqual([...expected.remainingBalances].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId)));
  }
});

test("fault injection stays in the harness and other read tools still work", async () => {
  const input = loadInput("v08");
  const tools = fixtureTools("v08");
  const context = { ...input.scope, role: "investigator" };
  expect((await tools.execute(context, { name: "adjustment_history", accountId: input.scope.accountId })).status).toBe("unavailable");
  expect((await tools.execute(context, { name: "invoice_details", accountId: input.scope.accountId, invoiceId: "invoice-1" })).status).toBe("found");
});

test("a fixture tool cannot switch to another account present in its backing snapshot", async () => {
  const input = loadInput("v12");
  await expect(fixtureTools("v12").execute(
    { ...input.scope, accountId: "account-2", role: "investigator" },
    { name: "payment_search", accountId: "account-2" },
  )).rejects.toThrow(/scope/);
});
