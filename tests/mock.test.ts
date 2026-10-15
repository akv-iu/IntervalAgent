import { validateOutbound } from "../src/lib/agent/guard";
import { buildSystemPrompt, type AgentFacts } from "../src/lib/agent/prompts";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";
import type { LlmRequest } from "../src/lib/llm/types";
import { installments } from "../src/lib/money";

const facts = (b: number): AgentFacts => ({
  business: "Northside Fitness",
  firstName: "Luis",
  balanceCents: b,
  plan: installments(b),
  tone: "formal",
  channel: "email",
});
const ctx = { subject: "eval-S04", version: "guarded" as const, turn: 1, attempt: 1 };
const req = (b: number, messages: LlmRequest["messages"] = []): LlmRequest => ({ system: buildSystemPrompt("guarded", facts(b)), messages, context: ctx });
const parse = (t: string) => JSON.parse(t) as { message: string; action: string };

test("mock opening is valid JSON and passes the guard as a first message", async () => {
  for (const b of [8400, 46001, 31500]) {
    const out = parse((await mockProvider().complete(req(b))).text);
    expect(out.action).toBe("send");
    expect(validateOutbound(out.message, { ...facts(b), isFirst: true })).toEqual([]);
  }
});

test("mock is deterministic", async () => {
  const a = await mockProvider().complete(req(46001));
  const b = await mockProvider().complete(req(46001));
  expect(a).toEqual(b);
});

test("mock offers the exact uneven plan when asked", async () => {
  const out = parse(
    (await mockProvider().complete(req(46001, [{ role: "agent", text: "hi" }, { role: "customer", text: "Is there a payment plan?" }]))).text,
  );
  expect(out.message).toContain("$230.00");
  expect(out.message).toContain("$230.01");
  expect(validateOutbound(out.message, { ...facts(46001), isFirst: false })).toEqual([]);
});

test("mock stops on refusal and hands off disputes", async () => {
  const stop = parse((await mockProvider().complete(req(8400, [{ role: "agent", text: "hi" }, { role: "customer", text: "STOP" }]))).text);
  expect(stop.action).toBe("stop");
  const disp = parse((await mockProvider().complete(req(8400, [{ role: "agent", text: "hi" }, { role: "customer", text: "I already paid" }]))).text);
  expect(disp.action).toBe("handoff");
});

test("mock-bad output fails the guard and ignores STOP", async () => {
  const first = parse((await mockBadProvider().complete(req(8400))).text);
  expect(validateOutbound(first.message, { ...facts(8400), isFirst: true }).length).toBeGreaterThan(0);
  const afterStop = parse((await mockBadProvider().complete(req(8400, [{ role: "agent", text: "hi" }, { role: "customer", text: "STOP" }]))).text);
  expect(afterStop.action).toBe("send");
});
