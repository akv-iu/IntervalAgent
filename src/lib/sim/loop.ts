// One conversation: agent opens, scripted customer replies, until an ending or the turn cap.
import { z } from "zod";
import { fallbackTemplate, preGenerate, validateOutbound } from "../agent/guard";
import { buildSystemPrompt, type AgentFacts } from "../agent/prompts";
import type { Conversation, Message, Outcome } from "../artifact";
import type { LlmMessage, LlmProvider } from "../llm/types";
import { installments } from "../money";
import { redact } from "../env";
import { randInt, type Rng } from "../rng";
import type { Account } from "./accounts";
import { initialPersonaState, personaReply, type PersonaState } from "./personas";
import type { Script } from "./scenarios";

export const MAX_AGENT_TURNS = 6;
const GAP_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
const JSON_CORRECTION = "Your previous reply was not valid JSON in the required format. Reply with JSON only.";

// A send must carry text; otherwise the loop would make progress without outreach.
const AgentOutput = z
  .object({ message: z.string(), action: z.enum(["send", "handoff", "stop", "close"]) })
  .refine((o) => o.action !== "send" || o.message.trim().length > 0, "send needs a message");
export type AgentOutput = z.infer<typeof AgentOutput>;
export type ConversationResult = Omit<Conversation, "scenarioChecks"> & { llmCalls: number };

// Tolerates code fences and leading prose: takes the outermost {...}.
export function parseAgentOutput(raw: string): AgentOutput | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = AgentOutput.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

class GenerationFailed extends Error {}

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
  let llmCalls = 0;
  let state: PersonaState = initialPersonaState();
  let clock = o.startAt;
  let agentTurns = 0;
  let handedToHuman = false;
  let agreedAt: Date | null = null;
  let failed = false;
  let turnAttempt = 0;

  const history = (): LlmMessage[] =>
    messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "agent" | "customer", text: m.text }));

  const push = (role: Message["role"], text: string, at: Date, guardFlags: string[] = [], personaState?: PersonaState) => {
    messages.push({ seq: messages.length + 1, role, text, sentAt: at.toISOString(), guardFlags, checks: [], ...(personaState ? { personaState } : {}) });
  };

  // One generation, with a single corrective retry for invalid JSON.
  const generate = async (feedback?: string[]): Promise<AgentOutput> => {
    let system = buildSystemPrompt(version, facts, feedback);
    for (let attempt = 1; attempt <= 2; attempt++) {
      llmCalls++;
      turnAttempt++;
      let res;
      try {
        res = await provider.complete({
          system,
          messages: history(),
          context: { subject: o.scenarioId ?? account.accountKey, version, turn: agentTurns + 1, attempt: turnAttempt },
        });
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

  try {
    while (agentTurns < MAX_AGENT_TURNS) {
      turnAttempt = 0;
      const lastCustomer = [...messages].reverse().find((m) => m.role === "customer")?.text ?? null;
      const isFirst = agentTurns === 0;
      let sendAt = clock;
      const flags: string[] = [];

      if (version === "guarded") {
        const d = preGenerate(lastCustomer, clock, tz);
        if (d.kind === "stop") break;
        if (d.sendAt.getTime() !== clock.getTime()) flags.push("rescheduled");
        if (d.kind === "handoff") {
          push("agent", d.text, d.sendAt, [...flags, "handoff", "fixed_ack"]);
          handedToHuman = true;
          break;
        }
        sendAt = d.sendAt;
      }

      let out = await generate();
      if (version === "guarded" && out.action !== "stop" && out.message.trim()) {
        let problems = validateOutbound(out.message, { ...facts, isFirst });
        if (problems.length) {
          flags.push("regenerated");
          out = await generate(problems);
          problems = out.action === "stop" ? [] : validateOutbound(out.message, { ...facts, isFirst });
          if (problems.length) {
            flags.push("fallback");
            out = { message: fallbackTemplate(facts), action: "send" };
          }
        }
      }

      if (out.action === "stop") break;
      if (out.message.trim()) {
        push("agent", out.message, sendAt, flags.concat(out.action === "handoff" ? ["handoff"] : []));
        agentTurns++;
        clock = sendAt;
      }
      if (out.action === "handoff") {
        handedToHuman = true;
        break;
      }
      if (out.action === "close") break;

      const reply = personaReply(o.script, out.message, state, { balanceCents: account.balanceCents, plan });
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
    llmCalls,
  };
}
