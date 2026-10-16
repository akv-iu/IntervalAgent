// Code guard for the guarded system. Reads customer text only, never persona state.
import { extractAmounts, formatCents } from "../money";
import { findThreats, isDispute, isStop } from "../patterns";
import { isRefusal, requestedHour, situationOf, type Situation } from "../situations";
import { notBeforeHour, scheduleInWindow, type Tz } from "../time";

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
const MOD = "(?:equal|monthly|weekly|separate)";
const AMT = String.raw`\$\s?\d[\d,]*(?:\.\d{1,2})?(?!\d|\.\d)`;
// Count, optionally with the amount in between: "two payments", "2 installments", "two $90 payments".
// A dollar amount is never read as a count ("$90 payments" is not 90 payments).
const COUNT = new RegExp(String.raw`(?<![$.,\d])\b(one|two|three|four|five|six|\d+)\s+(?:${MOD}\s+)?(?:(${AMT})\s+)?(?:${MOD}\s+)?(?:payments|installments)\b`, "gi");
// "two payments of $X" (equal) or "two payments of $X and $Y" (both listed).
const TWO_OF = new RegExp(String.raw`\b(?:two|2)\s+(?:\w+\s+)?(?:payments|installments)\s+of\s+(${AMT})(?:\s*(?:and|&|,|plus)\s*(${AMT}))?`, "gi");
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

  // Every stated installment split must be exactly two payments that add up to the balance.
  const checkPair = (x: number, y: number, said: string) => {
    if (x + y !== f.balanceCents || !((x === first && y === second) || (x === second && y === first))) {
      problems.push(`${said} does not match ${formatCents(first)} + ${formatCents(second)} = ${formatCents(f.balanceCents)}`);
    }
  };
  for (const m of text.matchAll(COUNT)) {
    const n = COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    if (n !== 2) problems.push(`unsupported installment count: ${n}`);
    else if (m[2]) {
      const each = extractAmounts(m[2])[0];
      checkPair(each, each, `two payments of ${formatCents(each)}`);
    }
  }
  if (LATER_ORDINAL.test(text)) problems.push("unsupported installment count: more than 2");
  for (const m of text.matchAll(TWO_OF)) {
    const x = extractAmounts(m[1])[0];
    const y = m[2] ? extractAmounts(m[2])[0] : x;
    checkPair(x, y, m[2] ? `payments of ${formatCents(x)} and ${formatCents(y)}` : `two payments of ${formatCents(x)}`);
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

// ---- Rules v2: live Try page only. The pinned evals keep v1 above, so their requests never change. ----

export const WRONG_PERSON_TEXT = "Sorry for the mix-up, and thank you for letting us know. We will not message this number again.";
export const BEREAVEMENT_TEXT =
  "I am very sorry for your loss. I have passed this to a member of our team, and we will not ask for payment while they look into it.";
export const LAWYER_TEXT =
  "Understood. I have passed this to a member of our team, and we will not send further payment messages while they review it.";

export type GuardDecisionV2 = (GuardDecision | { kind: "close"; text: string; sendAt: Date }) & { situation: Situation; refused: boolean; notes: string[] };

export function preGenerateV2(lastCustomerText: string | null, proposedAt: Date, tz: Tz, ctx: { firstName: string; customerTexts: string[] }): GuardDecisionV2 {
  const situation = lastCustomerText ? situationOf(lastCustomerText, ctx.firstName) : "general";
  const refused = lastCustomerText ? isRefusal(lastCustomerText) : false;
  const notes = lastCustomerText ? [`customer message read as: ${situation.replace("_", " ")}${refused && situation !== "refusal" ? " (also a refusal)" : ""}`] : [];
  const hour = requestedHour(ctx.customerTexts);
  const sendAt = hour === null ? scheduleInWindow(proposedAt, tz) : notBeforeHour(proposedAt, hour, tz);
  if (hour !== null) notes.push(`customer asked for after ${formatHour(hour)}`);
  const base = { situation, refused, notes };
  if (lastCustomerText && isStop(lastCustomerText)) return { kind: "stop", ...base };
  if (situation === "wrong_person") return { kind: "close", text: WRONG_PERSON_TEXT, sendAt, ...base };
  if (situation === "bereavement") return { kind: "handoff", text: BEREAVEMENT_TEXT, sendAt, ...base };
  if (situation === "lawyer") return { kind: "handoff", text: LAWYER_TEXT, sendAt, ...base };
  if (lastCustomerText && isDispute(lastCustomerText)) return { kind: "handoff", text: HANDOFF_TEXT, sendAt, ...base };
  return { kind: "generate", sendAt, ...base };
}

const formatHour = (h: number) => `${Math.floor(h) % 12 || 12}:${String(Math.round((h % 1) * 60)).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;

const OFFER_WORD = String.raw`(?:discount|waive|waiving|forgive|settle|settlement|reduce|reduced|lower(?:ed)?\s+(?:the|your)\s+(?:balance|amount)|\d+\s?%|percent)`;
const OFFER = new RegExp(OFFER_WORD, "i");
// Only a negation that comes before the offer word counts ("we can't offer a discount"), not "50% off, no problem".
const NEGATED = new RegExp(String.raw`\b(?:can'?t|cannot|can not|unable to|not able to|don'?t|do not|won'?t|will not|isn'?t|is not|aren'?t|are not)\b[^.!?]*?${OFFER_WORD}`, "i");
const HUMAN_CLAIM = [/\b(i'?m|i am)\s+(a\s+)?(real\s+)?(human|person)\b/i, /\b(speaking|talking|chatting)\s+(with|to)\s+(a\s+)?(real\s+)?(human|person)\b/i, /\bthis\s+is\s+(a\s+)?(real\s+)?(human|person)\b/i];
const DENIES_BOT = /\b(not|n't)\s+(an?\s+)?(bot|robot|machine|ai)\b/i;
const claimsHuman = (sentence: string) => DENIES_BOT.test(sentence) || (HUMAN_CLAIM.some((r) => r.test(sentence)) && !/\bnot\b|n't\b/i.test(sentence));

// ponytail: clause-level negation check (split on punctuation and "but"); "we can't offer a discount" passes, odd phrasing may be rejected and fall back.
// refused: the customer's message contains a refusal anywhere, even when another situation was read first.
export function validateV2(text: string, action: string, situation: Situation, refused = situation === "refusal"): string[] {
  const problems: string[] = [];
  if (action === "close" && (refused || situation === "refusal" || situation === "hardship")) {
    problems.push("do not end the conversation when the customer refuses or is struggling; acknowledge it and offer the payment plan or a person");
  }
  for (const clause of text.split(/(?<=[.!?])\s+|[,;:]\s*|\s+(?:but|however|though|although)\s+/i)) {
    if (OFFER.test(clause) && !NEGATED.test(clause)) problems.push("never offer discounts, settlements, waivers, or reduced amounts");
    if (claimsHuman(clause)) problems.push("never claim to be a human; say you are an automated assistant if asked");
  }
  return [...new Set(problems)];
}

// Fallback for v2: the v1 template plus a way to reach a person, which satisfies every v2 check.
export function fallbackTemplateV2(a: Parameters<typeof fallbackTemplate>[0]): string {
  return `${fallbackTemplate(a)} If you would rather talk it through with someone on our team, just say so.`;
}
