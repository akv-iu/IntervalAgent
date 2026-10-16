// One conversation: agent opens, scripted customer replies, until an ending or the turn cap.
import { fallbackTemplate, preGenerate, preGenerateV2, validateOutbound, validateV2 } from "../agent/guard";
import { checkHardRule, pickLessons, ruleFallback, type HardRule, type Lesson } from "../lessons";
import type { Situation } from "../situations";
import { parseAgentOutput, type AgentOutput } from "../agent/output";
import { buildSystemPrompt, type AgentFacts } from "../agent/prompts";
import type { Conversation, Message, Outcome } from "../artifact";
import { OUTPUT_ATTEMPTS } from "../llm/limits";
import type { LlmMessage, LlmProvider } from "../llm/types";
import { installments } from "../money";
import { redact } from "../env";
import { randInt, type Rng } from "../rng";
import { scheduleInWindow, type Tz } from "../time";
import type { Account } from "./accounts";
import { initialPersonaState, personaReply, type PersonaState } from "./personas";
import type { Script } from "./scenarios";

export const MAX_AGENT_TURNS = 6;
const GAP_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
const JSON_CORRECTION = "Your previous reply was not valid JSON in the required format. Reply with JSON only.";

export { parseAgentOutput, type AgentOutput };
export type ConversationResult = Omit<Conversation, "scenarioChecks"> & { llmCalls: number };

export class GenerationFailed extends Error {}

export interface TurnInput {
  version: "baseline" | "guarded";
  facts: AgentFacts;
  tz: Tz;
  history: LlmMessage[]; // text-only, agent and customer messages so far
  lastCustomer: string | null;
  proposedAt: Date;
  isFirst: boolean;
  provider: LlmProvider;
  subject: string; // scenario or account key, for recording keys only
  turn: number;
  stats: { calls: number }; // incremented per model call, even if the turn then fails
  rules?: "v1" | "v2"; // v2 (live Try page only) adds situation handling; the evals use v1
  lessons?: Lesson[]; // v2 only: saved lessons; the ones for this situation are applied
  draft?: { instruction: string; hardRule: HardRule | null }; // v2 only: a lesson being tried, not yet saved
  notes?: string[]; // live only: conversation notes for the prompt (follow-up, promised date, three-payment option)
  plan3?: number[]; // live guarded only: three-payment amounts the guard accepts after the customer asked
}
export interface TurnResult {
  action: "send" | "handoff" | "close" | "stop"; // stop: nothing is sent
  text: string;
  sendAt: Date;
  flags: string[];
  trace: string[]; // what the guard did, in plain words, for display only
  lessonsUsed: number[]; // ids of saved lessons sent with this reply
  situation: Situation; // how the guard read the last customer message (v2), else "general"
}

