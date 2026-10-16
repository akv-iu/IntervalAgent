// One conversation: agent opens, scripted customer replies, until an ending or the turn cap.
import { fallbackTemplate, preGenerate, validateOutbound } from "../agent/guard";
import { parseAgentOutput, type AgentOutput } from "../agent/output";
import { buildSystemPrompt, type AgentFacts } from "../agent/prompts";
import type { Conversation, Message, Outcome } from "../artifact";
import { OUTPUT_ATTEMPTS } from "../llm/limits";
import type { LlmMessage, LlmProvider } from "../llm/types";
import { installments } from "../money";
import { redact } from "../env";
import { randInt, type Rng } from "../rng";
import type { Tz } from "../time";
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
}
export interface TurnResult {
  action: "send" | "handoff" | "close" | "stop"; // stop: nothing is sent
  text: string;
  sendAt: Date;
  flags: string[];
}

// One agent turn: the guard decides first (guarded only), then the model writes, then the guard checks
// the draft, regenerates once with feedback, and falls back to the template. Shared by evals and the live demo.
export async function agentTurn(t: TurnInput): Promise<TurnResult> {
  const { version, facts, provider } = t;
  let attempt = 0;
  const generate = async (feedback?: string[]): Promise<AgentOutput> => {
    let system = buildSystemPrompt(version, facts, feedback);
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
  if (version === "guarded") {
    const d = preGenerate(t.lastCustomer, t.proposedAt, t.tz);
    if (d.kind === "stop") return { action: "stop", text: "", sendAt, flags };
    if (d.sendAt.getTime() !== t.proposedAt.getTime()) flags.push("rescheduled");
    if (d.kind === "handoff") return { action: "handoff", text: d.text, sendAt: d.sendAt, flags: [...flags, "handoff", "fixed_ack"] };
    sendAt = d.sendAt;
  }

  let out = await generate();
  if (version === "guarded" && out.action !== "stop" && out.message.trim()) {
    let problems = validateOutbound(out.message, { ...facts, isFirst: t.isFirst });
    if (problems.length) {
      flags.push("regenerated");
      out = await generate(problems);
      problems = out.action === "stop" ? [] : validateOutbound(out.message, { ...facts, isFirst: t.isFirst });
      if (problems.length) {
        flags.push("fallback");
        out = { message: fallbackTemplate(facts), action: "send" };
      }
    }
  }
  if (out.action === "stop") return { action: "stop", text: "", sendAt, flags };
  return { action: out.action, text: out.message, sendAt, flags: out.action === "handoff" ? [...flags, "handoff"] : flags };
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
