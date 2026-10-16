import { readFileSync } from "node:fs";
import { buildSystemPrompt } from "../src/lib/agent/prompts";
import { checkHardRule, DraftLesson, HARD_RULES, type Lesson, pickLessons, REASONS, ruleFallback } from "../src/lib/lessons";
import { liveTurn } from "../src/lib/live";
import type { LlmProvider, LlmRequest } from "../src/lib/llm/types";
import { installments } from "../src/lib/money";

const lesson = (id: number, p: Partial<Lesson> = {}): Lesson => ({
  id,
  createdAt: new Date(Date.UTC(2026, 9, 16, 12, id)).toISOString(),
  situation: "refusal",
  reason: "gave_up",
  instruction: `Lesson ${id}: acknowledge it and offer the plan or a person.`,
  hardRule: null,
  appliesTo: "situation",
  scenarioId: "S01",
  moment: [],
  beforeText: "Understood. Thanks.",
  afterText: "I hear you. You can split it into two payments of $42.00, or talk to someone on our team.",
  active: true,
  timesUsed: 0,
  ...p,
});

describe("pickLessons", () => {
  test("same situation only, newest first, inactive skipped, at most 8", () => {
    const all = [
      ...Array.from({ length: 9 }, (_, i) => lesson(i + 1)),
      lesson(20, { situation: "general" }),
      lesson(21, { situation: "hardship" }),
      lesson(22, { active: false }),
    ];
    const ids = pickLessons(all, "refusal").map((l) => l.id);
    expect(ids).toEqual([9, 8, 7, 6, 5, 4, 3, 2]); // "general" (20) no longer leaks into other situations
  });
});

describe("hard rules", () => {
  const facts = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400) };
  test.each([
    ["no_close", { action: "close", message: "Bye." }],
    ["mention_plan", { action: "send", message: "Please pay soon." }],
    ["offer_person", { action: "send", message: "Please pay soon." }],
    ["handoff", { action: "send", message: "Please pay soon." }],
  ] as const)("%s catches a bad reply", (rule, out) => expect(checkHardRule(rule, out, facts)).not.toBeNull());

  test.each(HARD_RULES.map((r) => r.id))("the fallback for %s satisfies it", (rule) => {
    expect(checkHardRule(rule, ruleFallback([rule], facts), facts)).toBeNull();
  });
});

describe("DraftLesson input", () => {
  test("instruction is limited to 300 characters", () => {
    expect(DraftLesson.safeParse({ reason: "gave_up", instruction: "x".repeat(301), hardRule: null }).success).toBe(false);
  });
  test("an empty instruction is rejected", () => expect(DraftLesson.safeParse({ reason: "gave_up", instruction: "  ", hardRule: null }).success).toBe(false));
  test("unknown hard rule is rejected", () => expect(DraftLesson.safeParse({ reason: "other", instruction: "ok", hardRule: "delete_db" }).success).toBe(false));
});

describe("prompt", () => {
  const f = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400), tone: "friendly" as const, channel: "sms" as const };
  test("corrections go after the rules and before the account facts, guarded only", () => {
    const p = buildSystemPrompt("guarded", f, undefined, "v2", ["Do not give up."]);
    expect(p.indexOf("Corrections from your supervisor")).toBeGreaterThan(p.indexOf("Rules:"));
    expect(p.indexOf("Corrections from your supervisor")).toBeLessThan(p.indexOf("Account facts:"));
    expect(buildSystemPrompt("baseline", f, undefined, "v2", ["Do not give up."])).not.toContain("supervisor");
  });
  test("no lessons, no section", () => expect(buildSystemPrompt("guarded", f, undefined, "v2")).not.toContain("supervisor"));
});

function capture(message: string, action = "send") {
  const p: LlmProvider & { systems: string[] } = {
    name: "mock",
    model: "capture",
    params: {},
    systems: [],
    async complete(req: LlmRequest) {
      p.systems.push(req.system);
      return { text: JSON.stringify({ message, action }) };
    },
  };
  return p;
}
const opened = [{ role: "agent" as const, text: "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", sentAt: "2026-03-10T16:00:00.000Z" }];
const say = (text: string) => [...opened, { role: "customer" as const, text, sentAt: "2026-03-10T16:10:00.000Z" }];

describe("lessons in a live turn", () => {
  test("a matching soft lesson is sent and reported; another situation's is not", async () => {
    const p = capture("I hear you, Maya. You can do two payments of $42.00, or talk to someone on our team.");
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("I don't want to pay you") }, p, [lesson(3), lesson(4, { situation: "hardship", instruction: "HARDSHIP ONLY" })]);
    expect(p.systems[0]).toContain("Lesson 3");
    expect(p.systems[0]).not.toContain("HARDSHIP ONLY");
    expect(r.lessonsUsed).toEqual([3]);
    expect(r.trace.join(" ")).toMatch(/lesson #3 applied/);
  });
  test("the baseline never gets lessons", async () => {
    const p = capture("ok", "close");
    const r = await liveTurn({ scenarioId: "S01", version: "baseline", messages: say("I don't want to pay you") }, p, [lesson(3)]);
    expect(p.systems[0]).not.toContain("Lesson 3");
    expect(r.lessonsUsed).toEqual([]);
  });
  test("a hard lesson is enforced by code: rewrite, then a fallback that satisfies it", async () => {
    const p = capture("Thanks, take care.", "close");
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("Is there a payment plan?") }, p, [lesson(5, { situation: "plan_request", hardRule: "no_close" })]);
    expect(p.systems).toHaveLength(2);
    expect(r.action).toBe("send");
    expect(r.flags).toContain("fallback");
    expect(r.trace.join(" ")).toMatch(/lesson #5/);
  });
});

