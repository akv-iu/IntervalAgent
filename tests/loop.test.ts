import { HANDOFF_TEXT } from "../src/lib/agent/guard";
import { Conversation } from "../src/lib/artifact";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";
import type { LlmProvider } from "../src/lib/llm/types";
import { createRng } from "../src/lib/rng";
import { parseAgentOutput, runConversation } from "../src/lib/sim/loop";
import { SCENARIOS } from "../src/lib/sim/scenarios";
import { inWindow, localToInstant, SIM_DATE } from "../src/lib/time";

const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const run = (id: string, version: "baseline" | "guarded", provider: LlmProvider = mockProvider()) => {
  const s = sc(id);
  return runConversation({
    account: s.account,
    script: s.script,
    scenarioId: s.id,
    version,
    startAt: localToInstant(SIM_DATE, s.startHour, 0, s.account.timezone),
    provider,
    rng: createRng(7),
  });
};

// Counts calls so tests can assert when the model was (not) consulted.
function counting(inner: LlmProvider): LlmProvider & { calls: number } {
  const p = {
    ...inner,
    calls: 0,
    async complete(req: Parameters<LlmProvider["complete"]>[0]) {
      p.calls++;
      return inner.complete(req);
    },
  };
  return p;
}

describe("parseAgentOutput", () => {
  test("strips code fences", () => expect(parseAgentOutput('```json\n{"message":"hi","action":"send"}\n```')).toEqual({ message: "hi", action: "send" }));
  test("takes the object after leading prose", () => expect(parseAgentOutput('Sure! {"message":"hi","action":"send"}')).toEqual({ message: "hi", action: "send" }));
  test("rejects junk", () => expect(parseAgentOutput("nope")).toBeNull());
  test("rejects unknown action", () => expect(parseAgentOutput('{"message":"hi","action":"threaten"}')).toBeNull());
});

test("junk twice marks the conversation failed after two calls", async () => {
  const junk: LlmProvider = { name: "mock", model: "junk", params: {}, complete: async () => ({ text: "not json" }) };
  const r = await run("S01", "guarded", junk);
  expect(r.outcome).toBe("failed");
  expect(r.llmCalls).toBe(2);
});

test("guarded S05 hands off with the fixed ack and no model call after the dispute", async () => {
  const p = counting(mockProvider());
  const r = await run("S05", "guarded", p);
  const agent = r.messages.filter((m) => m.role === "agent");
  expect(agent.at(-1)!.text).toBe(HANDOFF_TEXT);
  expect(r.handedToHuman).toBe(true);
  expect(r.outcome).toBe("disputed");
  expect(p.calls).toBe(1); // the opening only
});

test("dispute at 21:00 gets its ack at 08:00 next day without a model call", async () => {
  const s = sc("S05");
  const p = counting(mockProvider());
  const r = await runConversation({
    account: s.account,
    script: s.script,
    scenarioId: "boundary-fixture",
    version: "guarded",
    startAt: localToInstant(SIM_DATE, 20, 50, s.account.timezone),
    provider: p,
    rng: createRng(1),
  });
  const [opening, dispute, ack] = r.messages;
  expect(new Date(opening.sentAt).getTime()).toBe(localToInstant(SIM_DATE, 20, 50, s.account.timezone).getTime());
  expect(new Date(dispute.sentAt).getTime()).toBe(localToInstant(SIM_DATE, 21, 0, s.account.timezone).getTime());
  expect(new Date(ack.sentAt).getTime()).toBe(localToInstant("2026-03-11", 8, 0, s.account.timezone).getTime());
  expect(r.messages.filter((m) => m.role === "agent").every((m) => inWindow(new Date(m.sentAt), s.account.timezone))).toBe(true);
  expect(p.calls).toBe(1);
});

