import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

// Runner settings come from the project's .env file only. Shell variables are ignored on purpose,
// so an OPENAI_API_KEY exported in the user's shell can never trigger paid calls by accident.
export function projectEnv(path = ".env"): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

// Which agent the local Try page uses. Live AI calls are off until LIVE_DEMO_PROVIDER=live is in .env,
// so clicking around the page never spends tokens by accident.
export function tryAgent(env: Record<string, string>): "live" | "mock" {
  return env.LIVE_DEMO_PROVIDER === "live" && env.OPENAI_API_KEY && env.OPENAI_AGENT_MODEL ? "live" : "mock";
}

export type TryMode =
  | { kind: "off" }
  | { kind: "local"; agent: "live" | "mock"; env: Record<string, string> }
  | { kind: "public"; apiKey: string; model: string; dailyTokens: number };

const DEFAULT_DAILY_TOKENS = 500_000;

// Where the Try page's live chat runs. Local: both the host and the .env file say APP_MODE=local, and the key
// comes from the .env file (as above). Public (Akshay, 2026-10-17): the host itself opts in with APP_MODE=public,
// PUBLIC_TRY=live, its own TRY_OPENAI_API_KEY and TRY_OPENAI_MODEL (never OPENAI_API_KEY, so a key exported in a
// shell cannot turn it on), and the lessons-only database login. Anything else is off.
export function tryMode(host: Record<string, string | undefined> = process.env, env: Record<string, string> = projectEnv()): TryMode {
  if (host.APP_MODE === "local" && env.APP_MODE === "local") return { kind: "local", agent: tryAgent(env), env };
  const { TRY_OPENAI_API_KEY: apiKey, TRY_OPENAI_MODEL: model } = host;
  if (host.APP_MODE === "public" && host.PUBLIC_TRY === "live" && apiKey && model && host.DATABASE_URL_LESSONS) {
    const daily = Number(host.TRY_DAILY_TOKENS ?? DEFAULT_DAILY_TOKENS);
    return { kind: "public", apiKey, model, dailyTokens: Number.isInteger(daily) && daily > 0 ? daily : DEFAULT_DAILY_TOKENS };
  }
  return { kind: "off" };
}
