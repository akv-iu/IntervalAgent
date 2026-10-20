import { demoRecords } from "../src/lib/v2/demo-records";
import { Records, evidenceFor, invoiceBalance, previewProposal } from "../src/lib/v2/records";

const scope = { businessId: "northside", workspaceId: "demo", accountId: "account-1" };
const proposalFor = (data: ReturnType<typeof demoRecords>) => ({
  proposalId: "proposal-1", accountId: "account-1", currency: "USD", policyVersion: data.policies[0].version, approvalRequired: true,
  actions: [
    { type: "allocate_payment", paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 5000 },
    { type: "credit_invoice", invoiceId: "invoice-1", cancellationId: "cancellation-1", amountCents: 2000 },
  ],
  evidenceRefs: [
    evidenceFor(scope, "invoice", data.invoices[0]), evidenceFor(scope, "payment", data.payments[0]),
    evidenceFor(scope, "cancellation", data.cancellations[0]), evidenceFor(scope, "policy", data.policies[0]),
  ],
});

test("synthetic records are deterministic, seed-dependent, and connected for two businesses", () => {
  const data = demoRecords();
  expect(data).toEqual(demoRecords());
  expect(data).not.toEqual(demoRecords(43));
  expect(Records.safeParse(data).success).toBe(true);
  expect(data.businesses.map((b) => b.businessId)).toEqual(["northside", "subscriptions"]);
  expect(data.invoices.filter((i) => i.id === "invoice-1")).toHaveLength(2);
  expect(JSON.stringify(data)).not.toMatch(/expectedOutcome|personaState|scenarioId|groundTruth/);
});

test("the reference case previews $14 without changing records or counting an unapplied payment twice", () => {
  const data = demoRecords();
  const original = structuredClone(data);
  expect(invoiceBalance(data, scope, "invoice-1")).toBe(8400);
  expect(previewProposal(data, scope, proposalFor(data))).toEqual([{ invoiceId: "invoice-1", balanceCents: 1400 }]);
  expect(data).toEqual(original);
});

test("different business policies change credit eligibility using the same code", () => {
  const data = demoRecords();
  const other = { ...scope, businessId: "subscriptions" };
  const proposal = proposalFor(data);
  proposal.evidenceRefs = proposal.evidenceRefs.map((e) => ({ ...e, businessId: other.businessId }));
  expect(() => previewProposal(data, other, proposal)).toThrow(/policy/);
});

test.each(["businessId", "workspaceId", "accountId"])("foreign %s references cannot authorize a proposal", (field) => {
  const data = demoRecords();
  const proposal = proposalFor(data);
  proposal.evidenceRefs = proposal.evidenceRefs.map((e) => ({ ...e, [field]: "other" }));
  expect(() => previewProposal(data, scope, proposal)).toThrow();
});

test("stale or fabricated evidence and unsupported amounts fail before a preview", () => {
  const data = demoRecords();
  const proposal = proposalFor(data);
  expect(() => previewProposal(data, scope, { ...proposal, evidenceRefs: proposal.evidenceRefs.map((e) => ({ ...e, version: e.version + 1 })) })).toThrow();
  expect(() => previewProposal(data, scope, { ...proposal, evidenceRefs: proposal.evidenceRefs.map((e) => ({ ...e, recordId: "invented" })) })).toThrow();
  expect(() => previewProposal(data, scope, { ...proposal, actions: [{ ...proposal.actions[0], amountCents: 5001 }] })).toThrow();
  expect(() => previewProposal(data, scope, { ...proposal, actions: [{ ...proposal.actions[1], amountCents: 2001 }] })).toThrow();
});

test("allocations must reference records in the same account and cannot exceed available payment or invoice balance", () => {
  const data = demoRecords();
  const row = { ...scope, id: "allocation-test", version: data.payments[0].version, paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 5001 };
  expect(Records.safeParse({ ...data, allocations: [...data.allocations, row] }).success).toBe(false);
  expect(Records.safeParse({ ...data, allocations: [...data.allocations, { ...row, amountCents: 100, paymentId: "payment-2" }] }).success).toBe(false);
});

test("duplicate IDs within a scope, missing parents, over-credit and unsafe money totals are rejected", () => {
  const data = demoRecords();
  expect(Records.safeParse({ ...data, invoices: [...data.invoices, data.invoices[0]] }).success).toBe(false);
  expect(Records.safeParse({ ...data, accounts: data.accounts.slice(1) }).success).toBe(false);
  expect(Records.safeParse({ ...data, credits: [...data.credits, { ...scope, version: data.cancellations[0].version, id: "credit-test", invoiceId: "invoice-1", cancellationId: "cancellation-1", amountCents: 2001 }] }).success).toBe(false);
  const huge = structuredClone(data);
  huge.invoices[0].lines.forEach((line) => { line.amountCents = Number.MAX_SAFE_INTEGER; });
  expect(Records.safeParse(huge).success).toBe(false);
});

test("returned evidence is bound to the actual source record, not arbitrary caller-provided scope", () => {
  const data = demoRecords();
  expect(() => evidenceFor({ ...scope, businessId: "other" }, "invoice", data.invoices[0])).toThrow();
});

test("effective policy boundaries compare instants even when timestamp precision differs", () => {
  const data = demoRecords();
  data.policies[0].effectiveFrom = "2026-03-10T16:00:00Z";
  expect(Records.safeParse(data).success).toBe(true);
  expect(previewProposal(data, scope, proposalFor(data))).toEqual([{ invoiceId: "invoice-1", balanceCents: 1400 }]);
});

test("an expired policy with the same version cannot be cited instead of the effective policy", () => {
  const data = demoRecords();
  data.policies.push({ ...data.policies[0], id: "retired-policy", effectiveFrom: "2025-01-01T00:00:00.000Z", effectiveTo: "2026-01-01T00:00:00.000Z" });
  const proposal = proposalFor(data);
  proposal.evidenceRefs = proposal.evidenceRefs.map((e) => e.recordType === "policy" ? { ...e, recordId: "retired-policy" } : e);
  expect(() => previewProposal(data, scope, proposal)).toThrow(/policy/);
});

test("already allocated payments, prior credits and unsettled funds cannot be spent again", () => {
  const data = demoRecords();
  data.credits.push({ ...scope, id: "existing-credit", version: data.invoices[0].version, invoiceId: "invoice-1", cancellationId: "cancellation-1", amountCents: 500 });
  expect(() => previewProposal(data, scope, proposalFor(data))).toThrow(/credit/);
  const pending = demoRecords();
  pending.payments[0].status = "pending";
  expect(() => previewProposal(pending, scope, proposalFor(pending))).toThrow(/payment/);
  const allocated = demoRecords();
  allocated.allocations.push({ ...scope, id: "existing-allocation", version: allocated.invoices[0].version, paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 1000 });
  expect(() => previewProposal(allocated, scope, proposalFor(allocated))).toThrow(/payment/);
});