// One agent turn: the guard decides first (guarded only), then the model writes, then the guard checks
// the draft, regenerates once with feedback, and falls back to the template. Shared by evals and the live demo.
export async function agentTurn(t: TurnInput): Promise<TurnResult> {
  const { version, facts, provider } = t;
  const v2 = version === "guarded" && t.rules === "v2";
  let attempt = 0;
  const generate = async (feedback?: string[]): Promise<AgentOutput> => {
    let system = buildSystemPrompt(version, facts, feedback, v2 ? "v2" : "v1", corrections, t.notes);
    for (let i = 1; i <= OUTPUT_ATTEMPTS; i++) {
      t.stats.calls++;
      attempt++;
      let res;
      try {
        res = await provider.complete({ system, messages: t.history, context: { subject: t.subject, version, turn: t.turn, attempt } });
      } catch (e) {
        // Providers apply their own bounded retries; anything that escapes ends this conversation.
        throw new GenerationFailed(redact(e instanceof Error ? e.message : String(e)));
      }
      const out = parseAgentOutput(res.text);
      if (out) return out;
      system = `${system}\n\n${JSON_CORRECTION}`;
    }
    throw new GenerationFailed("invalid structured output after one corrective attempt");
  };

  let sendAt = t.proposedAt;
  const flags: string[] = [];
  const trace: string[] = [];
  let situation: Situation = "general";
  let refused = false;
  let corrections: string[] = [];
  let hardRules: HardRule[] = [];
  let lessonsUsed: number[] = [];
  if (v2) {
    const customerTexts = t.history.filter((m) => m.role === "customer").map((m) => m.text);
    const d = preGenerateV2(t.lastCustomer, t.proposedAt, t.tz, { firstName: facts.firstName, customerTexts });
    situation = d.situation;
    refused = d.refused;
    trace.push(...d.notes);
    if (d.kind === "stop") return { action: "stop", text: "", sendAt, flags, trace: [...trace, "stop request: nothing sent"], lessonsUsed, situation };
    const windowed = scheduleInWindow(t.proposedAt, t.tz).getTime();
    if (d.sendAt.getTime() !== windowed) flags.push("customer_time");
    else if (windowed !== t.proposedAt.getTime()) flags.push("rescheduled");
    if (d.kind === "handoff") return { action: "handoff", text: d.text, sendAt: d.sendAt, flags: [...flags, "handoff", "fixed_ack"], trace: [...trace, "fixed handoff sent, no AI call"], lessonsUsed, situation };
    if (d.kind === "close") return { action: "close", text: d.text, sendAt: d.sendAt, flags: [...flags, "fixed_reply"], trace: [...trace, "fixed reply sent, no AI call; contact ends"], lessonsUsed, situation };
    sendAt = d.sendAt;
    // The opening message follows fixed rules (business, overdue, balance); lessons start with the first customer reply.
    const picked = t.isFirst ? [] : pickLessons(t.lessons ?? [], situation);
    const draft = t.isFirst ? undefined : t.draft;
    lessonsUsed = picked.map((l) => l.id);
    corrections = [...picked.map((l) => l.instruction), ...(draft ? [draft.instruction] : [])];
    hardRules = [...new Set([...picked.flatMap((l) => (l.hardRule ? [l.hardRule] : [])), ...(draft?.hardRule ? [draft.hardRule] : [])])];
    for (const l of picked) trace.push(`lesson #${l.id} applied (${l.hardRule ? "hard: checked by code" : "soft: in the instructions"})`);
    if (draft) trace.push(`draft lesson applied (${draft.hardRule ? "hard: checked by code" : "soft: in the instructions"})`);
  } else if (version === "guarded") {
    const d = preGenerate(t.lastCustomer, t.proposedAt, t.tz);
    if (d.kind === "stop") return { action: "stop", text: "", sendAt, flags, trace, lessonsUsed, situation };
    if (d.sendAt.getTime() !== t.proposedAt.getTime()) flags.push("rescheduled");
    if (d.kind === "handoff") return { action: "handoff", text: d.text, sendAt: d.sendAt, flags: [...flags, "handoff", "fixed_ack"], trace, lessonsUsed, situation };
    sendAt = d.sendAt;
  }

  // v1 exactly as before: the first draft is checked only when it has text, a rewrite always (an empty rewrite falls back).
  // v2 also checks the action itself, and lets an empty close through unless the customer refused.
  // v2: a stop the model chose (the customer did not ask; that case returned above) ends contact, so it is
  // checked like a close against refusals and hard lessons.
  const check = (o: AgentOutput) =>
    o.action === "stop"
      ? v2
        ? [...validateV2(o.message, "close", situation, refused), ...hardRules.flatMap((r) => checkHardRule(r, o, { ...facts, plan3: t.plan3 }) ?? [])]
        : []
      : [
          ...(o.message.trim() || !v2 ? validateOutbound(o.message, { ...facts, isFirst: t.isFirst, plan3: t.plan3 }) : []),
          ...(v2 ? validateV2(o.message, o.action, situation, refused) : []),
          ...hardRules.flatMap((r) => checkHardRule(r, o, { ...facts, plan3: t.plan3 }) ?? []),
        ];
  let out = await generate();
  if (version === "guarded" && (v2 || (out.action !== "stop" && out.message.trim()))) {
    let problems = check(out);
    if (problems.length) {
      flags.push("regenerated");
      trace.push(`draft rejected: ${problems.join("; ")}`);
      out = await generate(problems);
      problems = check(out);
      if (problems.length) {
        flags.push("fallback");
        trace.push(`rewrite rejected too: ${problems.join("; ")}`, "safe template sent");
        out = v2 ? ruleFallback(hardRules, facts) : { message: fallbackTemplate(facts), action: "send" };
      } else trace.push("rewrite passed");
    }
  }
  if (out.action === "stop") return { action: "stop", text: "", sendAt, flags, trace, lessonsUsed, situation };
  return { action: out.action, text: out.message, sendAt, flags: out.action === "handoff" ? [...flags, "handoff"] : flags, trace, lessonsUsed, situation };
}

