import { demoAccounts, dueDateFor } from "../src/lib/sim/accounts";
import { SCENARIOS } from "../src/lib/sim/scenarios";

const demo = demoAccounts();

test("100 demo accounts with stable keys", () => {
  expect(demo).toHaveLength(100);
  expect(demo[0].accountKey).toBe("demo-001");
  expect(demo[99].accountKey).toBe("demo-100");
  expect(new Set(demo.map((a) => a.accountKey)).size).toBe(100);
  expect(demo.every((a) => a.dataset === "demo" && a.business === "Northside Fitness")).toBe(true);
});

test("25 accounts per aging bucket, days match bucket", () => {
  const ranges = { "1-30": [1, 30], "31-60": [31, 60], "61-90": [61, 90], "91-120": [91, 120] } as const;
  for (const [bucket, [lo, hi]] of Object.entries(ranges)) {
    const rows = demo.filter((a) => a.agingBucket === bucket);
    expect(rows).toHaveLength(25);
    expect(rows.every((a) => a.daysPastDue >= lo && a.daysPastDue <= hi)).toBe(true);
  }
});

test("balances are integer cents in 3000..30000", () => {
  expect(demo.every((a) => Number.isInteger(a.balanceCents) && a.balanceCents >= 3000 && a.balanceCents <= 30000)).toBe(true);
});

test("six personas cycled evenly, 70 Denver / 30 New York", () => {
  const counts: Record<string, number> = {};
  for (const a of demo) counts[a.persona] = (counts[a.persona] ?? 0) + 1;
  expect(Object.keys(counts)).toHaveLength(6);
  expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
  expect(demo.filter((a) => a.timezone === "America/Denver")).toHaveLength(70);
  expect(demo.filter((a) => a.timezone === "America/New_York")).toHaveLength(30);
});

test("deterministic across calls", () => expect(demoAccounts()).toEqual(demo));

test("due date derives from the simulation date", () => {
  expect(dueDateFor(1)).toBe("2026-03-09");
  expect(dueDateFor(120)).toBe("2025-11-10");
  for (const x of demo) {
    const days = (Date.parse("2026-03-10") - Date.parse(x.dueDate)) / 86400000;
    expect(days).toBe(x.daysPastDue);
  }
});

test("12 scenarios match the SPEC table", () => {
  expect(SCENARIOS.map((s) => s.id)).toEqual(["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12"]);
  const by = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
  expect(by.S04.account.balanceCents).toBe(46001);
  expect(by.S12.startHour).toBe(22);
  expect(by.S11.startHour).toBe(6);
  expect(by.S02.account.timezone).toBe("America/New_York");
  expect(SCENARIOS.filter((s) => s.expect.bait).map((s) => s.id)).toEqual(["S08", "S10", "S12"]);
  expect(SCENARIOS.filter((s) => s.expect.dispute).map((s) => s.id)).toEqual(["S05", "S06"]);
  expect(SCENARIOS.filter((s) => s.expect.stop).map((s) => s.id)).toEqual(["S09", "S10"]);
  expect(SCENARIOS.every((s) => s.account.accountKey === `eval-${s.id}` && s.account.dataset === "eval")).toBe(true);
});
