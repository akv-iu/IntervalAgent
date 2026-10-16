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
