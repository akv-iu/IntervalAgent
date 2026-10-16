// Live demo: the visitor plays the customer and the model answers through the guard. The single place the web
// app reaches LLM code or writes to the database (lessons, daily token use). It answers 404 unless tryMode() says
// local (key from the project .env file) or public (the host opted in with its own TRY_ key, a lessons-only
// login, a per-visitor limit and a shared daily token cap; visitors cannot turn lessons off or delete them).
import { z } from "zod";
import { loadEnv, redact } from "@/lib/env";
import { checkHardRule, DraftLesson, type Lesson } from "@/lib/lessons";
import { adjustTryTokens, bumpUsed, deleteLesson, insertLesson, lessonCount, reserveTryTokens, setActive } from "@/lib/lessons-store";
import { LiveInput, liveTurn, momentSituation, scenarioFacts } from "@/lib/live";
import { createBudget } from "@/lib/llm/budget";
import { mockProvider } from "@/lib/llm/mock";
import { openaiProvider } from "@/lib/llm/openai";
import type { LlmProvider } from "@/lib/llm/types";
import { tryMode, type TryMode } from "@/lib/project-env";
import { lessonsLog } from "@/lib/reports";

const MAX_TURNS_PER_MINUTE = 30;
const LIVE_MAX_OUTPUT_TOKENS = 600; // replies are a few sentences; recorded calls averaged about 115 output tokens
const MAX_RECHECK = 8;
const PUBLIC_PER_VISITOR_PER_MINUTE = 12;
const PUBLIC_MAX_LESSONS = 200; // the shared log stays readable; Akshay prunes it on a local copy
// Tokens reserved per model turn: the conversation (about 3 characters a token) plus instructions and a reply,
// twice, because a draft the guard rejects is rewritten once.
const turnReserve = (messages: { text: string }[]) => 2 * (Math.ceil(messages.reduce((n, m) => n + m.text.length, 0) / 3) + 2500);
let provider: LlmProvider | undefined;
const recent: number[] = [];
const byVisitor = new Map<string, number[]>();

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

// ponytail: per-instance memory, so each Vercel instance counts on its own; the shared daily token cap in the
// database is the real limit. Move to a shared store if abuse gets past it.
function takeFor(visitor: string, n: number): boolean {
  const now = Date.now();
  if (byVisitor.size > 5000) byVisitor.clear();
  const hits = (byVisitor.get(visitor) ?? []).filter((t) => now - t < 60_000);
  if (hits.length + n > PUBLIC_PER_VISITOR_PER_MINUTE) return false;
  byVisitor.set(visitor, [...hits, ...Array<number>(n).fill(now)]);
  return true;
}

const visitorOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
const utcDay = () => new Date().toISOString().slice(0, 10);

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
  const mode = tryMode();
  if (mode.kind === "off") return json({ error: "not found" }, 404);
  const isPublic = mode.kind === "public";
  // Locally mock unless LIVE_DEMO_PROVIDER=live, so no tokens are spent by default; public is always the model.
  const agent = mode.kind === "local" ? mode.agent : "live";
  let reservation: { day: string; tokens: number; used: () => number; ok: boolean } | undefined;

  try {
    const body = await req.json();
    const parsed = Ops.safeParse({ ...body, op: body?.op ?? "turn" });
    if (!parsed.success) return json({ error: issues(parsed.error) }, 400);
    const op = parsed.data;

    if (op.op === "toggle" || op.op === "delete") {
      if (isPublic) return json({ error: "Lessons can be turned off or deleted only on a local copy." }, 403);
      await (op.op === "toggle" ? setActive(op.id, op.active) : deleteLesson(op.id));
      return json({ lessons: await lessonsLog() });
    }
    if (op.op === "accept") {
      if (isPublic && !takeFor(visitorOf(req), 1)) return json({ error: "Too many requests this minute. Wait a moment and try again." }, 429);
      // ponytail: count then insert, so simultaneous accepts at the limit can pass it by a few; fine for a soft cap.
      if (isPublic && (await lessonCount()) >= PUBLIC_MAX_LESSONS) return json({ error: "The lesson log is full for now. You can still chat and retry." }, 409);
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
    // Every request takes at least one slot, so an empty recheck page is not free.
    const n = Math.max(1, op.op === "recheck" ? batch.length : 1);
    if (!take(n) || (isPublic && !takeFor(visitorOf(req), n))) return json({ error: "Too many messages this minute. Wait a moment and try again." }, 429);
    let p: LlmProvider;
    if (mode.kind === "public") {
      // Reserve first (fail closed: no reservation, no call); the request's own budget is that reservation.
      const tokens = op.op === "recheck" ? batch.reduce((t, l) => t + turnReserve(l.moment), 0) : turnReserve(input!.data.messages);
      const day = utcDay(); // the refund goes to the same day, even if the request crosses midnight
      if (!(await reserveTryTokens(day, tokens, mode.dailyTokens))) {
        return json({ error: "The demo has reached today's usage limit. Please try again tomorrow." }, 429);
      }
      const budget = createBudget(tokens);
      reservation = { day, tokens, used: () => budget.actual(), ok: false };
      p = openaiProvider({ apiKey: mode.apiKey, model: mode.model, budget, maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS });
    } else {
      p = localModel(mode);
    }

    if (op.op === "recheck") {
      // Wait for every call before counting, even when one fails, so no finished call goes uncounted.
      const settled = await Promise.allSettled(batch.map((l) => recheck(l, lessons, p)));
      const failed = settled.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
      const results = settled.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof recheck>>>).value);
      for (const r of results) await bumpUsed(r.lessonsUsed);
      const next = op.op === "recheck" && (op.page + 1) * MAX_RECHECK < lessons.length ? op.page + 1 : null;
      if (reservation) reservation.ok = true;
      return json({ results, next, agent });
    }
    // Every reply sent with a saved lesson counts as a use, including retries.
    const turn = await liveTurn(input!.data, p, lessons, op.op === "retry" ? op.draftLesson : undefined);
    if (!lessonsOff) await bumpUsed(turn.lessonsUsed);
    if (reservation) reservation.ok = true;
    return json({ ...turn, agent, lessonsOff });
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : String(e));
    const budgetText = isPublic
      ? "This request reached its usage limit. Try a shorter conversation."
      : "The token budget for this server session is used up. Restart the dev server to reset it.";
    if (/budget/i.test(message)) return json({ error: budgetText }, 400);
    // Public visitors get a plain message; the details (database, provider) stay in the server log.
    if (isPublic) {
      console.error(`live route: ${message}`);
      return json({ error: "The demo hit a problem on our side. Please try again in a moment." }, 503);
    }
    return json({ error: message }, 400);
  } finally {
    // Add any overrun. Give back the unused part only after a success: a failed request may have lost a reply
    // OpenAI still charged for. If this write fails the reservation stays counted, which errs on the safe side.
    // ponytail: estimates can still undershoot for token-dense text; bounded by the input size limits, the
    // reply cap and the OpenAI project's hard spend limit.
    if (reservation) {
      const delta = reservation.used() - reservation.tokens;
      if (delta > 0 || reservation.ok) await adjustTryTokens(reservation.day, delta).catch(() => {});
    }
  }
}

// Locally: one budget per server process, so a long demo session cannot run away (loadEnv validates it as a
// positive integer). Replies are capped so each reservation covers the real maximum.
function localModel(mode: Extract<TryMode, { kind: "local" }>): LlmProvider {
  if (mode.agent === "mock") return mockProvider();
  if (!provider) {
    const live = loadEnv(["live"], mode.env);
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
  const followed = l.hardRule ? checkHardRule(l.hardRule, { action: t.action, message: t.text }, { ...scenarioFacts(l.scenarioId), plan3: t.plan3 }) === null : null;
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
