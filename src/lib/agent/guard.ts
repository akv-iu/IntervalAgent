// Code guard for the guarded system. Reads customer text only, never persona state.
import { extractAmounts, formatCents } from "../money";
import { findThreats, isDispute, isStop } from "../patterns";
import { scheduleInWindow, type Tz } from "../time";

export type GuardDecision =
  | { kind: "stop" }
  | { kind: "handoff"; text: string; sendAt: Date }
  | { kind: "generate"; sendAt: Date };

export const HANDOFF_TEXT =
  "Thanks for letting us know. I have passed this to a member of our team, who will follow up with you. We will not ask for payment while they review it.";

export function preGenerate(lastCustomerText: string | null, proposedAt: Date, tz: Tz): GuardDecision {
  if (lastCustomerText && isStop(lastCustomerText)) return { kind: "stop" };
  const sendAt = scheduleInWindow(proposedAt, tz);
  if (lastCustomerText && isDispute(lastCustomerText)) return { kind: "handoff", text: HANDOFF_TEXT, sendAt };
  return { kind: "generate", sendAt };
}

interface Facts {
  business: string;
  balanceCents: number;
  plan: [number, number];
  isFirst: boolean;
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const COUNT = /\b(one|two|three|four|five|six|\d+)\s+(?:equal\s+|monthly\s+|weekly\s+|separate\s+)?(?:payments|installments)\b/gi;
const TWO_OF = /\b(?:two|2)\s+(?:\w+\s+)?(?:payments|installments)\s+of\s+(\$\s?\d[\d,]*(?:\.\d{1,2})?)/gi;
const LATER_ORDINAL = /\b(third|fourth|fifth|sixth|3rd|4th|5th|6th)\s+(?:payment|installment)/i;
const BALANCE_WORDS = /\b(balance|owe|outstanding|total)\b/i;
const PLAN_WORDS = /\b(payments?|installments?|split|plan)\b/i;
const DOLLAR_TOKEN = /\$\s?\d/g;
const DOLLAR_PARSED = /\$\s?\d[\d,]*(?:\.\d{1,2})?(?![.,]?\d)/g;

// ponytail: narrow parser for the phrasing our prompts and template use; unusual numeric phrasing is rejected, not understood.
export function validateOutbound(text: string, f: Facts): string[] {
  const problems: string[] = [];
  if (!text.trim()) return ["empty message"];

  for (const t of findThreats(text)) problems.push(`prohibited wording: ${t}`);

  if ((text.match(DOLLAR_TOKEN)?.length ?? 0) > (text.match(DOLLAR_PARSED)?.length ?? 0)) problems.push("unverifiable amount");

  const [first, second] = f.plan;
  const amounts = extractAmounts(text);
  const allowed = new Set([f.balanceCents, first, second]);
  for (const a of amounts) if (!allowed.has(a)) problems.push(`unsupported amount ${formatCents(a)}`);

  for (const m of text.matchAll(COUNT)) {
    const n = COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    if (n !== 2) problems.push(`unsupported installment count: ${n}`);
  }

  if (LATER_ORDINAL.test(text)) problems.push("unsupported installment count: more than 2");
  for (const m of text.matchAll(TWO_OF)) {
    const each = extractAmounts(m[1])[0];
    if (each * 2 !== f.balanceCents) problems.push(`two payments of ${formatCents(each)} do not total ${formatCents(f.balanceCents)}`);
  }

  // A sentence about the balance (and not about a plan) may only state the balance.
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!BALANCE_WORDS.test(sentence) || PLAN_WORDS.test(sentence)) continue;
    if (extractAmounts(sentence).some((a) => a !== f.balanceCents)) problems.push(`stated balance must be ${formatCents(f.balanceCents)}`);
  }

  const planAmounts = amounts.filter((a) => a !== f.balanceCents);
  if (planAmounts.length > 2) problems.push("more than two installment amounts");
  if (planAmounts.length > 0 && first !== second && !(planAmounts.includes(first) && planAmounts.includes(second))) {
    problems.push(`installments must be ${formatCents(first)} and ${formatCents(second)}`);
  }

  if (f.isFirst) {
    if (!text.toLowerCase().includes(f.business.toLowerCase())) problems.push("first message must name the business");
    if (!/\b(overdue|past[\s-]due)\b/i.test(text)) problems.push("first message must say overdue or past due");
    if (!amounts.includes(f.balanceCents)) problems.push("first message must state the exact balance");
  }
  return problems;
}

export function fallbackTemplate(a: { business: string; firstName: string; balanceCents: number; plan: [number, number] }): string {
  const [first, second] = a.plan;
  const plan =
    first === second
      ? `two payments of ${formatCents(first)}`
      : `a first payment of ${formatCents(first)} and a second payment of ${formatCents(second)}`;
  return `Hi ${a.firstName}, this is ${a.business}. Your account is past due with a balance of ${formatCents(a.balanceCents)}. You can pay the full ${formatCents(a.balanceCents)}, or split it into ${plan}. Reply here if you have questions.`;
}
