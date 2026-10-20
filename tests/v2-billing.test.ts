import { billingRecipe, billingFinding, billingDraft, billingReview, pendingBillingText } from "../src/lib/v2/billing";
import { AgentMessage } from "../src/lib/v2/contracts";
import { demoRecords } from "../src/lib/v2/demo-records";
import { createReadTools } from "../src/lib/v2/tools";
import { makeAgentMessage } from "../src/lib/v2/mock-agents";
import { invoiceBalance } from "../src/lib/v2/records";

const scope = { businessId: "northside", workspaceId: "demo", accountId: "account-1" };
async function investigate(data = demoRecords(), businessId = scope.businessId) {
  const selected = { ...scope, businessId }, recipe = billingRecipe(data, selected);
  const tools = createReadTools(async () => data);
  const results = await Promise.all(recipe.steps.map((s) => tools.execute({ ...selected, role: "investigator" }, s.request)));
  const finding = makeAgentMessage({ ...selected, caseId: "case-1", runId: "run-1", createdAt: "2026-10-20T00:00:00.000Z" }, { operationKey: "finding", sender: "investigator", recipient: "coordinator", parentMessageId: "task" }, billingFinding(recipe.context, results));
  const draft = makeAgentMessage({ ...selected, caseId: "case-1", runId: "run-1", createdAt: "2026-10-20T00:00:00.000Z" }, { operationKey: "draft", sender: "customer", recipient: "reviewer", parentMessageId: "draft-task" }, billingDraft(finding));
  return { recipe, results, finding, draft };
}

test("reference evidence produces a pending $14 proposal without changing any record", async () => {
  const data = demoRecords(), before = structuredClone(data);
  const { recipe, results, finding, draft } = await investigate(data);
  expect(recipe.steps).toHaveLength(5);
  expect(finding.kind === "finding" && finding.payload.billing).toMatchObject({ projectedBalanceCents: 1400, payment: { amountCents: 5000 }, credit: { amountCents: 2000 } });
  expect(draft.kind).toBe("proposal");
  if (draft.kind !== "proposal") return;
  expect(draft.payload.resolution?.approvalRequired).toBe(true);
  expect(draft.payload.resolution?.actions.map((a) => a.amountCents)).toEqual([5000,2000]);
  expect(draft.payload.message).toContain("$14.00 USD");
  expect(draft.payload.message).toContain("Pending human approval");
  expect(billingReview(recipe.context, results, draft, finding).payload.decision).toBe("approve");
  expect(invoiceBalance(data, scope, "invoice-1")).toBe(8400);
  expect(data).toEqual(before);
});

test("the second business applies its own cancellation policy through the same functions", async () => {
  const { recipe, results, finding, draft } = await investigate(demoRecords(), "subscriptions");
  expect(finding.kind === "finding" && finding.payload.billing).toMatchObject({ projectedBalanceCents: 3400, credit: null });
  expect(draft.kind === "proposal" && draft.payload.resolution?.actions).toHaveLength(1);
  expect(billingReview(recipe.context, results, draft, finding).payload.decision).toBe("approve");
});

test("multiple unapplied payments require a human instead of selecting a convenient match", async () => {
  const data = demoRecords();
  data.payments.push({ ...data.payments[0], id: "another-payment", amountCents: 5000 });
  const { recipe, results, finding, draft } = await investigate(data);
  expect(finding.kind === "finding" && finding.payload.uncertainties.length).toBeGreaterThan(0);
  expect(draft.kind === "proposal" && draft.payload.resolution).toBeNull();
  expect(billingReview(recipe.context, results, draft, finding).payload.decision).toBe("escalate");
});

test("missing payment evidence cannot turn a customer statement into a verified payment", async () => {
  const { recipe, results } = await investigate();
  const missing = results.map((r) => r.name === "payment_search" ? { name: "payment_search" as const, status: "unavailable" as const, message: "Unavailable", evidenceRefs: [] } : r);
  expect(billingFinding(recipe.context, missing).payload.billing).toBeNull();
});

