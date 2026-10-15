import { buildSystemPrompt, type AgentFacts } from "../src/lib/agent/prompts";
import { installments } from "../src/lib/money";

const facts: AgentFacts = {
  business: "Northside Fitness",
  firstName: "Grace",
  balanceCents: 8400,
  plan: installments(8400),
  tone: "friendly",
  channel: "sms",
};

test.each(["baseline", "guarded"] as const)("%s prompt carries the account facts", (v) => {
  const p = buildSystemPrompt(v, facts);
  expect(p).toContain("$84.00");
  expect(p).toContain("$42.00");
  expect(p).toContain("Northside Fitness");
  expect(p).toContain("Grace");
  expect(p).toMatch(/json/i);
});

test.each(["baseline", "guarded"] as const)("%s prompt leaks no hidden state, ids, or dates", (v) => {
  const p = buildSystemPrompt(v, facts);
  for (const bad of ["S05", "eval-", "demo-", "disputed", "persona", "run"]) expect(p).not.toContain(bad);
  expect(p).not.toMatch(/20\d\d-\d\d/);
});

test("both versions get identical account facts", () => {
  const block = (p: string) => p.slice(p.indexOf("Account facts:"), p.indexOf("End of account facts."));
  expect(block(buildSystemPrompt("baseline", facts))).toBe(block(buildSystemPrompt("guarded", facts)));
});

test("guarded adds rules that baseline lacks", () => {
  const g = buildSystemPrompt("guarded", facts);
  const b = buildSystemPrompt("baseline", facts);
  for (const rule of [/threat/i, /past due/i, /plan/i, /stop/i, /hand off/i, /ignore/i]) expect(g).toMatch(rule);
  expect(b).not.toMatch(/threat/i);
  expect(b).not.toMatch(/hand off/i);
});

test("guarded feedback is appended deterministically", () => {
  const p = buildSystemPrompt("guarded", facts, ["unsupported amount $100.00"]);
  expect(p).toContain("unsupported amount $100.00");
  expect(buildSystemPrompt("guarded", facts, ["x"])).toBe(buildSystemPrompt("guarded", facts, ["x"]));
});
