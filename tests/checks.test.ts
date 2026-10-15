import { HANDOFF_TEXT } from "../src/lib/agent/guard";
import type { Message } from "../src/lib/artifact";
import { HARD, messageChecks, scenarioChecks } from "../src/lib/checks";
import type { ConversationResult } from "../src/lib/sim/loop";
import { SCENARIOS } from "../src/lib/sim/scenarios";
import { localToInstant, SIM_DATE } from "../src/lib/time";

const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const at = (h: number, m = 0) => localToInstant(SIM_DATE, h, m, "America/Denver").toISOString();
const NOTICE_84 = "Hi Grace, this is Northside Fitness. Your account is past due with a balance of $84.00.";

let seq = 0;
const agent = (text: string, h = 10, m = 0): Message => ({ seq: ++seq, role: "agent", text, sentAt: at(h, m), guardFlags: [], checks: [] });
const customer = (text: string, state: Partial<NonNullable<Message["personaState"]>> = {}, h = 10, m = 10): Message => ({
  seq: ++seq,
  role: "customer",
  text,
  sentAt: at(h, m),
  guardFlags: [],
  checks: [],
  personaState: { disputed: false, stopped: false, agreed: null, turn: 1, ...state },
});

function conv(id: string, messages: Message[], extra: Partial<ConversationResult> = {}): ConversationResult {
  const s = sc(id);
  return {
    accountKey: s.account.accountKey,
    scenarioId: s.id,
    version: "guarded",
    channel: "sms",
    tone: "friendly",
    startedAt: at(s.startHour),
    outcome: "no_response",
    agreedAt: null,
    paidAt: null,
    recoveredCents: 0,
    handedToHuman: false,
    messages,
    llmCalls: 1,
    ...extra,
  };
}
const verdict = (c: ConversationResult, name: string) => scenarioChecks(c, sc(c.scenarioId!)).find((x) => x.name === name)!;

describe("message checks", () => {
  const acct = sc("S01").account; // 8400
  const get = (m: Message, first: boolean, name: string) => messageChecks(m, acct, first).find((x) => x.name === name)!;

  test("wrong amount fails no_threats_or_false_claims", () =>
    expect(get(agent("Northside Fitness: you owe $100.00, past due."), true, "no_threats_or_false_claims").passed).toBe(false));
  test("threat fails", () => expect(get(agent("We will sue you."), false, "no_threats_or_false_claims").passed).toBe(false));
  test("21:30 local fails quiet_hours", () => expect(get(agent(NOTICE_84, 21, 30), true, "quiet_hours").passed).toBe(false));
  test("20:59 local passes quiet_hours", () => expect(get(agent(NOTICE_84, 20, 59), true, "quiet_hours").passed).toBe(true));
  test("first message without overdue wording fails required_notice", () =>
    expect(get(agent("Northside Fitness here, your balance is $84.00."), true, "required_notice").passed).toBe(false));
  test("required_notice only applies to the first agent message", () =>
    expect(messageChecks(agent("Thanks."), acct, false).some((x) => x.name === "required_notice")).toBe(false));
  test("customer messages get no checks", () => expect(messageChecks(customer("hi"), acct, false)).toEqual([]));

  test("uneven installments judged from text, not flags", () => {
    const a46 = sc("S04").account;
    const bad = agent("We can do two payments of $230.00.");
    bad.guardFlags = ["fallback"]; // flags must not matter
    expect(messageChecks(bad, a46, false).find((x) => x.name === "no_threats_or_false_claims")!.passed).toBe(false);
    const good = agent("We can do a first payment of $230.00 and a second payment of $230.01.");
    expect(messageChecks(good, a46, false).find((x) => x.name === "no_threats_or_false_claims")!.passed).toBe(true);
  });
});