test("review rejects wrong arithmetic, completed-action wording and changed financial amounts", async () => {
  const { recipe, results, finding, draft } = await investigate();
  if (draft.kind !== "proposal" || !draft.payload.resolution) throw new Error("proposal required");
  const wrongText = { ...draft, payload: { ...draft.payload, message: "Your payment and credit are applied. You owe zero." } };
  expect(billingReview(recipe.context, results, wrongText, finding).payload.decision).toBe("revise");
  const changed = structuredClone(draft);
  changed.payload.resolution!.actions[0].amountCents = 5001;
  expect(billingReview(recipe.context, results, changed, finding).payload.decision).toBe("revise");
});

test("multiple invoices escalate without silently choosing the first", async () => {
  const data = demoRecords();
  data.invoices.push({ ...data.invoices[0], id: "second-invoice" });
  const { finding } = await investigate(data);
  expect(finding.kind === "finding" && finding.payload.billing).toBeNull();
});

test("pending currency text preserves integer cents near the safe-integer boundary", async () => {
  const { draft } = await investigate();
  if (draft.kind!=="proposal" || !draft.payload.resolution) throw new Error("proposal required");
  const proposal = structuredClone(draft.payload.resolution);
  proposal.actions[0].amountCents = Number.MAX_SAFE_INTEGER-1;
  expect(pendingBillingText(proposal,Number.MAX_SAFE_INTEGER-1)).toContain("$90,071,992,547,409.90 USD");
});

test("review rejects a contradictory finding even when the draft has the correct amounts", async () => {
  const { recipe, results, finding, draft } = await investigate();
  if (finding.kind!=="finding" || !finding.payload.billing) throw new Error("facts required");
  const changed = structuredClone(finding); changed.payload.billing!.projectedBalanceCents = 0;
  expect(billingReview(recipe.context,results,draft,changed).payload.decision).toBe("revise");
});

test("an approved review cannot simultaneously request reinvestigation", async () => {
  const { finding } = await investigate();
  expect(AgentMessage.safeParse({ ...finding, sender: "reviewer", recipient: "coordinator", kind: "review_result", payload: { decision: "approve", summary: "Approved", requiredChanges: [], reinvestigate: ["payment_search"] } }).success).toBe(false);
});

test("structured billing findings cannot cite actions without the corresponding observed references", async () => {
  const { finding } = await investigate();
  if (finding.kind!=="finding" || !finding.payload.billing) throw new Error("facts required");
  expect(AgentMessage.safeParse({ ...finding, payload: { ...finding.payload, billing: { ...finding.payload.billing, invoiceId: "invented-invoice" } } }).success).toBe(false);
  expect(AgentMessage.safeParse({ ...finding, evidenceRefs: finding.evidenceRefs.filter((r) => r.recordType!=="payment") }).success).toBe(false);
});

test("structured billing findings reject inconsistent projected arithmetic", async () => {
  const { finding } = await investigate();
  if (finding.kind!=="finding" || !finding.payload.billing) throw new Error("facts required");
  expect(AgentMessage.safeParse({ ...finding, payload: { ...finding.payload, billing: { ...finding.payload.billing, projectedBalanceCents: 0 } } }).success).toBe(false);
});

test("already allocated and credited amounts are not proposed a second time", async () => {
  const data = demoRecords();
  data.allocations.push({ ...scope, id: "partial-allocation", version: 43, paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 2000 });
  data.credits.push({ ...scope, id: "partial-credit", version: 43, invoiceId: "invoice-1", cancellationId: "cancellation-1", amountCents: 500 });
  const { finding, draft, recipe, results } = await investigate(data);
  expect(finding.kind === "finding" && finding.payload.billing).toMatchObject({ projectedBalanceCents: 1400, payment: { amountCents: 3000 }, credit: { amountCents: 1500 } });
  expect(billingReview(recipe.context,results,draft,finding).payload.decision).toBe("approve");
});
