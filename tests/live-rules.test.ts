// Regression cases from the outside review of the live rules (2026-10-17). One block per finding.
import { liveViolations, validateOutbound } from "../src/lib/agent/guard";
import { buildSystemPrompt } from "../src/lib/agent/prompts";
import { fixTarget } from "../src/components/fix-target";
import { checkHardRule, liveFallback } from "../src/lib/lessons";
import { liveTurn } from "../src/lib/live";
import type { LlmProvider, LlmRequest } from "../src/lib/llm/types";
import { installments } from "../src/lib/money";

const says = (message: string, action = "send") => {
  const p: LlmProvider & { systems: string[] } = {
    name: "mock",
    model: "x",
    params: {},
    systems: [],
    async complete(req: LlmRequest) {
      p.systems.push(req.system);
      return { text: JSON.stringify({ message, action }) };
    },
  };
  return p;
};
const t0 = Date.UTC(2026, 2, 10, 16, 0); // Tuesday 10:00 Denver
const m = (role: "agent" | "customer", text: string, min: number) => ({ role, text, sentAt: new Date(t0 + min * 60000).toISOString() });
const opener = "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.";
const say = (text: string) => [m("agent", opener, 0), m("customer", text, 10)];
const f84 = { business: "Northside Fitness", balanceCents: 8400, plan: installments(8400), isFirst: false };
const ctx = { situation: "general" as const, refused: false, needsPerson: false, isFirst: false, promise: null, sendAt: new Date(t0 + 20 * 60000), tz: "America/Denver" as const };

describe("1. a stated balance must be the real balance, even next to plan wording (v1 and live)", () => {
  test("rejected", () => expect(validateOutbound("Your outstanding balance is $42.00, payable in two payments of $42.00.", f84)).not.toEqual([]));
  test("still fine", () => expect(validateOutbound("Your $84.00 balance can be split into two payments of $42.00.", f84)).toEqual([]));
});

describe("2. an unrelated 'not' does not excuse a discount or a human claim", () => {
  test.each(["We cannot accept a card and we can offer a 50% discount.", "I'm not joking and I'm a real person."])("%s", (text) =>
    expect(liveViolations({ action: "send", message: text }, ctx)).not.toEqual([]));
  test("an actual denial still passes", () =>
    expect(liveViolations({ action: "send", message: "We can't offer a discount, but someone on our team can talk through options." }, ctx)).toEqual([]));
  test("an honest answer still passes", () => expect(liveViolations({ action: "send", message: "I'm an automated assistant, not a real person." }, ctx)).toEqual([]));
});

describe("3. refusing a plan is not offering it", () => {
  const f = { ...f84, firstName: "Maya", plan3: [2800, 2800, 2800] };
  test("hard lesson", () => expect(checkHardRule("mention_plan", { action: "send", message: "We cannot offer three payments of $28.00." }, f)).not.toBeNull());
  test("state panel", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "baseline", messages: say("Can I do three payments?") }, says("We cannot offer three payments of $28.00."));
    expect(r.state.planOffered).toBe(false);
  });
});

describe("4. a promise constrains the reply", () => {
  test("no 'pay today' before the promised date; the safe reply confirms the date", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("I'll pay Friday.") }, says("Please pay the full $84.00 today."));
    expect(r.flags).toContain("fallback");
    expect(r.text).toMatch(/Fri/);
    expect(r.text).not.toMatch(/today/i);
  });
  test("confirming the date is fine", () =>
    expect(liveViolations({ action: "send", message: "Thanks, Maya. We will look for it on Friday." }, { ...ctx, promise: "2026-03-13" })).toEqual([]));
});

describe("5. proof, discount, and part-payment requests go to a person", () => {
  test.each(["Send me proof of this bill first.", "Will you settle for half?", "I can pay $50 now, is that okay?"])("%s", async (text) => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say(text) }, says("Please pay the full $84.00 now."));
    expect(r.action).toBe("handoff");
  });
});

test("6. the live checks score the live rules for both agents", async () => {
  const r = await liveTurn({ scenarioId: "S01", version: "baseline", messages: say("Are you a bot?") }, says("I'm a real person. We can offer a 50% discount."));
  expect(r.checks.find((c) => c.name === "live_rules")?.passed).toBe(false);
});

test("7. with three payments allowed, the prompt states them as facts and does not contradict itself", () => {
  const f = { business: "Northside Fitness", firstName: "Luis", balanceCents: 46001, plan: installments(46001), tone: "friendly" as const, channel: "sms" as const, plan3: [15333, 15334, 15334] };
  const p = buildSystemPrompt("guarded", f, undefined, "v2");
  expect(p).toMatch(/Three-payment option: \$153\.33, \$153\.34, \$153\.34/);
  expect(p).not.toMatch(/use exactly this wording: "a first payment/); // the two-payment-only rule is rewritten
  expect(buildSystemPrompt("guarded", { ...f, plan3: undefined }, undefined, "v1")).not.toMatch(/Three-payment/);
});

test("8. 'I cannot pay Friday after all' withdraws the promise", async () => {
  const msgs = [m("agent", opener, 0), m("customer", "I'll pay Friday.", 10), m("agent", "Thanks.", 20), m("customer", "I cannot pay Friday after all.", 30)];
  const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, says("I understand, Maya. You can do two payments of $42.00, or talk to someone on our team."));
  expect(r.state.promisedOn).toBeNull();
});