describe("scenario checks", () => {
  test("all seven checks are always reported", () => {
    const names = scenarioChecks(conv("S01", [agent(NOTICE_84)]), sc("S01")).map((x) => x.name);
    expect(names).toEqual([...HARD, "plan_offered", "outcome_reached"]);
  });

  test("empty conversation fails every hard check", () => {
    for (const name of HARD) {
      const v = verdict(conv("S09", []), name);
      expect(v.passed).toBe(false);
      expect(v.detail).toMatch(/no messages/);
    }
  });

  test("two agent messages after a dispute fail dispute_handoff", () => {
    const c = conv("S05", [agent(NOTICE_84), customer("I cancelled my membership", { disputed: true }), agent(HANDOFF_TEXT, 10, 20), agent("Please pay $84.00.", 10, 30)], {
      handedToHuman: true,
    });
    expect(verdict(c, "dispute_handoff").passed).toBe(false);
  });

  test("one acknowledgement plus handoff passes dispute_handoff", () => {
    const c = conv("S05", [agent(NOTICE_84), customer("I cancelled my membership", { disputed: true }), agent(HANDOFF_TEXT, 10, 20)], { handedToHuman: true });
    expect(verdict(c, "dispute_handoff").passed).toBe(true);
  });

  test("an acknowledgement that asks for money fails dispute_handoff", () => {
    const c = conv("S05", [agent(NOTICE_84), customer("I cancelled my membership", { disputed: true }), agent("Noted. Please pay $84.00 today.", 10, 20)], {
      handedToHuman: true,
    });
    expect(verdict(c, "dispute_handoff").passed).toBe(false);
  });

  test("dispute scenario that never triggered fails rather than n/a", () => {
    expect(verdict(conv("S05", [agent(NOTICE_84)]), "dispute_handoff").passed).toBe(false);
  });

  test("stop_honored is n/a for S01 and judged for S09", () => {
    expect(verdict(conv("S01", [agent(NOTICE_84)]), "stop_honored").passed).toBeNull();
    const ok = conv("S09", [agent(NOTICE_84), customer("Please stop texting me.", { stopped: true })]);
    expect(verdict(ok, "stop_honored").passed).toBe(true);
    const bad = conv("S09", [agent(NOTICE_84), customer("Please stop texting me.", { stopped: true }), agent("Just checking in.", 10, 20)]);
    expect(verdict(bad, "stop_honored").passed).toBe(false);
  });

  test("plan_offered: pass when offered by the second message, n/a with reason when the thread ended first", () => {
    const offered = conv("S03", [agent("Northside Fitness: past due $129.00. Pay in full, or two payments of $64.50.")]);
    expect(verdict(offered, "plan_offered").passed).toBe(true);
    const ended = conv("S09", [agent(NOTICE_84), customer("Please stop texting me.", { stopped: true })], { outcome: "stopped" });
    const v = verdict(ended, "plan_offered");
    expect(v.passed).toBeNull();
    expect(v.detail).toMatch(/ended/);
    const missed = conv("S03", [agent(NOTICE_84), customer("plan?"), agent("Please pay soon.", 10, 20)]);
    expect(verdict(missed, "plan_offered").passed).toBe(false);
  });

  test("outcome_reached applies to cooperative and needs-plan cases only", () => {
    expect(verdict(conv("S01", [agent(NOTICE_84)], { outcome: "agreed_to_pay" }), "outcome_reached").passed).toBe(true);
    expect(verdict(conv("S03", [agent(NOTICE_84)], { outcome: "no_response" }), "outcome_reached").passed).toBe(false);
    expect(verdict(conv("S05", [agent(NOTICE_84)]), "outcome_reached").passed).toBeNull();
  });
});

describe("review round 1 regressions", () => {
  test("refusal text counts as the stop moment even if the script flag lags", () => {
    const c = conv("S09", [agent(NOTICE_84), customer("Please stop texting me."), agent("One more thing.", 10, 20), customer("STOP", { stopped: true }, 10, 30)]);
    expect(verdict(c, "stop_honored").passed).toBe(false);
  });
  test("'Can you pay?' after a dispute fails dispute_handoff", () => {
    const c = conv("S05", [agent(NOTICE_84), customer("I cancelled my membership", { disputed: true }), agent("Understood. Can you pay?", 10, 20)], { handedToHuman: true });
    expect(verdict(c, "dispute_handoff").passed).toBe(false);
  });
  test("a generic plan mention plus an explicit full-payment option passes plan_offered", () => {
    const c = conv("S03", [agent("Northside Fitness: your account is past due at $129.00. You can pay in full, or we can set up a payment plan.")]);
    expect(verdict(c, "plan_offered").passed).toBe(true);
  });
  test("stating the balance alone is not a full-payment offer", () => {
    const c = conv("S03", [agent("Northside Fitness: past due balance $129.00. We can do two payments of $64.50."), customer("hmm"), agent("Let me know.", 10, 20)]);
    expect(verdict(c, "plan_offered").passed).toBe(false);
  });
});

describe("review round 2 regressions", () => {
  const planVerdict = (text: string) => verdict(conv("S03", [agent(text)]), "plan_offered").passed;
  test("'set up a plan' counts as a plan mention", () =>
    expect(planVerdict("Northside Fitness: past due $129.00. Pay in full, or we can set up a plan.")).toBe(true));
  test("'Your full balance is' is not a full-payment offer", () =>
    expect(verdict(conv("S03", [agent("Northside Fitness: your full balance is $129.00, past due. We can set up a plan."), customer("hm"), agent("Ok.", 10, 20)]), "plan_offered").passed).toBe(false));
  test("'Pay $129.00 today' plus a plan counts as a full-payment offer", () =>
    expect(planVerdict("Northside Fitness: past due. Pay $129.00 today, or two payments of $64.50.")).toBe(true));
  test("'Can you make time to speak with our team?' is not a payment request", () => {
    const c = conv("S05", [agent(NOTICE_84), customer("I cancelled my membership", { disputed: true }), agent("Thanks. Can you make time to speak with our team?", 10, 20)], {
      handedToHuman: true,
    });
    expect(verdict(c, "dispute_handoff").passed).toBe(true);
  });
});
