import { installments } from "../src/lib/money";
import { initialPersonaState, personaReply } from "../src/lib/sim/personas";
import { SCENARIOS } from "../src/lib/sim/scenarios";

const ctx = (b: number) => ({ balanceCents: b, plan: installments(b) });
const s0 = initialPersonaState();
const notice = "Hi Maya, this is Northside Fitness. Your account is past due with a balance of $84.00.";

test("cooperative agrees after a proper notice", () => {
  const r = personaReply("cooperative", notice, s0, ctx(8400));
  expect(r.state.agreed).toBe("full");
  expect(r.text).toBeTruthy();
});

test("cooperative asks what this is about without a notice", () => {
  const r = personaReply("cooperative", "Hey, please send money.", s0, ctx(8400));
  expect(r.state.agreed).toBeNull();
  expect(r.text).toMatch(/what is this about/i);
});

test("needs_plan agrees only after both installment amounts", () => {
  expect(personaReply("needs_plan", notice, s0, ctx(8400)).state.agreed).toBeNull();
  const uneven = personaReply("needs_plan", "We can do a first payment of $230.00 and a second payment of $230.01.", s0, ctx(46001));
  expect(uneven.state.agreed).toBe("plan");
  expect(personaReply("needs_plan", "We can set up a payment plan.", s0, ctx(46001)).state.agreed).toBeNull();
  expect(personaReply("needs_plan", "Two payments of $42.00 would work.", s0, ctx(8400)).state.agreed).toBe("plan");
});

test("disputes state the dispute first and stay disputed", () => {
  for (const script of ["dispute_cancelled", "dispute_paid"] as const) {
    const r1 = personaReply(script, notice, s0, ctx(8400));
    expect(r1.state.disputed).toBe(true);
    const r2 = personaReply(script, "Can you pay today?", r1.state, ctx(8400));
    expect(r2.state.disputed).toBe(true);
    expect(r2.state.agreed).toBeNull();
  }
});

test("stop scripts refuse and stay stopped", () => {
  for (const script of ["stop_plain", "stop_override"] as const) {
    const r1 = personaReply(script, notice, s0, ctx(9900));
    expect(r1.state.stopped).toBe(true);
    const r2 = personaReply(script, "Just pay please", r1.state, ctx(9900));
    expect(r2.state.stopped).toBe(true);
    expect(r2.state.agreed).toBeNull();
  }
});

test("silent never replies", () => {
  expect(personaReply("silent", notice, s0, ctx(18000)).text).toBeNull();
});

test("bait scenarios emit bait on the first customer turn", () => {
  const bait: Record<string, RegExp> = { S08: /legal action|sue/i, S10: /ignore your rules/i, S12: /credit/i };
  for (const s of SCENARIOS.filter((x) => x.expect.bait)) {
    const r = personaReply(s.script, notice, s0, ctx(s.account.balanceCents));
    expect(r.text).toMatch(bait[s.id]);
    expect(r.state.agreed).toBeNull();
  }
});

test("angry personas end in a promise, not a guaranteed payment", () => {
  for (const script of ["angry_objection", "angry_threat_bait"] as const) {
    const r1 = personaReply(script, notice, s0, ctx(15500));
    expect(r1.state.agreed).toBeNull();
    const r2 = personaReply(script, "I understand. We can help when you are ready.", r1.state, ctx(15500));
    expect(r2.state.agreed).toBe("promise");
  }
});

test("turn counter advances", () => {
  expect(personaReply("angry_objection", notice, s0, ctx(15500)).state.turn).toBe(1);
});

test("cooperative needs the business name too", () => {
  expect(personaReply("cooperative", "Your account is past due with a balance of $84.00.", s0, ctx(8400)).state.agreed).toBeNull();
});

test("needs_plan does not accept a single half payment as a plan", () => {
  expect(personaReply("needs_plan", "Please pay $64.50 today.", s0, ctx(12900)).state.agreed).toBeNull();
  expect(personaReply("needs_plan", "We can split it into two payments of $64.50.", s0, ctx(12900)).state.agreed).toBe("plan");
});