export interface RunOptions {
  account: Account;
  script: Script;
  scenarioId?: string | null;
  version: "baseline" | "guarded";
  startAt: Date;
  provider: LlmProvider;
  rng: Rng;
  channel?: "sms" | "email";
  tone?: "friendly" | "formal";
}

export async function runConversation(o: RunOptions): Promise<ConversationResult> {
  const { account, version, provider } = o;
  const channel = o.channel ?? "sms";
  const tone = o.tone ?? "friendly";
  const tz = account.timezone;
  const plan = installments(account.balanceCents);
  const facts: AgentFacts = { business: account.business, firstName: account.firstName, balanceCents: account.balanceCents, plan, tone, channel };

  const messages: Message[] = [];
  const stats = { calls: 0 };
  let state: PersonaState = initialPersonaState();
  let clock = o.startAt;
  let agentTurns = 0;
  let handedToHuman = false;
  let agreedAt: Date | null = null;
  let failed = false;

  const history = (): LlmMessage[] =>
    messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "agent" | "customer", text: m.text }));

  const push = (role: Message["role"], text: string, at: Date, guardFlags: string[] = [], personaState?: PersonaState) => {
    messages.push({ seq: messages.length + 1, role, text, sentAt: at.toISOString(), guardFlags, checks: [], ...(personaState ? { personaState } : {}) });
  };

  try {
    while (agentTurns < MAX_AGENT_TURNS) {
      const t = await agentTurn({
        version,
        facts,
        tz,
        history: history(),
        lastCustomer: [...messages].reverse().find((m) => m.role === "customer")?.text ?? null,
        proposedAt: clock,
        isFirst: agentTurns === 0,
        provider,
        subject: o.scenarioId ?? account.accountKey,
        turn: agentTurns + 1,
        stats,
      });
      if (t.action === "stop") break;
      if (t.text.trim()) {
        push("agent", t.text, t.sendAt, t.flags);
        agentTurns++;
        clock = t.sendAt;
      }
      if (t.action === "handoff") {
        handedToHuman = true;
        break;
      }
      if (t.action === "close") break;

      const reply = personaReply(o.script, t.text, state, { balanceCents: account.balanceCents, plan });
      state = reply.state;
      if (reply.text === null) break; // silent customer
      const replyAt = new Date(clock.getTime() + GAP_MS);
      push("customer", reply.text, replyAt, [], state);
      if (state.agreed) {
        agreedAt = replyAt;
        break;
      }
      clock = new Date(replyAt.getTime() + GAP_MS);
    }
  } catch (e) {
    if (!(e instanceof GenerationFailed)) throw e;
    failed = true;
    push("system", `generation failed: ${e.message}`, clock);
  }

  // An agent that never sent anything did not complete outreach (SPEC 3: empty conversations fail).
  if (!failed && !messages.some((m) => m.role === "agent")) {
    failed = true;
    push("system", "generation failed: agent sent no messages", clock);
  }

  const outcome: Outcome = failed
    ? "failed"
    : state.agreed === "full"
      ? "agreed_to_pay"
      : state.agreed === "plan"
        ? "payment_plan"
        : state.agreed === "promise"
          ? "promise_to_pay"
          : state.disputed
            ? "disputed"
            : state.stopped
              ? "stopped"
              : "no_response";
  const paidAt = outcome === "agreed_to_pay" && agreedAt ? new Date(agreedAt.getTime() + randInt(o.rng, 1, 3) * DAY_MS) : null;

  return {
    accountKey: account.accountKey,
    scenarioId: o.scenarioId ?? null,
    version,
    channel,
    tone,
    startedAt: o.startAt.toISOString(),
    outcome,
    agreedAt: agreedAt ? agreedAt.toISOString() : null,
    paidAt: paidAt ? paidAt.toISOString() : null,
    recoveredCents: paidAt ? account.balanceCents : 0,
    handedToHuman,
    messages,
    llmCalls: stats.calls,
  };
}
