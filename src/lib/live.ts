// One live agent turn for the local demo page: the visitor plays the customer. Same guard, prompts, and
// checks as the evals. Nothing is stored. Only used by the local-only API route.
import { z } from "zod";
import type { CheckItem } from "./artifact";
import { messageChecks } from "./checks";
import type { LlmProvider } from "./llm/types";
import { installments } from "./money";
import { agentTurn, MAX_AGENT_TURNS } from "./sim/loop";
import { SCENARIOS } from "./sim/scenarios";
import { localToInstant, SIM_DATE } from "./time";

export const MAX_TEXT = 500; // what a visitor can type
const MAX_AGENT_TEXT = 4000; // generous bound for model replies passed back in the history
const GAP_MS = 10 * 60 * 1000;

export const LiveInput = z.object({
  scenarioId: z.string().refine((id) => SCENARIOS.some((s) => s.id === id), "unknown scenario"),
  version: z.enum(["baseline", "guarded"], { message: "version must be baseline or guarded" }),
  messages: z
    .array(
      z
        .object({ role: z.enum(["agent", "customer"]), text: z.string().max(MAX_AGENT_TEXT), sentAt: z.iso.datetime() })
        .refine((m) => m.role !== "customer" || m.text.length <= MAX_TEXT, `messages are limited to ${MAX_TEXT} characters`),
    )
    .max(2 * MAX_AGENT_TURNS),
});
export type LiveInput = z.infer<typeof LiveInput>;

export interface LiveTurn {
  action: "send" | "handoff" | "close" | "stop";
  text: string;
  sentAt: string;
  when: string; // local time for display
  flags: string[];
  trace: string[];
  checks: CheckItem[];
}

export async function liveTurn(input: unknown, provider: LlmProvider): Promise<LiveTurn> {
  const parsed = LiveInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  const { scenarioId, version, messages } = parsed.data;
  const agentCount = messages.filter((m) => m.role === "agent").length;
  if (agentCount >= MAX_AGENT_TURNS) throw new Error("the agent has already sent six messages; start a new conversation");

  const s = SCENARIOS.find((x) => x.id === scenarioId)!;
  const a = s.account;
  const last = messages[messages.length - 1];
  const proposedAt = last ? new Date(Date.parse(last.sentAt) + GAP_MS) : localToInstant(SIM_DATE, s.startHour, 0, a.timezone);

  const t = await agentTurn({
    version,
    facts: { business: a.business, firstName: a.firstName, balanceCents: a.balanceCents, plan: installments(a.balanceCents), tone: "friendly", channel: "sms" },
    tz: a.timezone,
    history: messages.map((m) => ({ role: m.role, text: m.text })),
    lastCustomer: [...messages].reverse().find((m) => m.role === "customer")?.text ?? null,
    proposedAt,
    isFirst: agentCount === 0,
    provider,
    subject: `live-${scenarioId}`,
    turn: agentCount + 1,
    stats: { calls: 0 },
    rules: "v2", // the live page runs the newer situation rules; the pinned evals stay on v1
  });

  const sentAt = t.sendAt.toISOString();
  const checks = t.text.trim()
    ? messageChecks({ seq: messages.length + 1, role: "agent", text: t.text, sentAt, guardFlags: t.flags, checks: [] }, a, agentCount === 0)
    : [];
  const when = new Intl.DateTimeFormat("en-US", { timeZone: a.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t.sendAt);
  return { action: t.action, text: t.text, sentAt, when, flags: t.flags, trace: t.trace, checks };
}
