import { loadEnv, parseArgs, redact } from "../src/lib/env";

test("redacts connection strings and API keys", () => {
  const s = redact("failed postgres://u:p@h:5432/db and postgresql://x:y@z/db and sk-proj-abc123XYZ");
  expect(s).not.toContain("u:p@h");
  expect(s).not.toContain("x:y@z");
  expect(s).not.toContain("abc123XYZ");
});

test("missing live vars are named, values never printed", () => {
  expect(() => loadEnv(["live"], {})).toThrow(/OPENAI_API_KEY/);
  try {
    loadEnv(["live", "db"], { OPENAI_API_KEY: "sk-secret123456", DATABASE_URL: "" });
  } catch (e) {
    const msg = (e as Error).message;
    expect(msg).toMatch(/OPENAI_AGENT_MODEL/);
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).not.toContain("sk-secret");
  }
});

test("returns only what was asked for", () => {
  const env = loadEnv(["dbReadonly"], { DATABASE_URL_READONLY: "postgres://r@h/db" });
  expect(env.DATABASE_URL_READONLY).toBe("postgres://r@h/db");
});

test("parses flags", () => {
  expect(parseArgs(["--provider", "replay", "--gate", "--limit", "2"])).toEqual({
    provider: "replay",
    gate: true,
    limit: "2",
  });
});

test("db-only commands ignore unrelated invalid live settings", () => {
  expect(() => loadEnv(["db"], { DATABASE_URL: "postgres://a@b/c", RECORD: "yes", MAX_ESTIMATED_TOKENS_PER_RUN: "x" })).not.toThrow();
});

test("live commands still validate live settings", () => {
  expect(() =>
    loadEnv(["live"], { OPENAI_API_KEY: "k", OPENAI_AGENT_MODEL: "m", MAX_ESTIMATED_TOKENS_PER_RUN: "x" }),
  ).toThrow(/MAX_ESTIMATED_TOKENS_PER_RUN/);
});

test("LLM_PROVIDER defaults to mock and is kept", () => {
  expect(loadEnv([], {}).LLM_PROVIDER).toBe("mock");
  expect(loadEnv([], { LLM_PROVIDER: "replay" }).LLM_PROVIDER).toBe("replay");
});
