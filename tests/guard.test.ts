import { fallbackTemplate, preGenerate, validateOutbound } from "../src/lib/agent/guard";
import { installments } from "../src/lib/money";
import { SCENARIOS } from "../src/lib/sim/scenarios";
import { localToInstant, SIM_DATE, type Tz } from "../src/lib/time";

const at = (h: number, m = 0, tz: Tz = "America/Denver") => localToInstant(SIM_DATE, h, m, tz);
const facts = (b: number, isFirst = false) => ({ business: "Northside Fitness", balanceCents: b, plan: installments(b), isFirst });

describe("preGenerate", () => {
  test("STOP stops with no message", () => expect(preGenerate("STOP", at(10), "America/Denver")).toEqual({ kind: "stop" }));
  test("dispute hands off with fixed text", () => {
    const d = preGenerate("I already paid", at(10), "America/Denver");
    expect(d.kind).toBe("handoff");
    if (d.kind === "handoff") {
      expect(d.text.length).toBeGreaterThan(10);
      expect(d.sendAt.getTime()).toBe(at(10).getTime());
    }
  });
  test("innocent near-match generates", () => expect(preGenerate("can I stop by the front desk", at(10), "America/Denver").kind).toBe("generate"));
  test("no customer text generates", () => expect(preGenerate(null, at(10), "America/Denver").kind).toBe("generate"));
  test("06:00 is scheduled to 08:00", () => {
    const d = preGenerate(null, at(6), "America/Denver");
    expect(d.kind === "generate" && d.sendAt.getTime()).toBe(at(8).getTime());
  });
  test.each<Tz>(["America/Denver", "America/New_York"])("dispute ack proposed at 21:10 waits until 08:00 next day (%s)", (tz) => {
    const d = preGenerate("I cancelled my membership", at(21, 10, tz), tz);
    expect(d.kind).toBe("handoff");
    if (d.kind === "handoff") expect(d.sendAt.getTime()).toBe(localToInstant("2026-03-11", 8, 0, tz).getTime());
  });
  test("stop at 21:10 still sends nothing", () => expect(preGenerate("Please stop texting me", at(21, 10), "America/Denver")).toEqual({ kind: "stop" }));
  test("stop wins over dispute", () => expect(preGenerate("STOP, I already paid", at(10), "America/Denver").kind).toBe("stop"));
  test("handoff text passes outbound checks", () => {
    const d = preGenerate("I already paid", at(10), "America/Denver");
    if (d.kind === "handoff") expect(validateOutbound(d.text, facts(8400))).toEqual([]);
  });
});

describe("validateOutbound", () => {
  const good = "Hi Maya, this is Northside Fitness. Your account is past due with a balance of $84.00.";
  test("correct first message passes", () => expect(validateOutbound(good, facts(8400, true))).toEqual([]));
  test("wrong amount flagged", () =>
    expect(validateOutbound("You owe $100.00 to Northside Fitness, past due.", facts(8400, true)).length).toBeGreaterThan(0));
  test("threat flagged", () => expect(validateOutbound("Pay or we will sue you.", facts(8400)).join()).toMatch(/sue/));
  test("first message missing business flagged", () =>
    expect(validateOutbound("Your account is past due with a balance of $84.00.", facts(8400, true)).join()).toMatch(/business/i));
  test("first message missing overdue flagged", () =>
    expect(validateOutbound("Northside Fitness here, your balance is $84.00.", facts(8400, true)).join()).toMatch(/overdue/i));
  test("first message missing balance flagged", () =>
    expect(validateOutbound("Northside Fitness here, your account is overdue.", facts(8400, true)).join()).toMatch(/balance/i));
  test("empty message flagged", () => expect(validateOutbound("  ", facts(8400)).length).toBeGreaterThan(0));
  test("unverifiable amount flagged", () => expect(validateOutbound("Your balance is $84.555.", facts(8400)).join()).toMatch(/unverifiable/i));
  test("generic plan offer without numbers is allowed", () =>
    expect(validateOutbound("We can also set up a payment plan if that helps.", facts(46001))).toEqual([]));

  describe("installments on 46001", () => {
    test.each(["We can do two payments of $230.00.", "We can do two payments of $230.01.", "We can do three payments of $230.00."])(
      "rejects: %s",
      (t) => expect(validateOutbound(t, facts(46001)).length).toBeGreaterThan(0),
    );
    test("accepts first $230.00 and second $230.01", () =>
      expect(validateOutbound("We can do a first payment of $230.00 and a second payment of $230.01.", facts(46001))).toEqual([]));
    test("rejects three installments even with valid amounts", () =>
      expect(validateOutbound("Three payments: $230.00, $230.01 and $230.00.", facts(46001)).length).toBeGreaterThan(0));
    test("rejects a numeric plan with only one installment amount", () =>
      expect(validateOutbound("Start with a first payment of $230.00.", facts(46001)).length).toBeGreaterThan(0));
  });
  test("accepts two payments of $42.00 on 8400", () => expect(validateOutbound("We can do two payments of $42.00.", facts(8400))).toEqual([]));
  test("full balance plus plan in one message passes", () =>
    expect(
      validateOutbound("You can pay the full $460.01, or a first payment of $230.00 and a second payment of $230.01.", facts(46001)),
    ).toEqual([]));
});

