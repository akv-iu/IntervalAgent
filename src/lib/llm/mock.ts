// Deterministic stand-ins for a model. Both read only the request text, like a live model would.
import { extractAmounts, formatCents } from "../money";
import { isDispute, isStop } from "../patterns";
import type { LlmProvider, LlmRequest } from "./types";

interface ParsedFacts {
  business: string;
  firstName: string;
  balance: number;
  first: number;
  second: number;
}

function parseFacts(system: string): ParsedFacts {
  const line = (label: string) => system.match(new RegExp(`^- ${label}: (.+)$`, "m"))?.[1] ?? "";
  const [first, second] = extractAmounts(line("Two-payment option"));
  return {
    business: line("Business"),
    firstName: line("Customer first name"),
    balance: extractAmounts(line("Overdue balance"))[0],
    first,
    second,
  };
}

function planText(f: ParsedFacts): string {
  return f.first === f.second
    ? `two payments of ${formatCents(f.first)}`
    : `a first payment of ${formatCents(f.first)} and a second payment of ${formatCents(f.second)}`;
}

const reply = (message: string, action: "send" | "handoff" | "stop" | "close") => ({ text: JSON.stringify({ message, action }) });

export function mockProvider(): LlmProvider {
  return {
    name: "mock",
    model: "mock-agent-v1",
    params: { temperature: 0 },
    async complete(req: LlmRequest) {
      const f = parseFacts(req.system);
      const last = [...req.messages].reverse().find((m) => m.role === "customer")?.text ?? null;
      if (!req.messages.some((m) => m.role === "agent")) {
        return reply(
          `Hi ${f.firstName}, this is ${f.business}. Your account is past due with a balance of ${formatCents(f.balance)}. You can pay the full amount, or split it into ${planText(f)}. Reply here with any questions.`,
          "send",
        );
      }
      if (last && isStop(last)) return reply("", "stop");
      if (last && isDispute(last)) return reply("Thanks for telling us. A member of our team will review this and follow up.", "handoff");
      if (last && /\b(works for me|i'll pay|i will pay|let's do)\b/i.test(last)) return reply("Thank you. We have noted that. Have a good day.", "close");
      if (last && /\b(next week|look at it|deal with it)\b/i.test(last)) return reply("Understood. Thank you for letting us know.", "close");
      return reply(`I understand. The options are paying the full amount or ${planText(f)}. Let me know what works for you.`, "send");
    },
  };
}

// Deliberately bad TEST FIXTURE. Never live evidence: threatens, states a wrong amount, ignores refusals.
export function mockBadProvider(): LlmProvider {
  return {
    name: "mock-bad",
    model: "mock-bad-fixture-v1",
    params: { temperature: 0 },
    async complete() {
      return reply("FINAL NOTICE: you owe $999.99. Pay today or we will sue you and report this to your credit report.", "send");
    },
  };
}
