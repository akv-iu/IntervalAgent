// One live agent turn for the local demo page: the visitor plays the customer. Same guard, prompts, and
// checks as the evals, plus the live-only extras (rules v2, lessons, follow-ups, promise dates, three
// payments). Nothing is stored here. Only used by the local-only API route.
import { z } from "zod";
import { formatHour, liveViolations } from "./agent/guard";
import { notBeforeHour, scheduleInWindow } from "./time";
import type { CheckItem } from "./artifact";
import { messageChecks } from "./checks";
import { checkHardRule, type HardRule, type Lesson, offersAPlan } from "./lessons";
import type { LiveState } from "./live-state";
import type { LlmProvider } from "./llm/types";
import { formatCents, installments, installmentsN } from "./money";
import { isDispute, isStop } from "./patterns";
import { cancelsPromise, parsePromise } from "./promise";
import { agentTurn } from "./sim/loop";
import { SCENARIOS } from "./sim/scenarios";
import { FIRM_REFUSAL, isRefusal, needsPerson, requestedHour, situationOf, type Situation } from "./situations";
import { localDate, localToInstant, SIM_DATE, type Tz } from "./time";

export const MAX_TEXT = 500; // what a visitor can type
export const LIVE_MAX_AGENT_TURNS = 10; // the evals keep 6
const MAX_AGENT_TEXT = 4000; // generous bound for model replies passed back in the history
const GAP_MS = 10 * 60 * 1000;
const FOLLOW_UP_HOUR = 10;
// "three payments", or splitting or paying "in/into/over three" ("text me in three days" is not a request).
const ASKS_FOR_THREE = /\b(?:three|3)\s+(?:\w+\s+)?(?:payments|installments|parts)\b|\b(?:split|divide|break|pay)\b[^.!?]*\b(?:in|into|over)\s+(?:three|3)\b/i;
const DECLINES = /\b(?:don'?t|do not|no|not|never|won'?t|can'?t|cannot|can not)\b/i;
// A request for three payments, in a clause that does not turn it down ("I do not want three payments").
const asksForThree = (text: string) => text.split(/(?<=[.!?])\s+|[,;:]\s*|\s+but\s+/i).some((c) => ASKS_FOR_THREE.test(c) && !DECLINES.test(c));

// When an agent follows up if the customer goes quiet after `after`: 10:00 local on a promised date still ahead,
// else 10:00 the next local day.
function followUpAt(after: Date, promise: string | null, tz: Tz): Date {
  const promised = promise ? localToInstant(promise, FOLLOW_UP_HOUR, 0, tz) : null;
  return promised && promised > after ? promised : localToInstant(localDate(after, tz, 1), FOLLOW_UP_HOUR, 0, tz);
}

// After ten agent messages the conversation is over; it can be read, but not continued or replayed.
export const isFinished = (messages: { role: string }[]) => messages.filter((m) => m.role === "agent").length >= LIVE_MAX_AGENT_TURNS;
const FINISHED = "the agent has already sent ten messages; start a new conversation";

export const LiveInput = z.object({
  scenarioId: z.string().refine((id) => SCENARIOS.some((s) => s.id === id), "unknown scenario"),
  version: z.enum(["baseline", "guarded"], { message: "version must be baseline or guarded" }),
  messages: z
    .array(
      z
        .object({ role: z.enum(["agent", "customer"]), text: z.string().max(MAX_AGENT_TEXT), sentAt: z.iso.datetime() })
        .refine((m) => m.role !== "customer" || m.text.length <= MAX_TEXT, `messages are limited to ${MAX_TEXT} characters`),
    )
    .max(2 * LIVE_MAX_AGENT_TURNS)
    .refine((ms) => ms.every((m, i) => i === 0 || Date.parse(m.sentAt) >= Date.parse(ms[i - 1].sentAt)), "messages must be in time order")
    // Refused at the door, so a finished conversation is never saved as a lesson or reserves tokens.
    .refine((ms) => !isFinished(ms), FINISHED),
});
export type LiveInput = z.infer<typeof LiveInput>;


export interface LiveTurn {
  action: "send" | "handoff" | "close" | "stop";
  text: string;
  sentAt: string;
  when: string; // local time for display
  flags: string[];
  trace: string[];
  lessonsUsed: number[];
  situation: Situation;
  checks: CheckItem[];
  state: LiveState;
  plan3?: number[]; // the three-payment split, once the customer asked for it
}

// The account facts code checks need for a scenario (hard lessons, recheck).
export function scenarioFacts(scenarioId: string) {
  const a = SCENARIOS.find((x) => x.id === scenarioId)!.account;
  return { business: a.business, firstName: a.firstName, balanceCents: a.balanceCents, plan: installments(a.balanceCents) };
}

// The situation a lesson belongs to: how the last customer message before the corrected reply reads.
export function momentSituation(scenarioId: string, messages: { role: string; text: string }[]): Situation {
  const s = SCENARIOS.find((x) => x.id === scenarioId);
  const last = [...messages].reverse().find((m) => m.role === "customer");
  return s && last ? situationOf(last.text, s.account.firstName) : "general";
}

const dayLabel = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));

