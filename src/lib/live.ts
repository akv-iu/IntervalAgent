// One live agent turn for the local demo page: the visitor plays the customer. Same guard, prompts, and
// checks as the evals, plus the live-only extras (rules v2, lessons, follow-ups, promise dates, three
// payments). Nothing is stored here. Only used by the local-only API route.
import { z } from "zod";
import { formatHour } from "./agent/guard";
import { notBeforeHour, scheduleInWindow } from "./time";
import type { CheckItem } from "./artifact";
import { messageChecks } from "./checks";
import type { HardRule, Lesson } from "./lessons";
import type { LiveState } from "./live-state";
import type { LlmProvider } from "./llm/types";
import { formatCents, installments, installmentsN, offersThreePaymentPlan, offersTwoPaymentPlan } from "./money";
import { isDispute, isStop } from "./patterns";
import { parsePromise } from "./promise";
import { agentTurn } from "./sim/loop";
import { SCENARIOS } from "./sim/scenarios";
import { FIRM_REFUSAL, requestedHour, situationOf, type Situation } from "./situations";
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
    .refine((ms) => ms.every((m, i) => i === 0 || Date.parse(m.sentAt) >= Date.parse(ms[i - 1].sentAt)), "messages must be in time order"),
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
  if (agentCount >= LIVE_MAX_AGENT_TURNS) throw new Error("the agent has already sent ten messages; start a new conversation");

  const s = SCENARIOS.find((x) => x.id === scenarioId)!;
  const a = s.account;
  const tz = a.timezone;
  const plan = installments(a.balanceCents);
  const customers = messages.filter((m) => m.role === "customer");
  const last = messages[messages.length - 1];

  // The latest date the customer promised, if it is still ahead. A later firm refusal withdraws it.
  let promise: string | null = null;
  for (const m of customers) promise = FIRM_REFUSAL.test(m.text) ? null : (parsePromise(m.text, new Date(m.sentAt), tz) ?? promise);
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
  const notes = [
    ...(followUp ? ["The customer has not replied to your last message. Write one short, friendly follow-up."] : []),
    ...(guarded && promise ? [`The customer promised to pay on ${dayLabel(promise)}. Confirm that date politely and do not ask for payment before it.`] : []),
    ...(plan3 ? [`The customer asked for three payments. You may offer exactly three payments of ${plan3.map(formatCents).join(", ")}, in that order.`] : []),
  ];

  const t = await agentTurn({
    version,
    facts: { business: a.business, firstName: a.firstName, balanceCents: a.balanceCents, plan, tone: "friendly", channel: "sms" },
    tz,
    history: messages.map((m) => ({ role: m.role, text: m.text })),
    lastCustomer: customers[customers.length - 1]?.text ?? null,
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
    plan3,
  });

  const sentAt = t.sendAt.toISOString();
  const checks = t.text.trim()
    ? messageChecks({ seq: messages.length + 1, role: "agent", text: t.text, sentAt, guardFlags: t.flags, checks: [] }, a, agentCount === 0, split3)
    : [];
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
    planOffered: agentTexts.some((x) => offersTwoPaymentPlan(x, plan) || (split3 !== undefined && offersThreePaymentPlan(x, split3, a.balanceCents))),
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
