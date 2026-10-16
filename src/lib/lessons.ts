// Lessons a person teaches the guarded agent on the local Try page. The model never changes: soft lessons
// are added to the prompt, hard lessons are checked by code. Pure module: types, input rules, and checks.
import { z } from "zod";
import { fallbackTemplateV2, HANDOFF_TEXT } from "./agent/guard";
import { extractAmounts, offersThreePaymentPlan, offersTwoPaymentPlan } from "./money";
import type { Situation } from "./situations";

// The reason is a label for the log. Picking one pre-fills a suggested lesson the person can edit.
export const REASONS = [
  {
    id: "gave_up",
    label: "Gave up too early",
    suggest: { instruction: "Do not end the conversation. Acknowledge what they said, then offer the payment plan or someone on our team.", hardRule: "offer_person" },
  },
  {
    id: "wrong_amount",
    label: "Wrong or confusing amount",
    suggest: { instruction: "State only the balance and the payment plan amounts from the account facts, exactly as written.", hardRule: "mention_plan" },
  },
  { id: "tone", label: "Wrong tone", suggest: { instruction: "Be warmer and shorter. Acknowledge how they feel before anything else.", hardRule: null } },
  {
    id: "ignored_customer",
    label: "Ignored what the customer said",
    suggest: { instruction: "Answer what the customer actually asked first, in one sentence, then offer the next step.", hardRule: null },
  },
  { id: "other", label: "Something else", suggest: { instruction: "", hardRule: null } },
] as const;

export const HARD_RULES = [
  { id: "no_close", label: "Must not end the conversation here" },
  { id: "mention_plan", label: "Must offer the payment plan" },
  { id: "offer_person", label: "Must offer someone on our team" },
  { id: "handoff", label: "Must hand off to a person" },
] as const;

export type Reason = (typeof REASONS)[number]["id"];
export type HardRule = (typeof HARD_RULES)[number]["id"];
export const MAX_INSTRUCTION = 300;
export const MAX_LESSONS_PER_REPLY = 8;

export const DraftLesson = z
  .object({
    reason: z.enum(REASONS.map((r) => r.id) as [Reason, ...Reason[]]),
    instruction: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "write what the agent should have done").max(MAX_INSTRUCTION, `lessons are limited to ${MAX_INSTRUCTION} characters`)),
    hardRule: z.enum(HARD_RULES.map((r) => r.id) as [HardRule, ...HardRule[]]).nullable(),
    // "situation": only when the customer's message reads the same way. "all": every reply after the opening.
    appliesTo: z.enum(["situation", "all"]).default("situation"),
  })
  .refine((d) => !(d.hardRule === "handoff" && d.appliesTo === "all"), "a hand-off rule on every reply would end every conversation; limit it to this situation");
export type DraftLesson = z.infer<typeof DraftLesson>;
export type DraftLessonInput = z.input<typeof DraftLesson>;

export interface MomentMessage {
  role: "agent" | "customer";
  text: string;
  sentAt: string;
}

export interface Lesson extends DraftLesson {
  id: number;
  createdAt: string;
  situation: Situation;
  scenarioId: string;
  moment: MomentMessage[]; // the conversation just before the corrected reply
  beforeText: string;
  afterText: string;
  active: boolean;
  timesUsed: number;
}

// The lessons sent for this customer message: active, same situation or general, newest first, capped.
export function pickLessons(all: Lesson[], situation: Situation, max = MAX_LESSONS_PER_REPLY): Lesson[] {
  return all
    .filter((l) => l.active && (l.appliesTo === "all" || l.situation === situation))
    .sort((a, b) => b.id - a.id)
    .slice(0, max);
}

interface PlanFacts {
  business: string;
  firstName: string;
  balanceCents: number;
  plan: [number, number];
  plan3?: number[]; // live only: the three-payment split the customer asked for
}

const WHO = String.raw`(?:team|person|someone|representative|colleague|member of our)`;
// An actual offer of a person: "talk it through with someone on our team", "passed this to a member of our team".
const OFFERS_PERSON = [
  new RegExp(String.raw`\b(?:talk|speak|chat|connect|pass|passed|reach|put you in touch)\b[^.!?]{0,40}\b${WHO}`, "i"),
  new RegExp(String.raw`\b${WHO}[^.!?]{0,40}\b(?:can|will|could)\s+(?:help|talk|reach|call|follow|discuss|contact)`, "i"),
];
// ponytail: clause-level negation, as in the v2 guard; odd phrasing may be rejected and fall back to the safe reply.
const NEGATED = /\b(?:can'?t|cannot|can not|won'?t|will not|don'?t|do not|never|unable|not able|no one|no longer|not available|unavailable)\b/i;
const clauses = (text: string) => text.split(/(?<=[.!?])\s+|[,;:]\s*|\s+but\s+/i);
const offersPerson = (text: string) => clauses(text).some((c) => OFFERS_PERSON.some((r) => r.test(c)) && !NEGATED.test(c));
// The plan is offered, and no clause that states a plan amount takes it back.
const offersPlan = (text: string, plan: [number, number]) =>
  offersTwoPaymentPlan(text, plan) && !clauses(text).some((c) => extractAmounts(c).some((a) => plan.includes(a)) && NEGATED.test(c));

export function checkHardRule(rule: HardRule, out: { action: string; message: string }, f: PlanFacts): string | null {
  switch (rule) {
    case "no_close":
      return out.action === "close" || out.action === "stop" ? "a saved lesson says not to end the conversation here" : null;
    case "mention_plan":
      return out.action === "send" && (offersPlan(out.message, f.plan) || (f.plan3 && offersThreePaymentPlan(out.message, f.plan3, f.balanceCents)))
        ? null
        : "a saved lesson says to offer the payment plan";
    case "offer_person":
      // A stop sends nothing, so it cannot offer anyone.
      return out.action !== "stop" && offersPerson(out.message) ? null : "a saved lesson says to offer someone on our team";
    case "handoff":
      return out.action === "handoff" ? null : "a saved lesson says to hand off to a person";
  }
}

// A reply that satisfies the given hard rules when the model could not.
// ponytail: "handoff" wins over the others, since a handoff cannot also ask for payment.
export function ruleFallback(rules: HardRule[], f: PlanFacts): { action: "send" | "handoff"; message: string } {
  return rules.includes("handoff") ? { action: "handoff", message: HANDOFF_TEXT } : { action: "send", message: fallbackTemplateV2(f) };
}
