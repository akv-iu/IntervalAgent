// Local-only live demo: the visitor plays the customer and the real model answers through the guard.
// The single place the web app reaches LLM code or writes to the database (lessons). It answers 404
// unless APP_MODE is local, and it reads the key only from the project .env file, which never exists
// on the deployed site.
import { z } from "zod";
import { loadEnv, redact } from "@/lib/env";
import { checkHardRule, DraftLesson, type Lesson } from "@/lib/lessons";
import { bumpUsed, deleteLesson, insertLesson, setActive } from "@/lib/lessons-store";
import { LiveInput, liveTurn, momentSituation, scenarioFacts } from "@/lib/live";
import { createBudget } from "@/lib/llm/budget";
import { mockProvider } from "@/lib/llm/mock";
import { openaiProvider } from "@/lib/llm/openai";
import type { LlmProvider } from "@/lib/llm/types";
import { projectEnv, tryAgent } from "@/lib/project-env";
import { lessonsLog } from "@/lib/reports";

const MAX_TURNS_PER_MINUTE = 30;
const LIVE_MAX_OUTPUT_TOKENS = 600; // replies are a few sentences; recorded calls averaged about 115 output tokens
const MAX_RECHECK = 8;
let provider: LlmProvider | undefined;
const recent: number[] = [];

const json = (body: unknown, status = 200) => Response.json(body, { status });
const issues = (e: z.ZodError) => e.issues.map((i) => i.message).join("; ");

// One request can stand for several model turns (recheck), so it takes that many slots.
function take(n: number): boolean {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length + n > MAX_TURNS_PER_MINUTE) return false;
  for (let i = 0; i < n; i++) recent.push(now);
  return true;
}

// Lessons are taught on the guarded agent only, at a moment of a real conversation.
// The opening message follows fixed rules and never gets lessons, so a moment must include a customer reply.
const Moment = LiveInput.extend({ version: z.literal("guarded").default("guarded") }).refine(
  (m) => m.messages.some((x) => x.role === "customer"),
  "lessons start with the first customer reply; the opening message follows fixed rules",
);
const Ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("turn") }),
  z.object({ op: z.literal("retry"), draftLesson: DraftLesson }),
  z.object({ op: z.literal("accept"), draftLesson: DraftLesson, beforeText: z.string().max(4000), afterText: z.string().min(1).max(4000) }),
  z.object({ op: z.literal("toggle"), id: z.number().int().positive(), active: z.boolean() }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
  z.object({ op: z.literal("recheck"), page: z.number().int().min(0).default(0) }),
]);

export async function POST(req: Request) {
  const env = projectEnv();
  // Off unless both the host and the .env file explicitly say APP_MODE=local. A missing value means off.
  if (process.env.APP_MODE !== "local" || env.APP_MODE !== "local") return json({ error: "not found" }, 404);
  const agent = tryAgent(env); // mock unless LIVE_DEMO_PROVIDER=live, so no tokens are spent by default

  try {
    const body = await req.json();
    const parsed = Ops.safeParse({ ...body, op: body?.op ?? "turn" });
    if (!parsed.success) return json({ error: issues(parsed.error) }, 400);
    const op = parsed.data;

    if (op.op === "toggle" || op.op === "delete") {
      await (op.op === "toggle" ? setActive(op.id, op.active) : deleteLesson(op.id));
      return json({ lessons: await lessonsLog() });
    }
    if (op.op === "accept") {
      const m = Moment.safeParse(body);
      if (!m.success) return json({ error: issues(m.error) }, 400);
      // The situation is worked out here from the conversation, never taken from the browser.
      await insertLesson({
        ...op.draftLesson,
        situation: momentSituation(m.data.scenarioId, m.data.messages),
        scenarioId: m.data.scenarioId,
        moment: m.data.messages,
        beforeText: op.beforeText,
        afterText: op.afterText,
      });
      return json({ lessons: await lessonsLog() });
    }

    // Check the conversation before touching the database or the model.
    const input = op.op === "recheck" ? null : (op.op === "retry" ? Moment : LiveInput).safeParse(body);
    if (input && !input.success) return json({ error: issues(input.error) }, 400);

    // Chat works without a database; lessons are then simply off.
    let lessons: Lesson[] = [];
    let lessonsOff: string | undefined;
    try {
      lessons = (await lessonsLog()).filter((l) => l.active);
    } catch (e) {
      if (op.op !== "turn") throw e;
      lessonsOff = `Lessons are off: the database is not reachable (${redact(e instanceof Error ? e.message : String(e))}).`;
    }

    // Recheck replays 8 lessons per click; the next click continues with the next 8.
    const batch = op.op === "recheck" ? lessons.slice(op.page * MAX_RECHECK, (op.page + 1) * MAX_RECHECK) : [];
    if (!take(op.op === "recheck" ? batch.length : 1)) return json({ error: "Too many messages this minute. Wait a moment and try again." }, 429);
    const p = model(agent, env);

    if (op.op === "recheck") {
      const results = await Promise.all(batch.map((l) => recheck(l, lessons, p)));
      for (const r of results) await bumpUsed(r.lessonsUsed);
      const next = op.op === "recheck" && (op.page + 1) * MAX_RECHECK < lessons.length ? op.page + 1 : null;
      return json({ results, next, agent });
    }
    // Every reply sent with a saved lesson counts as a use, including retries.
    const turn = await liveTurn(input!.data, p, lessons, op.op === "retry" ? op.draftLesson : undefined);
    if (!lessonsOff) await bumpUsed(turn.lessonsUsed);
    return json({ ...turn, agent, lessonsOff });
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : String(e));
    return json({ error: /budget/i.test(message) ? "The token budget for this server session is used up. Restart the dev server to reset it." : message }, 400);
  }
}

// One budget per server process, so a long demo session cannot run away. loadEnv validates the
// budget as a finite positive integer; replies are capped so each reservation covers the real maximum.
function model(agent: "live" | "mock", env: Record<string, string>): LlmProvider {
  if (agent === "mock") return mockProvider();
  if (!provider) {
    const live = loadEnv(["live"], env);
    provider = openaiProvider({
      apiKey: live.OPENAI_API_KEY!,
      model: live.OPENAI_AGENT_MODEL!,
      budget: createBudget(live.MAX_ESTIMATED_TOKENS_PER_RUN!),
      maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS,
    });
  }
  return provider;
}

// Replays a lesson's saved moment with today's lessons. Code can only judge hard lessons; for a soft
// lesson the person reads the reply.
async function recheck(l: Lesson, lessons: Lesson[], p: LlmProvider) {
  const t = await liveTurn({ scenarioId: l.scenarioId, version: "guarded", messages: l.moment }, p, lessons);
  // The rule itself decides; tags only say whether the model or the code got there.
  const followed = l.hardRule ? checkHardRule(l.hardRule, { action: t.action, message: t.text }, scenarioFacts(l.scenarioId)) === null : null;
  const verdict =
    followed === null
      ? "no automatic check: read it yourself"
      : !followed
        ? "not followed"
        : t.flags.includes("fallback")
          ? "the model missed it; code sent a safe reply"
          : t.flags.includes("regenerated")
            ? "followed after one rewrite"
            : "followed on the first try";
  return { id: l.id, text: t.text, action: t.action, when: t.when, verdict, lessonsUsed: t.lessonsUsed };
}