test("guarded S09 sends nothing after STOP", async () => {
  const r = await run("S09", "guarded");
  const stopAt = r.messages.findIndex((m) => m.role === "customer");
  expect(r.messages.slice(stopAt + 1).filter((m) => m.role === "agent")).toHaveLength(0);
  expect(r.outcome).toBe("stopped");
});

test("baseline S09 on mock-bad keeps sending after STOP (no guard)", async () => {
  const r = await run("S09", "baseline", mockBadProvider());
  const stopAt = r.messages.findIndex((m) => m.role === "customer");
  expect(r.messages.slice(stopAt + 1).filter((m) => m.role === "agent").length).toBeGreaterThan(0);
});

test("guarded S11 at 06:00 sends its first message at 08:00", async () => {
  const r = await run("S11", "guarded");
  expect(new Date(r.messages[0].sentAt).getTime()).toBe(localToInstant(SIM_DATE, 8, 0, "America/Denver").getTime());
  expect(r.messages[0].guardFlags).toContain("rescheduled");
  expect(r.outcome).toBe("no_response");
});

test("guarded S01 agrees and gets a receipt 1 to 3 days later", async () => {
  const r = await run("S01", "guarded");
  expect(r.outcome).toBe("agreed_to_pay");
  expect(r.recoveredCents).toBe(8400);
  const days = (Date.parse(r.paidAt!) - Date.parse(r.agreedAt!)) / 86400000;
  expect([1, 2, 3]).toContain(days);
});

test("guarded S03 ends in a plan with zero recovered", async () => {
  const r = await run("S03", "guarded");
  expect(r.outcome).toBe("payment_plan");
  expect(r.recoveredCents).toBe(0);
  expect(r.paidAt).toBeNull();
});

test("guarded on mock-bad falls back to the template", async () => {
  const r = await run("S01", "guarded", mockBadProvider());
  expect(r.messages[0].guardFlags).toContain("fallback");
  expect(r.messages[0].text).toContain("Northside Fitness");
});

test("all 12 scenarios x 2 versions stay within 6 agent turns and fit the artifact schema", async () => {
  for (const s of SCENARIOS) {
    for (const v of ["baseline", "guarded"] as const) {
      for (const provider of [mockProvider(), mockBadProvider()]) {
        const r = await run(s.id, v, provider);
        expect(r.messages.filter((m) => m.role === "agent").length).toBeLessThanOrEqual(6);
        const parsed = Conversation.safeParse({ ...r, scenarioChecks: [] });
        if (!parsed.success) throw new Error(`${s.id} ${v}: ${parsed.error.message}`);
      }
    }
  }
});

test("runs are deterministic", async () => {
  expect(await run("S04", "guarded")).toEqual(await run("S04", "guarded"));
});

test("empty send replies count as invalid output and end as failed", async () => {
  const empty: LlmProvider = { name: "mock", model: "empty", params: {}, complete: async () => ({ text: '{"message":"  ","action":"send"}' }) };
  for (const v of ["baseline", "guarded"] as const) {
    const r = await run("S01", v, empty);
    expect(r.outcome).toBe("failed");
    expect(r.llmCalls).toBe(2);
  }
});

test("provider errors mark the conversation failed with a redacted system note", async () => {
  const boom: LlmProvider = {
    name: "mock",
    model: "boom",
    params: {},
    complete: async () => {
      throw new Error("upstream 500 for key sk-secret1234567");
    },
  };
  const r = await run("S01", "guarded", boom);
  expect(r.outcome).toBe("failed");
  const note = r.messages.find((m) => m.role === "system");
  expect(note?.text).toMatch(/generation failed/);
  expect(note?.text).not.toContain("sk-secret");
});

test("an agent that stops before saying anything ends as failed", async () => {
  const silentAgent: LlmProvider = { name: "mock", model: "x", params: {}, complete: async () => ({ text: '{"message":"","action":"stop"}' }) };
  const r = await run("S01", "baseline", silentAgent);
  expect(r.outcome).toBe("failed");
  expect(r.messages.some((m) => m.role === "system")).toBe(true);
});
