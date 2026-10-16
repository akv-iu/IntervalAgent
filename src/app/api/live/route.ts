// Local-only live demo: the visitor plays the customer and the real model answers through the guard.
// The single place the web app reaches LLM code. It answers 404 unless APP_MODE is local, and it reads
// the key only from the project .env file, which never exists on the deployed site.
import { loadEnv, redact } from "@/lib/env";
import { liveTurn } from "@/lib/live";
import { createBudget } from "@/lib/llm/budget";
import { mockProvider } from "@/lib/llm/mock";
import { openaiProvider } from "@/lib/llm/openai";
import type { LlmProvider } from "@/lib/llm/types";
import { projectEnv, tryAgent } from "@/lib/project-env";

const MAX_TURNS_PER_MINUTE = 30;
const LIVE_MAX_OUTPUT_TOKENS = 600; // replies are a few sentences; recorded calls averaged about 115 output tokens
let provider: LlmProvider | undefined;
const recent: number[] = [];

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  const env = projectEnv();
  // Off unless both the host and the .env file explicitly say APP_MODE=local. A missing value means off.
  if (process.env.APP_MODE !== "local" || env.APP_MODE !== "local") return json({ error: "not found" }, 404);
  const agent = tryAgent(env); // mock unless LIVE_DEMO_PROVIDER=live, so no tokens are spent by default

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_TURNS_PER_MINUTE) return json({ error: "Too many messages this minute. Wait a moment and try again." }, 429);
  recent.push(now);

  try {
    // One budget per server process, so a long demo session cannot run away. loadEnv validates the
    // budget as a finite positive integer; replies are capped so each reservation covers the real maximum.
    if (agent === "mock") return json({ ...(await liveTurn(await req.json(), mockProvider())), agent });
    if (!provider) {
      const live = loadEnv(["live"], env);
      provider = openaiProvider({
        apiKey: live.OPENAI_API_KEY!,
        model: live.OPENAI_AGENT_MODEL!,
        budget: createBudget(live.MAX_ESTIMATED_TOKENS_PER_RUN!),
        maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS,
      });
    }
    return json({ ...(await liveTurn(await req.json(), provider)), agent });
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : String(e));
    return json({ error: /budget/i.test(message) ? "The token budget for this server session is used up. Restart the dev server to reset it." : message }, 400);
  }
}
