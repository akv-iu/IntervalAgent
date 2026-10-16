// Where the Try page's live chat may run (Akshay, 2026-10-17: public live Try page, open to anyone).
import { tryMode } from "../src/lib/project-env";

const pub = { APP_MODE: "public", PUBLIC_TRY: "live", TRY_OPENAI_API_KEY: "k", TRY_OPENAI_MODEL: "m", DATABASE_URL_LESSONS: "u" };

test("local: both the host and the .env file say local", () =>
  expect(tryMode({ APP_MODE: "local" }, { APP_MODE: "local" })).toMatchObject({ kind: "local", agent: "mock" }));

test("public: the host opts in with its own key, model and lessons login", () =>
  expect(tryMode(pub, {})).toEqual({ kind: "public", apiKey: "k", model: "m", dailyTokens: 500_000 }));

test.each(["PUBLIC_TRY", "TRY_OPENAI_API_KEY", "TRY_OPENAI_MODEL", "DATABASE_URL_LESSONS"])("public without %s is off", (k) =>
  expect(tryMode({ ...pub, [k]: undefined }, {})).toEqual({ kind: "off" }));

test("the shell's OPENAI_API_KEY never turns the public page on", () =>
  expect(tryMode({ APP_MODE: "public", PUBLIC_TRY: "live", OPENAI_API_KEY: "sk", OPENAI_AGENT_MODEL: "m", DATABASE_URL_LESSONS: "u" }, {})).toEqual({ kind: "off" }));

test("nothing set is off", () => expect(tryMode({}, {})).toEqual({ kind: "off" }));

test.each(["0", "-5", "abc", "1.5"])("a bad daily cap %s falls back to the default", (v) =>
  expect(tryMode({ ...pub, TRY_DAILY_TOKENS: v }, {})).toMatchObject({ dailyTokens: 500_000 }));
test("a valid daily cap is used", () => expect(tryMode({ ...pub, TRY_DAILY_TOKENS: "200000" }, {})).toMatchObject({ dailyTokens: 200_000 }));
