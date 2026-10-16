import { HANDOFF_TEXT } from "../src/lib/agent/guard";
import { liveTurn } from "../src/lib/live";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";
import type { LlmProvider } from "../src/lib/llm/types";

function counting(inner: LlmProvider) {
  const p = { ...inner, calls: 0, async complete(r: Parameters<LlmProvider["complete"]>[0]) { p.calls++; return inner.complete(r); } };
  return p;
}

test("opening turn: guarded S11 is held until 8am and its checks are reported", async () => {
  const r = await liveTurn({ scenarioId: "S11", version: "guarded", messages: [] }, mockProvider());
  expect(r.action).toBe("send");
  expect(r.flags).toContain("rescheduled");
  expect(r.when).toMatch(/8:00/);
  expect(r.checks.find((c) => c.name === "quiet_hours")?.passed).toBe(true);
  expect(r.checks.find((c) => c.name === "required_notice")?.passed).toBe(true);
});

test("baseline S11 sends at 6am and fails quiet hours", async () => {
  const r = await liveTurn({ scenarioId: "S11", version: "baseline", messages: [] }, mockProvider());
  expect(r.when).toMatch(/6:00/);
  expect(r.checks.find((c) => c.name === "quiet_hours")?.passed).toBe(false);
});

const opened = [{ role: "agent" as const, text: "Hi, this is Northside Fitness...", sentAt: "2026-03-10T16:00:00.000Z" }];

test("guarded: a customer STOP ends the thread with no model call", async () => {
  const p = counting(mockProvider());
  const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [...opened, { role: "customer", text: "STOP", sentAt: "2026-03-10T16:10:00.000Z" }] }, p);
  expect(r.action).toBe("stop");
  expect(r.text).toBe("");
  expect(p.calls).toBe(0);
});

test("guarded: a dispute gets the fixed handoff with no model call", async () => {
  const p = counting(mockProvider());
  const r = await liveTurn(
    { scenarioId: "S01", version: "guarded", messages: [...opened, { role: "customer", text: "I already paid this", sentAt: "2026-03-10T16:10:00.000Z" }] },
    p,
  );
  expect(r).toMatchObject({ action: "handoff", text: HANDOFF_TEXT });
  expect(p.calls).toBe(0);
});

test("guarded rewrites a bad model reply; baseline sends it and fails the checks", async () => {
  const g = await liveTurn({ scenarioId: "S08", version: "guarded", messages: [] }, mockBadProvider());
  expect(g.flags).toContain("fallback");
  expect(g.checks.every((c) => c.passed !== false)).toBe(true);
  const b = await liveTurn({ scenarioId: "S08", version: "baseline", messages: [] }, mockBadProvider());
  expect(b.checks.find((c) => c.name === "no_threats_or_false_claims")?.passed).toBe(false);
});

test("the next message is proposed 10 minutes after the last one", async () => {
  const r = await liveTurn(
    { scenarioId: "S01", version: "baseline", messages: [...opened, { role: "customer", text: "Is there a plan?", sentAt: "2026-03-10T16:10:00.000Z" }] },
    mockProvider(),
  );
  expect(r.sentAt).toBe("2026-03-10T16:20:00.000Z");
});

describe("input limits", () => {
  test.each([
    [{ scenarioId: "S99", version: "guarded", messages: [] }, /scenario/i],
    [{ scenarioId: "S01", version: "guarded", messages: [{ role: "customer", text: "x".repeat(501), sentAt: "2026-03-10T16:10:00.000Z" }] }, /500/],
    [{ scenarioId: "S01", version: "evil", messages: [] }, /version/i],
  ])("rejects bad input %#", async (input, msg) => {
    await expect(liveTurn(input, mockProvider())).rejects.toThrow(msg);
  });

  test("no more than six agent replies", async () => {
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 ? "customer" : "agent") as "agent" | "customer",
      text: "hi",
      sentAt: new Date(Date.UTC(2026, 2, 10, 16, i * 10)).toISOString(),
    }));
    await expect(liveTurn({ scenarioId: "S01", version: "baseline", messages: msgs }, mockProvider())).rejects.toThrow(/six/);
  });
});

test("long agent messages in the history are fine; only customer text is capped at 500", async () => {
  const msgs = [
    { role: "agent" as const, text: "a".repeat(800), sentAt: "2026-03-10T16:00:00.000Z" },
    { role: "customer" as const, text: "ok", sentAt: "2026-03-10T16:10:00.000Z" },
  ];
  await expect(liveTurn({ scenarioId: "S01", version: "baseline", messages: msgs }, mockProvider())).resolves.toBeTruthy();
});
