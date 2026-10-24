import { z } from "zod";
import { installmentsN } from "../money";
import { localDate } from "../time";
import type { CaseFacts } from "./contracts";

export const PaymentMethod = z.enum(["card", "bank_transfer", "cash"]);
export const ProposalTerms = z.object({ method: PaymentMethod, count: z.number().int().min(1).max(6), firstDate: z.iso.date(), sourceMessageId: z.string().min(1).max(100) }).strict();
export const PaymentProposal = ProposalTerms.extend({
  kind: z.literal("payment_proposed"), policyVersion: z.string().min(1).max(80), sourceVersion: z.string().min(1).max(1024), invoiceId: z.string().min(1).max(100),
  balanceCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  schedule: z.array(z.object({ date: z.iso.date(), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).min(1).max(6),
}).strict();
export type PaymentProposal = z.infer<typeof PaymentProposal>;

const policies: Record<string, { version: string; methods: z.infer<typeof PaymentMethod>[]; counts: number[]; startWithinDays: number }> = {
  northside: { version: "northside-options-1", methods: ["card", "bank_transfer", "cash"], counts: [1, 2, 3], startWithinDays: 30 },
  cedar: { version: "cedar-options-1", methods: ["card", "bank_transfer"], counts: [1, 2, 3, 4, 6], startWithinDays: 45 },
};

export function paymentOptions(facts: CaseFacts) {
  const policy = Object.hasOwn(policies, facts.businessId) ? policies[facts.businessId] : undefined;
  if (!policy) return { status: "unavailable" as const, businessId: facts.businessId };
  return { status: "available" as const, businessId: facts.businessId, ...structuredClone(policy), currency: "USD", cadence: "monthly", addedFeesCents: 0, interestCents: 0, executionEnabled: false, agreementEnabled: false };
}

// shortcut: full-balance monthly offers only; add allocation/cadence rules when partial or custom offers are supported.
export function calculateProposal(facts: CaseFacts, now: string, value: z.infer<typeof ProposalTerms>): PaymentProposal {
  const terms = ProposalTerms.parse(value), options = paymentOptions(facts);
  if (options.status !== "available") throw new Error("Payment options are unavailable for this business; operator review is required.");
  if (!Number.isSafeInteger(facts.balanceCents) || facts.balanceCents <= 0 || terms.count > facts.balanceCents) throw new Error("A proposal requires a positive safe balance and installments of at least one cent.");
  if (!options.methods.includes(terms.method) || !options.counts.includes(terms.count)) throw new Error("Requested method or installment count is outside this business policy. Clarify or request operator review.");
  const clock = new Date(now);
  if (!Number.isFinite(clock.getTime())) throw new Error("Invalid proposal clock");
  if (terms.firstDate < localDate(clock, facts.timezone) || terms.firstDate > localDate(clock, facts.timezone, options.startWithinDays)) throw new Error("First payment date is outside this business policy. Clarify or request operator review.");
  const [year, month, day] = terms.firstDate.split("-").map(Number);
  const schedule = installmentsN(facts.balanceCents, terms.count).map((amountCents, index) => {
    const date = new Date(`${terms.firstDate}T00:00:00Z`);
    date.setUTCFullYear(year, month - 1 + index, 1);
    const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, end.getUTCDate()));
    return { date: date.toISOString().slice(0, 10), amountCents };
  });
  return PaymentProposal.parse({ kind: "payment_proposed", ...terms, policyVersion: options.version, sourceVersion: facts.sourceVersion, invoiceId: facts.invoiceId, balanceCents: facts.balanceCents, schedule });
}

export function proposalIsCurrent(proposal: PaymentProposal, facts: CaseFacts, now: string): boolean {
  try { return JSON.stringify(PaymentProposal.parse(proposal)) === JSON.stringify(calculateProposal(facts, now, proposalTerms(proposal))); }
  catch { return false; }
}

function proposalTerms(proposal: PaymentProposal): z.infer<typeof ProposalTerms> {
  return { method: proposal.method, count: proposal.count, firstDate: proposal.firstDate, sourceMessageId: proposal.sourceMessageId };
}
