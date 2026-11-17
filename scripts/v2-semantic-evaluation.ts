import { z } from "zod";
import raw from "../fixtures/v2/semantic-20261026-1/cases.json";
import { openingMessage, startingCases } from "../src/lib/v2/fixtures";
import type { Investigation, InvestigationResult } from "../src/lib/v2/contracts";

const Sample = z.object({
  id: z.string(), category: z.enum(["target", "regression", "safety"]), caseId: z.string(),
  messages: z.array(z.object({ id: z.string(), speaker: z.enum(["customer", "agent", "business"]), text: z.string(), channel: z.enum(["customer", "business"]).optional(), requestId: z.string().optional() }).strict()),
  expected: z.object({ action: z.enum(["investigate", "do_not_investigate", "keep_unknown"]), claimMessageId: z.string().optional(), amountCents: z.number().int().positive().optional(), paymentDate: z.iso.date().nullable().optional() }).strict(),
}).strict();
export const semanticSuite = z.object({ version: z.literal("semantic-20261026-1"), baselineRevision: z.literal("6bf7fd4d2c07ee98caca06a632e3a7ccc77d1930"), now: z.iso.datetime(), cases: z.array(Sample).length(9) }).strict().parse(raw);
export type SemanticSample = z.infer<typeof Sample>;

export function semanticInput(sample: SemanticSample): Investigation {
  const facts = startingCases(new Date(semanticSuite.now)).find((f) => f.id === sample.caseId);
  if (!facts) throw new Error("Unknown evaluation account");
  const input: Investigation = { facts, now: semanticSuite.now, verification: null, messages: [openingMessage(facts, new Date(semanticSuite.now)), ...sample.messages.map((m) => ({ ...m, channel: m.channel ?? "customer" as const, at: semanticSuite.now }))] };
  if (sample.expected.action === "keep_unknown") {
    input.requestId = "evaluation-request";
    input.verification = { claimMessageId: "claim", outcome: "awaiting_business", businessMessage: sample.messages.find((m) => m.channel === "business" && m.speaker === "agent")!.text, summary: "Awaiting business payment details", amountCents: null, paymentDate: null, invoiceId: facts.invoiceId, reference: null, settlementStatus: "unknown", missingFacts: ["amount", "date", "settlement"] };
  }
  return input;
}

// These checks grade structured outcomes; human reading separately assesses meaning and unnecessary questions.
export function semanticChecks(sample: SemanticSample, result: InvestigationResult, interpreted: boolean): string[] {
  const failures: string[] = [], v = result.verification;
  const delegated = result.activity.some((a) => a.role === "business_verification" && a.action === "delegated");
  if (!result.review.accepted) failures.push("Review did not accept a useful final result");
  if (result.resolution?.updates.some((u) => u.kind === "payment_recognized")) failures.push("No case supplies authority for recognition");
  if (sample.expected.action === "investigate") {
    if (!delegated || v?.outcome !== "awaiting_business" || !v.businessMessage) failures.push("Expected a targeted business investigation");
    if (v?.claimMessageId !== sample.expected.claimMessageId) failures.push("Original payment claim was not retained");
    if (result.draft.needsOperator || result.resolution?.needsOperator) failures.push("Unnecessary operator escalation");
    if (v && (v.amountCents !== sample.expected.amountCents || v.paymentDate !== sample.expected.paymentDate)) failures.push("Proposed payment terms differ from supported conversation meaning");
    if (interpreted && (result.paymentClaim?.invoice.value !== semanticInput(sample).facts.invoiceId || result.paymentClaim?.amount.value !== sample.expected.amountCents || result.paymentClaim?.date.value !== sample.expected.paymentDate)) failures.push("Grounded interpretation does not preserve supported values and unknowns");
  } else if (sample.expected.action === "do_not_investigate") {
    if (delegated || v) failures.push("A denial, future intention, different invoice or ambiguity triggered business verification");
  } else if (!v || v.outcome !== "needs_facts" || v.amountCents !== null || v.paymentDate !== null || v.settlementStatus !== "unknown") failures.push("A vague business yes invented missing payment terms or did not investigate the reply");
  return failures;
}