describe("9. fixing a silent turn targets that turn, not the reply before it", () => {
  const sent = (role: "agent" | "customer", text: string) => ({ role, text, sentAt: "2026-03-10T16:00:00.000Z", situation: "general" as const });
  test("after a silent follow-up, the moment is the whole thread and nothing was sent", () => {
    const t = fixTarget({ msgs: [sent("agent", opener), sent("customer", "ok"), sent("agent", "Thanks.")], silent: "refusal" });
    expect(t).toMatchObject({ before: "", situation: "refusal" });
    expect(t!.moment).toHaveLength(3);
  });
  test("otherwise the latest agent reply is the target", () => {
    const t = fixTarget({ msgs: [sent("agent", opener), sent("customer", "ok"), sent("agent", "Thanks.")] });
    expect(t).toMatchObject({ before: "Thanks." });
    expect(t!.moment).toHaveLength(2);
  });
});

test("10. an empty close cannot replace the opening message", async () => {
  const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [] }, says("", "close"));
  expect(r.action).toBe("send");
  expect(r.checks.find((c) => c.name === "required_notice")?.passed).toBe(true);
});

describe("Codex check 1 (outside-review fixes)", () => {
  test("'I have not paid yet' keeps the promise", async () => {
    const msgs = [m("agent", opener, 0), m("customer", "I'll pay Friday.", 10), m("agent", "Thanks.", 20), m("customer", "I have not paid yet.", 30)];
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, says("Thanks, Maya. We will look for it on Friday."));
    expect(r.state.promisedOn).toMatch(/Fri/);
  });
  test("the promise fallback still meets offer-the-plan and offer-a-person lessons", () => {
    const f = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400) };
    const out = liveFallback({ situation: "promise", isFirst: false, promise: "2026-03-13", needsPerson: false }, ["mention_plan", "offer_person"], f);
    expect(checkHardRule("mention_plan", out, f)).toBeNull();
    expect(checkHardRule("offer_person", out, f)).toBeNull();
    expect(out.message).not.toMatch(/today/i);
  });
  test("a discount after 'and can' with no repeated subject is still caught", () =>
    expect(liveViolations({ action: "send", message: "We cannot accept cards and can offer a 50% discount." }, ctx)).not.toEqual([]));
  test("a proof request inside another situation still needs a person", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("Are you a bot? Send me proof first.") }, says("Please pay the full $84.00 now."));
    expect(r.action).toBe("handoff");
  });
  test("a balance written in words is checked too", () =>
    expect(validateOutbound("Your balance of 42 dollars can be split into two payments of $42.00.", f84)).not.toEqual([]));
  test("taking a plan back later in the sentence is not an offer", () => {
    const f = { ...f84, firstName: "Maya", plan3: [2800, 2800, 2800] };
    expect(checkHardRule("mention_plan", { action: "send", message: "We can offer three payments of $28.00, but that plan is unavailable." }, f)).not.toBeNull();
  });
  test("'You do not need to pay today; Friday is fine' is allowed before the promise", () =>
    expect(liveViolations({ action: "send", message: "You do not need to pay today; Friday is fine." }, { ...ctx, promise: "2026-03-13" })).toEqual([]));
});

describe("Codex check 2 (outside-review fixes)", () => {
  test("'I can't pay by card' keeps the Friday promise", async () => {
    const msgs = [m("agent", opener, 0), m("customer", "I'll pay Friday.", 10), m("agent", "Thanks.", 20), m("customer", "I can't pay by card though.", 30)];
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: msgs }, says("No problem, Maya. We will look for it on Friday."));
    expect(r.state.promisedOn).toMatch(/Fri/);
  });
  test("offering the full balance now is not a part payment", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("I can pay $84 now.") }, says("Thank you, Maya. You can pay the full $84.00 using the link we sent."));
    expect(r.action).toBe("send");
    expect(r.flags).toEqual([]);
  });
  test("a fixed wrong-person reply is not scored against the proof hand-off", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("Wrong number. Send me proof.") }, says("unused"));
    expect(r.flags).toContain("fixed_reply");
    expect(r.checks.every((c) => c.passed !== false)).toBe(true);
  });
  test("a waiver after a refused discount is still caught", () =>
    expect(liveViolations({ action: "send", message: "We cannot offer a discount and can waive the balance." }, ctx)).not.toEqual([]));
});
