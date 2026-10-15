import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

// Runner settings come from the project's .env file only. Shell variables are ignored on purpose,
// so an OPENAI_API_KEY exported in the user's shell can never trigger paid calls by accident.
export function projectEnv(path = ".env"): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {};
}
