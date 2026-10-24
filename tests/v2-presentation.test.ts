import { caseAttention } from "../src/lib/v2/presentation";
import type { CaseState } from "../src/lib/v2/store";
import { openingMessage, startingCases } from "../src/lib/v2/fixtures";

const ready: Parameters<typeof caseAttention>[0] = { stopped: false, takeover: false, run: null, status: "ready", requestId: null, verification: null };
const waiting: Parameters<typeof caseAttention>[0] = { ...ready, status: "awaiting_business", requestId: "request", verification: { claimMessageId: "claim", outcome: "awaiting_business", businessMessage: "Please check", summary: "Waiting", amountCents: null, paymentDate: null, invoiceId: null, reference: null, settlementStatus: "unknown", missingFacts: [] } };

test("attention follows the party needing input, not the last model role", () => {
  expect(caseAttention(ready)).toBe("customer");
  expect(caseAttention(waiting)).toBe("business");
  expect(caseAttention({ ...waiting, status: "processing", run: { id: "run", revision: 1, startedAt: "2026-10-23T12:00:00Z", activeRole: "reviewer" } })).toBeNull();
  expect(caseAttention({ ...waiting, reviewHold: true })).toBe("operator");
  expect(caseAttention({ ...waiting, takeover: true })).toBe("operator");
  expect(caseAttention({ ...waiting, status: "needs_review" })).toBe("operator");
  expect(caseAttention({ ...waiting, stopped: true, reviewHold: true })).toBeNull();
  expect(caseAttention({ ...ready, status: "run_failed" })).toBeNull();
  expect(caseAttention({ ...ready, status: "run_failed", reviewHold: true })).toBe("operator");
});

test("an attributed report returns attention to the customer; absent request IDs never light the inbox", () => {
  expect(caseAttention({ ...waiting, requestId: null })).toBe("customer");
  expect(caseAttention({ ...waiting, status: "ready", verification: { ...waiting.verification!, outcome: "business_reported", amountCents: 5000, invoiceId: "INV-101", businessMessage: null } })).toBe("customer");
  for (const outcome of ["needs_facts", "pending", "conflicting"] as const) expect(caseAttention({ ...waiting, verification: { ...waiting.verification!, outcome } })).toBe("business");
});

test("opening outreach uses dated source facts and labels its synthetic provenance", () => {
  const at = new Date("2026-10-23T12:00:00Z");
  const facts = startingCases(at)[1];
  const opening = openingMessage(facts, at);
  expect(opening).toMatchObject({ speaker: "agent", channel: "customer", origin: "synthetic_opening", at: at.toISOString() });
  expect(opening.text).toContain("Sam"); expect(opening.text).toContain("$79.00"); expect(opening.text).toContain("INV-102"); expect(opening.text).toContain("2026-10-22");
});

// The UI helper imports store types only; it cannot execute persistence or model work.
test("legacy case state needs no new runtime or opening fields to choose attention", () => {
  const legacy = { ...ready, lastReview: null } satisfies Partial<CaseState>;
  expect(caseAttention(legacy)).toBe("customer");
});