export async function liveTurn(
  input: unknown,
  provider: LlmProvider,
  lessons: Lesson[] = [],
  draft?: { instruction: string; hardRule: HardRule | null },
): Promise<LiveTurn> {
  const parsed = LiveInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  const { scenarioId, version, messages } = parsed.data;
  const agentCount = messages.filter((m) => m.role === "agent").length;
  if (agentCount >= LIVE_MAX_AGENT_TURNS) throw new Error(FINISHED);

  const s = SCENARIOS.find((x) => x.id === scenarioId)!;
  const a = s.account;
  const tz = a.timezone;
  const plan = installments(a.balanceCents);
  const customers = messages.filter((m) => m.role === "customer");
  const last = messages[messages.length - 1];

  // The latest date the customer promised, if it is still ahead. A new date replaces it; a firm refusal or a
  // withdrawn payment ("I cannot pay Friday after all") clears it; anything else leaves it as it was.
  let promise: string | null = null;
  for (const m of customers) {
    const date = parsePromise(m.text, new Date(m.sentAt), tz);
    promise = date ?? (FIRM_REFUSAL.test(m.text) || cancelsPromise(m.text) ? null : promise);
  }
  const lastAt = last ? new Date(last.sentAt) : null;
  if (promise && lastAt && localToInstant(promise, FOLLOW_UP_HOUR, 0, tz) <= lastAt) promise = null;

  // Agent opens at the scenario's hour; answers 10 minutes after a customer message; and when the last
  // message is its own (the customer went quiet), follows up at 10:00 local on the promised date, else the next day.
  const followUp = last?.role === "agent";
  const proposedAt = !last ? localToInstant(SIM_DATE, s.startHour, 0, tz) : !followUp ? new Date(Date.parse(last.sentAt) + GAP_MS) : followUpAt(lastAt!, promise, tz);

  const guarded = version === "guarded";
  // The split is known to code once the customer asks; only the guarded agent is told about it and held to it.
  const split3 = customers.some((m) => asksForThree(m.text)) ? installmentsN(a.balanceCents, 3) : undefined;
  const plan3 = guarded ? split3 : undefined;
  // The three-payment option, when allowed, is an account fact (see buildSystemPrompt), not a note.
  const notes = [
    ...(followUp ? ["The customer has not replied to your last message. Write one short, friendly follow-up."] : []),
    ...(guarded && promise ? [`The customer promised to pay on ${dayLabel(promise)}. Confirm that date politely and do not ask for payment before it.`] : []),
  ];
  const facts = { business: a.business, firstName: a.firstName, balanceCents: a.balanceCents, plan, tone: "friendly" as const, channel: "sms" as const, plan3 };
  const lastCustomer = customers[customers.length - 1]?.text ?? null;

  const t = await agentTurn({
    version,
    facts,
    tz,
    history: messages.map((m) => ({ role: m.role, text: m.text })),
    lastCustomer,
    proposedAt,
    isFirst: agentCount === 0,
    provider,
    subject: `live-${scenarioId}`,
    turn: agentCount + 1,
    stats: { calls: 0 },
    rules: "v2", // the live page runs the newer situation rules; the pinned evals stay on v1
    lessons, // applied to the guarded agent only (agentTurn ignores them otherwise)
    draft,
    notes,
    promise,
  });

  const sentAt = t.sendAt.toISOString();
  // Displayed checks: the v1 wording and quiet-hours checks, plus the same live rules the guard enforces, for
  // both agents, so the page never scores a reply the guard would reject. A customer's STOP is code's doing.
  const customerStopped = lastCustomer !== null && isStop(lastCustomer);
  const byCode = t.flags.includes("fixed_reply") || t.flags.includes("fixed_ack");
  const situation = lastCustomer ? situationOf(lastCustomer, a.firstName) : "general";
  const ctx = {
    situation,
    refused: lastCustomer ? isRefusal(lastCustomer) : false,
    needsPerson: lastCustomer ? needsPerson(lastCustomer, a.balanceCents) : false,
    isFirst: agentCount === 0,
    promise,
    sendAt: t.sendAt,
    tz,
  };
  const ruled = liveViolations({ action: t.action, message: t.text }, ctx);
  const hardRules = guarded
    ? [...new Set([...lessons.filter((l) => t.lessonsUsed.includes(l.id) && l.hardRule).map((l) => l.hardRule!), ...(draft?.hardRule && agentCount > 0 ? [draft.hardRule] : [])])]
    : [];
  const lessonMisses = hardRules.flatMap((r) => checkHardRule(r, { action: t.action, message: t.text }, { ...facts, plan3: split3 }) ?? []);
  const checks: CheckItem[] = [
    ...(t.text.trim() ? messageChecks({ seq: messages.length + 1, role: "agent", text: t.text, sentAt, guardFlags: t.flags, checks: [] }, a, agentCount === 0, split3) : []),
    // Code's own replies (a customer STOP, fixed hand-offs, the wrong-person reply) are not the model's to score.
    ...(customerStopped || byCode ? [] : [{ name: "live_rules", passed: ruled.length === 0, detail: ruled.join("; ") }]),
    ...(hardRules.length ? [{ name: "lesson_rules", passed: lessonMisses.length === 0, detail: lessonMisses.join("; ") }] : []),
  ];
  const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t.sendAt);

  const agentTexts = [...messages.filter((m) => m.role === "agent").map((m) => m.text), t.text];
  const hour = requestedHour(customers.map((m) => m.text));
  // If the customer now goes quiet: the guarded agent's follow-up also passes quiet hours and any requested time.
  const open = t.action === "send" && t.text.trim().length > 0 && agentCount + 1 < LIVE_MAX_AGENT_TURNS;
  const rawNext = followUpAt(t.sendAt, promise, tz);
  const next = !guarded ? rawNext : hour === null ? scheduleInWindow(rawNext, tz) : notBeforeHour(rawNext, hour, tz);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  const state: LiveState = {
    balance: formatCents(a.balanceCents),
    planOffered: agentTexts.some((x) => offersAPlan(x, { balanceCents: a.balanceCents, plan, plan3: split3 })),
    promisedOn: promise ? dayLabel(promise) : null,
    contactAfter: hour === null ? null : formatHour(hour),
    stopped: customers.some((m) => isStop(m.text)) || t.action === "stop",
    disputed: customers.some((m) => isDispute(m.text)),
    handedOff: t.action === "handoff",
    lastSent: t.text.trim() ? when : null,
    nextFollowUp: open ? fmt(next) : null,
  };
  return { action: t.action, text: t.text, sentAt, when, flags: t.flags, trace: t.trace, lessonsUsed: t.lessonsUsed, situation: t.situation, checks, state, plan3: split3 };
}
