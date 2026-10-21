import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityPanel } from "../src/components/v2/VisitorActivity";
import { ActivitySnapshot } from "../src/lib/v2/activity";
import { loadVisitorActivity } from "../src/lib/v2/visitor-client";

const session = { businessId: "northside" as const, workspaceId: "workspace-1", expiresAt: "2026-10-21T12:00:00.000Z" };
const record = { businessId: "northside", workspaceId: "workspace-1", caseId: "case-1", accountId: "account-1", state: "awaiting_human" as const, revision: 3, contactSuppressed: false };
const at = "2026-10-20T12:00:00.000Z";
const ref = { recordType: "invoice" as const, recordId: "invoice-1", version: 1 };
function snapshot() {
  return ActivitySnapshot.parse({
    case: record,
    execution: { caseRevision: 2, state: "succeeded", attempts: 1, leaseActive: false, availableAt: at, finishedAt: at, mode: "mock", version: "mock-billing-1", policyVersion: 1, guardDecision: null,
      usage: { modelRequests: 0, toolCalls: 1, observedInputTokens: 0, observedOutputTokens: 0, unknownModelAttempts: 0, heldTokens: 0, chargedTokens: 0 } },
    messages: [{ ordinal: 1, parentOrdinal: null, sender: "customer", recipient: "coordinator", kind: "task_request", summary: "Task handed to the next role.", decision: null, evidenceRefs: [ref], createdAt: at }],
    tools: [{ ordinal: 1, name: "invoice_details", status: "found", evidenceRefs: [ref], createdAt: at, settledAt: at }],
    evidence: [{ ...ref, status: "available", fields: [{ label: "Invoice total", value: "$84.00" }] }], evidenceTruncated: false,
    proposal: { proposalId: "proposal-1", sourceCaseRevision: 2, currency: "USD", status: "pending_human", policyVersion: 1, actions: [{ type: "allocate_payment", paymentId: "payment-1", invoiceId: "invoice-1", amountCents: 5000 }], projectedBalanceCents: 1400 },
  });
}
const render = (data: ActivitySnapshot) => renderToStaticMarkup(createElement(ActivityPanel, { snapshot: data }));
afterEach(() => vi.unstubAllGlobals());

test("activity fetches its own snapshot even when the case revision is unchanged", async () => {
  const first = snapshot(), next = snapshot(); next.tools[0].status = "unavailable";
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(next));
  vi.stubGlobal("fetch", fetcher);
  expect((await loadVisitorActivity(session, "case-1")).tools[0].status).toBe("found");
  expect((await loadVisitorActivity(session, "case-1")).tools[0].status).toBe("unavailable");
  expect(fetcher.mock.calls[0][0]).toBe("/api/v2/cases/case-1/activity");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", method: "GET" });
});

test("the client rejects cross-workspace, malformed, overbound and private fields", async () => {
  const wrong = snapshot(); wrong.case.workspaceId = "another-workspace";
  for (const raw of [wrong, { ...snapshot(), messages: Array(19).fill(snapshot().messages[0]) }, { ...snapshot(), rawPrompt: "private" }, { ...snapshot(), execution: { ...snapshot().execution, mode: "live" } }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(raw)));
    await expect(loadVisitorActivity(session, "case-1")).rejects.toMatchObject({ status: 0 });
  }
});

test("429 and abort retain the existing retry and cancellation contract", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } })));
  await expect(loadVisitorActivity(session, "case-1")).rejects.toMatchObject({ status: 429, retryAt: expect.any(Number) });
  const controller = new AbortController(); controller.abort();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
  await expect(loadVisitorActivity(session, "case-1", controller.signal)).rejects.toBe(controller.signal.reason);
});

test("a proposal cannot be displayed for STOP, a stale revision, an unfinished job or a rejecting model guard", () => {
  const stopped = snapshot(); stopped.case.contactSuppressed = true;
  const stale = snapshot(); stale.proposal!.sourceCaseRevision = 1;
  const running = snapshot(); running.execution!.state = "running";
  const rejected = snapshot(); rejected.execution!.mode = "model_test"; rejected.execution!.guardDecision = "revise";
  for (const data of [stopped, stale, running, rejected]) expect(ActivitySnapshot.safeParse(data).success).toBe(false);
});

test("the view labels pending amounts, internal collaboration, evidence versions and synthetic provenance", () => {
  const html = render(snapshot());
  for (const text of ["$14.00", "$50.00", "Human approval required", "have not been applied", "Customer Agent to Coordinator Agent", "Mock workflow", "No model was called", "Evidence used", "version 1", "<details", "<summary", "Resource use"]) expect(html).toContain(text);
  expect(html).not.toContain("Approve proposal");
});

test("model-test usage distinguishes known totals from held capacity and never claims live evidence", () => {
  const data = snapshot(); data.execution!.mode = "model_test";
  data.execution!.guardDecision = "approve";
  data.execution!.usage = { modelRequests: 2, toolCalls: 1, observedInputTokens: 100, observedOutputTokens: 20, unknownModelAttempts: 1, heldTokens: 2000, chargedTokens: 2120 };
  const html = render(data);
  for (const text of ["not verified live-model evidence", "known usage only", "unknown or pending", "2000"]) expect(html).toContain(text);
});

test("failed, missing, empty and unclaimed states are honest and source text is escaped", () => {
  const data = snapshot(); data.proposal = null; data.execution!.state = "failed"; data.tools[0].status = "unavailable";
  data.messages[0].summary = '<script>alert("x")</script>'; data.evidence[0].status = "missing";
  let html = render(data);
  expect(html).toContain("Records unavailable"); expect(html).toContain("cannot be resolved"); expect(html).toContain("resource limit");
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  data.execution = null; data.messages = []; data.tools = []; data.evidence = [];
  html = render(data); expect(html).toContain("No investigation has been requested"); expect(html).toContain("No saved agent activity yet");
});

test("a queued retry is not presented as a task that has never been claimed", () => {
  const data = snapshot(); data.proposal = null; data.execution!.state = "queued";
  expect(render(data)).toContain("waiting for another attempt");
  data.execution!.attempts = 0;
  expect(render(data)).toContain("A worker has not claimed it");
});
