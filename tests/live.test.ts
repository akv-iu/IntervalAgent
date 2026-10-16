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

  test("no more than ten agent replies on the live page", async () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 ? "customer" : "agent") as "agent" | "customer",
      text: "hi",
      sentAt: new Date(Date.UTC(2026, 2, 10, 16, i * 10)).toISOString(),
    }));
    await expect(liveTurn({ scenarioId: "S01", version: "baseline", messages: msgs }, mockProvider())).rejects.toThrow(/ten/);
  });
});

test("long agent messages in the history are fine; only customer text is capped at 500", async () => {
  const msgs = [
    { role: "agent" as const, text: "a".repeat(800), sentAt: "2026-03-10T16:00:00.000Z" },
    { role: "customer" as const, text: "ok", sentAt: "2026-03-10T16:10:00.000Z" },
  ];
  await expect(liveTurn({ scenarioId: "S01", version: "baseline", messages: msgs }, mockProvider())).resolves.toBeTruthy();
});

describe("deeper conversations (16c)", () => {
  const t0 = Date.UTC(2026, 2, 10, 16, 0); // 10:00 Denver
  const m = (role: "agent" | "customer", text: string, minutes: number) => ({ role, text, sentAt: new Date(t0 + minutes * 60000).toISOString() });

  test("times may not go backwards", async () => {
    const msgs = [m("agent", "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", 0), m("customer", "ok", -5)];
    await expect(liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, mockProvider())).rejects.toThrow(/order/);
  });

  test("a customer who goes quiet after promising Friday gets a follow-up on Friday at 10:00 local", async () => {
    const msgs = [
      m("agent", "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", 0),
      m("customer", "I'll pay Friday.", 10),
      m("agent", "Thanks, Maya. We will look for it on Friday.", 20),
    ];
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, mockProvider());
    expect(r.sentAt).toBe("2026-03-13T16:00:00.000Z"); // Friday 10:00 MST (DST starts March 8, so MDT: 16:00Z)
    expect(r.state.promisedOn).toMatch(/Fri/);
  });

  test("with no promise, a follow-up waits until 10:00 the next day", async () => {
    const msgs = [m("agent", "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", 0)];
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, mockProvider());
    expect(r.sentAt).toBe("2026-03-11T16:00:00.000Z");
  });

  test("the panel shows what the agent knows", async () => {
    const msgs = [
      m("agent", "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due. You can do two payments of $42.00.", 0),
      m("customer", "I'll pay Friday. Text me after 6pm.", 10),
    ];
    // An agent that keeps the conversation open (the mock agent closes after a promise).
    const open = { name: "mock" as const, model: "x", params: {}, async complete() { return { text: JSON.stringify({ message: "Thanks, Maya. We will look for it on Friday.", action: "send" }) }; } };
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, open);
    expect(r.state).toMatchObject({ balance: "$84.00", planOffered: true, stopped: false, disputed: false });
    expect(r.state.promisedOn).toMatch(/Fri, Mar 13/);
    expect(r.state.contactAfter).toBe("6:00 PM");
    expect(r.state.lastSent).toBe(r.when);
    // If Maya now goes quiet, the guarded agent would follow up on the promised Friday, after 6pm as she asked.
    expect(r.state.nextFollowUp).toMatch(/Mar 13, 6:00 PM/);
  });

  test("after the customer asks for three payments, the guarded agent may offer an exact three-way split", async () => {
    const msgs = [
      { role: "agent" as const, text: "Hi Luis, this is Northside Fitness. Your $460.01 balance is past due.", sentAt: "2026-03-10T23:00:00.000Z" },
      { role: "customer" as const, text: "Can I split it into three payments?", sentAt: "2026-03-10T23:10:00.000Z" },
    ];
    const p = { name: "mock" as const, model: "x", params: {}, async complete() { return { text: JSON.stringify({ message: "Yes: three payments of $153.33, $153.34 and $153.34.", action: "send" }) }; } };
    const r = await liveTurn({ scenarioId: "S04", version: "guarded", messages: msgs }, p);
    expect(r.flags).toEqual([]);
    expect(r.state.planOffered).toBe(true);
    expect(r.checks.find((c) => c.name === "no_threats_or_false_claims")?.passed).toBe(true);
  });
});

describe("Codex check 1 (16c): live", () => {
  const t0 = Date.UTC(2026, 2, 10, 16, 0);
  const m = (role: "agent" | "customer", text: string, minutes: number) => ({ role, text, sentAt: new Date(t0 + minutes * 60000).toISOString() });
  const opener = "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.";
  test("declining three payments does not unlock them", async () => {
    const p = { name: "mock" as const, model: "x", params: {}, async complete() { return { text: JSON.stringify({ message: "Three payments of $28.00.", action: "send" }) }; } };
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [m("agent", opener, 0), m("customer", "I do not want three payments.", 10)] }, p);
    expect(r.flags).toContain("fallback");
  });
  test("a later refusal withdraws an earlier promise", async () => {
    const msgs = [m("agent", opener, 0), m("customer", "I'll pay Friday.", 10), m("agent", "Thanks.", 20), m("customer", "Actually I will not pay.", 30)];
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, mockProvider());
    expect(r.state.promisedOn).toBeNull();
  });
  test("an equal three-way offer counts as a plan offer", async () => {
    const p = { name: "mock" as const, model: "x", params: {}, async complete() { return { text: JSON.stringify({ message: "Sure, three payments of $28.00.", action: "send" }) }; } };
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [m("agent", opener, 0), m("customer", "Can I do three payments?", 10)] }, p);
    expect(r.flags).toEqual([]);
    expect(r.state.planOffered).toBe(true);
  });
});

describe("Codex check 2 (16c): live", () => {
  const t0 = Date.UTC(2026, 2, 10, 16, 0);
  const m = (role: "agent" | "customer", text: string, minutes: number) => ({ role, text, sentAt: new Date(t0 + minutes * 60000).toISOString() });
  const opener = "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.";
  const says = (message: string) => ({ name: "mock" as const, model: "x", params: {}, async complete() { return { text: JSON.stringify({ message, action: "send" }) }; } });
  test.each(["Text me in three days.", "I can't do three payments."])("no three-payment request: %s", async (text) => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [m("agent", opener, 0), m("customer", text, 10)] }, says("Three payments of $28.00."));
    expect(r.flags).toContain("fallback");
  });
  test("the tenth reply promises no follow-up: the limit ends the conversation", async () => {
    const msgs = Array.from({ length: 18 }, (_, i) => m(i % 2 ? "customer" : "agent", i % 2 ? "ok" : opener, i * 10));
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, says("Thanks, Maya."));
    expect(r.state.nextFollowUp).toBeNull();
  });
  test("the baseline's correct three-payment offer counts as a plan offer", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "baseline", messages: [m("agent", opener, 0), m("customer", "Can I do three payments?", 10)] }, says("Sure, three payments of $28.00."));
    expect(r.state.planOffered).toBe(true);
    expect(r.plan3).toEqual([2800, 2800, 2800]);
  });
});
