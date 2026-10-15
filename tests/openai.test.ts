import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { createBudget } from "../src/lib/llm/budget";
import { openaiProvider, type OpenAILike } from "../src/lib/llm/openai";
import type { LlmRequest } from "../src/lib/llm/types";

const req: LlmRequest = {
  system: "You write outreach.",
  messages: [
    { role: "agent", text: "Hello" },
    { role: "customer", text: "Hi" },
  ],
  context: { subject: "S01", version: "guarded", turn: 2, attempt: 1 },
};

function fakeClient(script: (() => unknown)[]): OpenAILike & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (body: unknown) => {
          calls.push(body);
          const step = script[Math.min(calls.length - 1, script.length - 1)];
          return step() as Awaited<ReturnType<OpenAILike["chat"]["completions"]["create"]>>;
        },
      },
    },
  };
}
const ok = () => ({ choices: [{ message: { content: '{"message":"hi","action":"send"}' } }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
const fail = (status: number, code: string | null, message = "upstream error") => () => {
  throw Object.assign(new Error(message), { status, code });
};
const provider = (client: OpenAILike, max = 100000) =>
  openaiProvider({ apiKey: "sk-test", model: "test-model", budget: createBudget(max), client, sleep: async () => {} });

test("sends system as developer, maps agent/customer roles, asks for JSON, returns text and usage", async () => {
  const c = fakeClient([ok]);
  const res = await provider(c).complete(req);
  expect(res.text).toBe('{"message":"hi","action":"send"}');
  expect(res.usage).toEqual({ input: 50, output: 10 });
  expect(c.calls[0]).toMatchObject({
    model: "test-model",
    response_format: { type: "json_object" },
    messages: [
      { role: "developer", content: "You write outreach." },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Hi" },
    ],
  });
  expect(JSON.stringify(c.calls[0])).not.toContain("S01"); // context never reaches the model
});

test("retries rate limits and server errors, then succeeds", async () => {
  const c = fakeClient([fail(429, "rate_limit_exceeded"), fail(503, null), ok]);
  await expect(provider(c).complete(req)).resolves.toBeTruthy();
  expect(c.calls).toHaveLength(3);
});

test("gives up after 3 attempts", async () => {
  const c = fakeClient([fail(500, null)]);
  await expect(provider(c).complete(req)).rejects.toThrow();
  expect(c.calls).toHaveLength(3);
});

test.each([
  [429, "insufficient_quota"],
  [429, "billing_hard_limit_reached"],
  [401, "invalid_api_key"],
  [400, "invalid_request_error"],
])("does not retry %i %s", async (status, code) => {
  const c = fakeClient([fail(status, code)]);
  await expect(provider(c).complete(req)).rejects.toThrow();
  expect(c.calls).toHaveLength(1);
});

test("budget refusal happens before any request", async () => {
  const c = fakeClient([ok]);
  await expect(provider(c, 10).complete(req)).rejects.toThrow(/budget/i);
  expect(c.calls).toHaveLength(0);
});

test("each retry reserves budget too", async () => {
  const budget = createBudget(100000);
  const c = fakeClient([fail(500, null), ok]);
  await openaiProvider({ apiKey: "k", model: "m", budget, client: c, sleep: async () => {} }).complete(req);
  expect(budget.used()).toBeGreaterThan(800); // two reservations of at least 400 each
});

test("errors are redacted", async () => {
  const c = fakeClient([fail(401, "invalid_api_key", "Incorrect API key provided: sk-proj-abcdefghijklmnop")]);
  await expect(provider(c).complete(req)).rejects.toThrow(/sk-\[redacted\]/);
});

test("empty content is returned as empty text, not a crash", async () => {
  const c = fakeClient([() => ({ choices: [{ message: { content: null } }] })]);
  expect((await provider(c).complete(req)).text).toBe("");
});

test("retries a dropped connection but not an unrelated statusless error", async () => {
  const conn = fakeClient([() => { throw new APIConnectionError({ message: "socket hang up" }); }, () => { throw new APIConnectionTimeoutError(); }, ok]);
  await expect(provider(conn).complete(req)).resolves.toBeTruthy();
  expect(conn.calls).toHaveLength(3);
  const other = fakeClient([() => { throw new TypeError("cannot read properties of undefined"); }]);
  await expect(provider(other).complete(req)).rejects.toThrow();
  expect(other.calls).toHaveLength(1);
});
