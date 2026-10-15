import { Artifact } from "../src/lib/artifact";
import { runBulk } from "../src/lib/sim/bulk";
import { localHour } from "../src/lib/time";
import { demoAccounts } from "../src/lib/sim/accounts";

const meta = { runId: "bulk-test", createdAt: "2026-10-15T12:00:00.000Z" };

test("limit 10 gives 10 guarded demo conversations with fixed settings", async () => {
  const a = await runBulk({ ...meta, limit: 10 });
  expect(a.kind).toBe("bulk");
  expect(a.sourceMode).toBe("mock");
  expect(a.conversations).toHaveLength(10);
  const tz = Object.fromEntries(demoAccounts().map((x) => [x.accountKey, x.timezone]));
  for (const c of a.conversations) {
    expect(c.accountKey).toMatch(/^demo-\d{3}$/);
    expect(c.scenarioId).toBeNull();
    expect(c.version).toBe("guarded");
    expect(c.channel).toBe("sms");
    expect(c.tone).toBe("friendly");
    expect(localHour(new Date(c.startedAt), tz[c.accountKey])).toBe(10);
    if (c.paidAt) expect(Date.parse(c.paidAt)).toBeLessThanOrEqual(Date.parse(a.reportAsOf));
  }
  expect(Artifact.safeParse(a).success).toBe(true);
});

test("limit 1 supports the early integration slice", async () => {
  const a = await runBulk({ ...meta, limit: 1 });
  expect(a.conversations.map((c) => c.accountKey)).toEqual(["demo-001"]);
});

test("full run covers all 100 accounts deterministically, with receipts and non-receipts", async () => {
  const a = await runBulk(meta);
  expect(a.conversations).toHaveLength(100);
  expect(await runBulk(meta)).toEqual(a);
  const outcomes = new Set(a.conversations.map((c) => c.outcome));
  expect(outcomes.has("agreed_to_pay")).toBe(true);
  expect(outcomes.has("payment_plan")).toBe(true);
  expect(a.status).toBe("complete");
});
