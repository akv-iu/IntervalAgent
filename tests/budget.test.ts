import { BudgetExceeded, createBudget, estimateTokens } from "../src/lib/llm/budget";

test("reserve adds up and throws before exceeding the allowance", () => {
  const b = createBudget(1000);
  b.reserve(600);
  expect(b.used()).toBe(600);
  expect(() => b.reserve(500)).toThrow(BudgetExceeded);
  expect(b.used()).toBe(600); // a refused reservation is not counted
  b.reserve(400);
  expect(b.used()).toBe(1000);
});

test("actual usage is tracked separately for logging", () => {
  const b = createBudget(1000);
  b.reserve(500);
  b.record(320);
  expect(b.actual()).toBe(320);
});

test("estimate grows with request size and includes an output allowance", () => {
  const small = estimateTokens({ system: "a", messages: [], context: { subject: "s", version: "guarded", turn: 1, attempt: 1 } });
  const big = estimateTokens({ system: "a".repeat(3000), messages: [{ role: "customer", text: "b".repeat(300) }], context: { subject: "s", version: "guarded", turn: 1, attempt: 1 } });
  expect(small).toBeGreaterThanOrEqual(400);
  expect(small).toBe(401); // ceil(1 / 3) + 400
  expect(big).toBe(1500); // ceil(3300 / 3) + 400
});
