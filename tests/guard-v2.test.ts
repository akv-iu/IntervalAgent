import { validateV2 } from "../src/lib/agent/guard";
import { liveTurn } from "../src/lib/live";
import { mockProvider } from "../src/lib/llm/mock";
import type { LlmProvider } from "../src/lib/llm/types";
import { installments } from "../src/lib/money";
import { agentTurn } from "../src/lib/sim/loop";

// A model that always answers with the same JSON, counting calls.
function fixed(message: string, action = "send") {
  const p: LlmProvider & { calls: number } = {
    name: "mock",
    model: "fixed",
    params: {},
    calls: 0,
    async complete() {
      p.calls++;
      return { text: JSON.stringify({ message, action }) };
    },
  };
  return p;
}

// S01: Maya, $84.00, Denver. Opened at 10:00 local (16:00Z).
const opened = [{ role: "agent" as const, text: "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", sentAt: "2026-03-10T16:00:00.000Z" }];
const say = (text: string) => [...opened, { role: "customer" as const, text, sentAt: "2026-03-10T16:10:00.000Z" }];
const guarded = (text: string, p: LlmProvider, scenarioId = "S01") => liveTurn({ scenarioId, version: "guarded", messages: say(text) }, p);

describe("fixed replies with no model call", () => {
  test("wrong person: no amounts, no debt details, contact ends", async () => {
    const p = fixed("unused");
    const r = await guarded("This isn't Maya, you have the wrong number.", p);
    expect(r.action).toBe("close");
    expect(r.text).not.toMatch(/\$|balance|overdue|past due|owe/i);
    expect(r.flags).toContain("fixed_reply");
    expect(p.calls).toBe(0);
  });
  test.each(["Maya passed away last month.", "Talk to my lawyer."])("%s hands off", async (text) => {
    const p = fixed("unused");
    const r = await guarded(text, p);
    expect(r.action).toBe("handoff");
    expect(r.text).not.toMatch(/\$/);
    expect(p.calls).toBe(0);
  });
});

describe("draft checks: regenerate once, then a safe fallback", () => {
  test("a refusal may not be answered by giving up", async () => {
    const p = fixed("Understood, Maya. Thanks for letting us know.", "close");
    const r = await guarded("I don't want to pay you", p);
    expect(p.calls).toBe(2);
    expect(r.action).toBe("send");
    expect(r.flags).toEqual(expect.arrayContaining(["regenerated", "fallback"]));
    expect(r.text).toMatch(/\$42\.00/);
    expect(r.text).toMatch(/team/i);
    expect(r.trace.join(" ")).toMatch(/refus/i);
  });
  test("no discounts on a settlement request", async () => {
    const r = await guarded("Will you settle for half?", fixed("Sure, we can take 50% off, so $42.00 settles it."));
    expect(r.flags).toContain("fallback");
    expect(r.text).not.toMatch(/%/);
  });
  test("never claims to be human", async () => {
    const r = await guarded("Are you a bot or a real person?", fixed("I'm a real person on the Northside Fitness team."));
    expect(r.flags).toContain("fallback");
  });
  test("a good draft passes untouched and the trace says how the message was read", async () => {
    const r = await guarded("I don't want to pay you", fixed("I hear you, Maya. If it helps, you can pay two payments of $42.00, or talk to someone on our team."));
    expect(r.flags).toEqual([]);
    expect(r.trace[0]).toMatch(/refusal/);
  });
});

describe("validateV2", () => {
  test("a refusal of a discount is fine", () => expect(validateV2("I can't offer a discount, but a team member can talk through options.", "send", "settlement")).toEqual([]));
  test("waivers are never offered", () => expect(validateV2("We can waive the balance for you.", "send", "override")).not.toEqual([]));
  test("closing is fine when the customer did not refuse", () => expect(validateV2("Thanks, talk soon.", "close", "general")).toEqual([]));
});