test("fallback template passes as a first message for every scenario account", () => {
  for (const s of SCENARIOS) {
    const b = s.account.balanceCents;
    const t = fallbackTemplate({ business: "Northside Fitness", firstName: s.account.firstName, balanceCents: b, plan: installments(b) });
    expect(validateOutbound(t, facts(b, true))).toEqual([]);
  }
});

describe("review regressions", () => {
  test("two payments of the full balance rejected", () =>
    expect(validateOutbound("We can do two payments of $460.01.", facts(46001)).length).toBeGreaterThan(0));
  test("a third installment rejected even with valid amounts", () =>
    expect(validateOutbound("Pay $230.00 now, $230.01 next week, and a third payment of $230.00 later.", facts(46001)).length).toBeGreaterThan(0));
  test("installment amounts repeated beyond two rejected", () =>
    expect(validateOutbound("Pay $42.00, then $42.00, then $42.00.", facts(8400)).length).toBeGreaterThan(0));
  test("installment amount stated as the balance rejected", () =>
    expect(validateOutbound("Your outstanding balance is $42.00.", facts(8400)).join()).toMatch(/balance/i));
  test("balance sentence with the real balance passes", () => expect(validateOutbound("Your outstanding balance is $84.00.", facts(8400))).toEqual([]));
});

test("digit installment counts are checked against the total", () => {
  expect(validateOutbound("We can do 2 payments of $84.00.", facts(8400)).length).toBeGreaterThan(0);
  expect(validateOutbound("We can do 2 payments of $42.00.", facts(8400))).toEqual([]);
});

describe("live recording false alarms (real gpt-6-luna wording)", () => {
  test("'two payments of $230.00 and $230.01' is the correct uneven plan", () =>
    expect(validateOutbound("We can split it into two payments of $230.00 and $230.01.", facts(46001))).toEqual([]));
  test("'two $90 payments' is two payments, not ninety", () =>
    expect(validateOutbound("We can split it into two $90 payments if that helps.", facts(18000))).toEqual([]));
  test("'two $90 payments' on the wrong balance still fails", () =>
    expect(validateOutbound("We can split it into two $90 payments.", facts(25000)).length).toBeGreaterThan(0));
  test("'two payments of $230.00' alone on 46001 still fails", () =>
    expect(validateOutbound("We can do two payments of $230.00.", facts(46001)).length).toBeGreaterThan(0));
});

describe("review of the live false-alarm fix", () => {
  test("'three $90 payments' on 180 fails", () => expect(validateOutbound("We can do three $90 payments.", facts(18000)).length).toBeGreaterThan(0));
  test("'two $100 payments' on 180 fails (total 200)", () => expect(validateOutbound("We can do two $100 payments.", facts(18000)).length).toBeGreaterThan(0));
  test("'two payments of $84.00 and $84.00' on 84 fails", () =>
    expect(validateOutbound("We can do two payments of $84.00 and $84.00.", facts(8400)).length).toBeGreaterThan(0));
  test("'two payments of $230.01 and $230.01' on 46001 fails", () =>
    expect(validateOutbound("We can do two payments of $230.01 and $230.01.", facts(46001)).length).toBeGreaterThan(0));
});

test("a modifier before the amount does not hide the count", () => {
  expect(validateOutbound("We can do three equal $90 payments.", facts(18000)).length).toBeGreaterThan(0);
  expect(validateOutbound("We can do two equal $90 payments.", facts(18000))).toEqual([]);
});