test("the read-only role may read lessons and nothing more", () => {
  const sql = readFileSync("db/ops/readonly_role.sql", "utf8");
  expect(sql).toMatch(/grant select on [^;]*\blessons\b/);
  expect(sql).not.toMatch(/grant (insert|update|delete)/i);
});

describe("Codex check 1 (16b)", () => {
  const facts = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400) };
  test("mention_plan needs the plan actually offered", () => {
    expect(checkHardRule("mention_plan", { action: "send", message: "The $42.00 option is unavailable. Pay the full $84.00." }, facts)).not.toBeNull();
    expect(checkHardRule("mention_plan", { action: "send", message: "You can split it into two payments of $42.00." }, facts)).toBeNull();
  });
  test("offer_person needs an actual offer, not just the word team", () => {
    expect(checkHardRule("offer_person", { action: "send", message: "Our team cannot help you." }, facts)).not.toBeNull();
    expect(checkHardRule("offer_person", { action: "send", message: "If you like, you can talk it through with someone on our team." }, facts)).toBeNull();
  });
  test("no_close also forbids a silent stop chosen by the model", () => expect(checkHardRule("no_close", { action: "stop", message: "" }, facts)).not.toBeNull());

  test("a model-chosen stop does not skip hard lessons", async () => {
    const p = capture("", "stop");
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("Is there a payment plan?") }, p, [lesson(6, { situation: "plan_request", hardRule: "mention_plan" })]);
    expect(r.action).toBe("send");
    expect(r.text).toMatch(/\$42\.00/);
  });
  test("a model-chosen stop on a refusal counts as giving up", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("I don't want to pay you") }, capture("", "stop"));
    expect(r.action).toBe("send");
    expect(r.flags).toContain("fallback");
  });
  test("a handoff lesson never replaces the opening message", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [] }, capture("Hi Maya, this is Northside Fitness. Your account is past due with a balance of $84.00."), [
      lesson(8, { situation: "general", hardRule: "handoff" }),
    ]);
    expect(r.action).toBe("send");
    expect(r.checks.find((c) => c.name === "required_notice")?.passed).toBe(true);
  });
});

describe("Codex check 2 (16b)", () => {
  const facts = { business: "Northside Fitness", firstName: "Maya", balanceCents: 8400, plan: installments(8400) };
  test("offer_person fails when nothing is sent", () => expect(checkHardRule("offer_person", { action: "stop", message: "Talk to someone on our team." }, facts)).not.toBeNull());
  test.each(["We cannot offer two payments of $42.00.", "Two payments of $42.00 are no longer available."])("mention_plan rejects a refusal: %s", (message) =>
    expect(checkHardRule("mention_plan", { action: "send", message }, facts)).not.toBeNull());
  test("mention_plan still accepts a plan after an unrelated 'don't'", () =>
    expect(checkHardRule("mention_plan", { action: "send", message: "Don't worry, you can split it into two payments of $42.00." }, facts)).toBeNull());
  test("offer_person rejects 'Do not talk to our team'", () => expect(checkHardRule("offer_person", { action: "send", message: "Do not talk to our team." }, facts)).not.toBeNull());
});

describe("lesson scope (Akshay's review)", () => {
  test("a lesson applies to its own situation only, unless it is set to every reply", () => {
    const all = [lesson(1, { situation: "general" }), lesson(2, { situation: "plan_request" }), lesson(3, { situation: "plan_request", appliesTo: "all" })];
    expect(pickLessons(all, "refusal").map((l) => l.id)).toEqual([3]);
    expect(pickLessons(all, "plan_request").map((l) => l.id)).toEqual([3, 2]);
    expect(pickLessons(all, "general").map((l) => l.id)).toEqual([3, 1]);
  });
  test("no lesson ever touches the opening message", async () => {
    const p = capture("Hi Maya, this is Northside Fitness. Your account is past due with a balance of $84.00.");
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: [] }, p, [lesson(1, { appliesTo: "all", situation: "general" })]);
    expect(r.lessonsUsed).toEqual([]);
    expect(p.systems[0]).not.toContain("supervisor");
  });
  test("a hand-off rule cannot apply to every reply (it would end every conversation)", () => {
    expect(DraftLesson.safeParse({ reason: "other", instruction: "x", hardRule: "handoff", appliesTo: "all" }).success).toBe(false);
    expect(DraftLesson.safeParse({ reason: "other", instruction: "x", hardRule: "handoff", appliesTo: "situation" }).success).toBe(true);
  });
  test("scope defaults to the situation", () => expect(DraftLesson.parse({ reason: "other", instruction: "x", hardRule: null }).appliesTo).toBe("situation"));
  test("each reason except 'something else' suggests a lesson", () => {
    for (const r of REASONS.filter((x) => x.id !== "other")) expect(r.suggest.instruction.length).toBeGreaterThan(20);
  });
  test("the live turn reports how it read the customer", async () => {
    const r = await liveTurn({ scenarioId: "S01", version: "guarded", messages: say("Can I get a better payment options") }, capture("Sure, two payments of $42.00 work."));
    expect(r.situation).toBe("plan_request");
  });
});

describe("Codex check 1 (16c)", () => {
  test("mention_plan accepts an allowed three-payment offer", () => {
    const f = { business: "Northside Fitness", firstName: "Luis", balanceCents: 46001, plan: installments(46001), plan3: [15333, 15334, 15334] };
    expect(checkHardRule("mention_plan", { action: "send", message: "Sure: three payments of $153.33, $153.34 and $153.34." }, f)).toBeNull();
  });
});