test("a requested time is honored on top of quiet hours", async () => {
  // S02: Jordan, New York, opened 14:00 local (18:00Z). Asks at 14:10 for after 6pm.
  const msgs = [
    { role: "agent" as const, text: "Hi Jordan, this is Northside Fitness. Your $315.00 balance is past due.", sentAt: "2026-03-10T18:00:00.000Z" },
    { role: "customer" as const, text: "I'm at work, text me after 6pm.", sentAt: "2026-03-10T18:10:00.000Z" },
  ];
  const r = await liveTurn({ scenarioId: "S02", version: "guarded", messages: msgs }, mockProvider());
  expect(r.sentAt).toBe("2026-03-10T22:00:00.000Z");
  expect(r.flags).toEqual(["customer_time"]); // not "moved into 8am to 9pm": the customer asked for it
  expect(r.trace.join(" ")).toMatch(/after 6:00 PM/);
});

test("rules v1 (the evals) are unchanged: the same discount draft is sent as is", async () => {
  const facts = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400), tone: "friendly" as const, channel: "sms" as const };
  const t = await agentTurn({
    version: "guarded",
    facts,
    tz: "America/Denver",
    history: say("This isn't Maya, settle for half?").map(({ role, text }) => ({ role, text })),
    lastCustomer: "This isn't Maya, settle for half?",
    proposedAt: new Date("2026-03-10T16:20:00.000Z"),
    isFirst: false,
    provider: fixed("Sure, we can take 50% off, so $42.00 settles it."),
    subject: "S01",
    turn: 2,
    stats: { calls: 0 },
  });
  expect(t.action).toBe("send");
  expect(t.flags).toEqual([]);
});

describe("Codex check 1 findings", () => {
  test("v1: a bad draft rewritten as an empty close still falls back (unchanged eval behavior)", async () => {
    let n = 0;
    const p: LlmProvider = {
      name: "mock",
      model: "seq",
      params: {},
      async complete() {
        n++;
        return { text: JSON.stringify(n === 1 ? { message: "FINAL NOTICE: pay today or we sue you.", action: "send" } : { message: "", action: "close" }) };
      },
    };
    const facts = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400), tone: "friendly" as const, channel: "sms" as const };
    const t = await agentTurn({ version: "guarded", facts, tz: "America/Denver", history: [], lastCustomer: null, proposedAt: new Date("2026-03-10T16:00:00.000Z"), isFirst: true, provider: p, subject: "S01", turn: 1, stats: { calls: 0 } });
    expect(t.flags).toEqual(["regenerated", "fallback"]);
    expect(t.action).toBe("send");
  });
  test("'no problem' does not excuse a discount offer", () => expect(validateV2("We can offer a 50% discount, no problem.", "send", "settlement")).not.toEqual([]));
  test.each(["You are speaking with a real person.", "Yes, this is a real person.", "I'm not a robot.", "No, I'm not an AI."])("claims to be human: %s", (text) =>
    expect(validateV2(text, "send", "bot_question")).not.toEqual([]));
  test("an honest answer passes", () => expect(validateV2("I'm an automated assistant, not a real person.", "send", "bot_question")).toEqual([]));
  test("a refusal inside a hardship message still forbids giving up", async () => {
    const r = await guarded("I lost my job and I will not pay", fixed("Understood. Take care.", "close"));
    expect(r.action).toBe("send");
    expect(r.flags).toContain("fallback");
  });
});

describe("Codex check 2: a negation only counts in its own clause", () => {
  test("a 'cannot' in another clause does not excuse a discount", () =>
    expect(validateV2("We cannot take full payment today, but we can offer a 50% discount.", "send", "settlement")).not.toEqual([]));
  test("a 'not' in another clause does not excuse a human claim", () =>
    expect(validateV2("I'm a real person, not an automated assistant.", "send", "bot_question")).not.toEqual([]));
  test("still fine: refusing a discount, then pointing to the team", () =>
    expect(validateV2("I can't offer a discount, but someone on our team can talk through options.", "send", "settlement")).toEqual([]));
});
