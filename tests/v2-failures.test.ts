import { describeFailure } from "../src/lib/v2/failures";

test.each(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"])("provider billing code %s is distinct from the removed local cap", (code) => {
  expect(describeFailure({ status: 429, code })).toMatchObject({ kind: "quota", status: 429, code });
});

test("classification handles provider metadata and wrapped SDK errors without exposing payloads", () => {
  const raw = { status: 401, code: "invalid_api_key", message: "sk-secret-do-not-publish", headers: { authorization: "secret" }, body: "private" };
  expect(describeFailure({ cause: raw })).toMatchObject({ kind: "access", status: 401, code: "invalid_api_key" });
  expect(JSON.stringify(describeFailure(raw))).not.toMatch(/sk-secret|authorization|private/);
  expect(describeFailure({ status: 429, type: "insufficient_quota" }).kind).toBe("quota");
  expect(describeFailure({ status: 429 }).kind).toBe("rate_or_quota");
  expect(describeFailure({ status: 400 }).kind).toBe("request");
  expect(describeFailure({ name: "TimeoutError" }).kind).toBe("timeout");
  expect(describeFailure({ name: "APIConnectionError" }).kind).toBe("connection");
  expect(describeFailure({ status: 503 }).kind).toBe("provider");
  expect(describeFailure(new Error("arbitrary private tool output"))).toEqual({ kind: "unknown", message: expect.any(String) });
});
