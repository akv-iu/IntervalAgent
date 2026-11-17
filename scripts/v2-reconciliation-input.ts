import { z } from "zod";
import raw from "../fixtures/v2/reconciliation-20261026-1/sam.json";
import { startingCases, openingMessage } from "../src/lib/v2/fixtures";
import type { Investigation } from "../src/lib/v2/contracts";
import type { PaymentClaim } from "../src/lib/v2/claim";

const fixture = z.object({ now: z.string(), snapshotCreatedAt: z.string(), caseId: z.string(), requestId: z.string(), messages: z.array(z.object({ id: z.string(), speaker: z.enum(["customer", "agent", "business"]), channel: z.enum(["customer", "business"]), text: z.string() })) }).parse(raw);
export function samReconciliation(): Investigation {
  const facts = startingCases(new Date(fixture.snapshotCreatedAt)).find((f) => f.id === fixture.caseId)!;
  const messages = [openingMessage(facts, new Date(fixture.snapshotCreatedAt)), ...fixture.messages.map((m) => ({ ...m, at: fixture.now, ...(m.channel === "business" ? { requestId: fixture.requestId } : {}) }))];
  const first = messages[1];
  const paymentClaim: PaymentClaim = { businessId: facts.businessId, caseId: facts.id, sourceVersion: facts.sourceVersion, intent: "payment_claim", claimMessageId: first.id, throughMessageId: first.id,
    invoice: { value: facts.invoiceId, evidence: [{ messageId: messages[0].id, quote: facts.invoiceId }, { messageId: first.id, quote: first.text }] },
    amount: { value: 7900, evidence: [{ messageId: messages[0].id, quote: "$79.00" }, { messageId: first.id, quote: first.text }] }, date: { value: null, evidence: [] }, uncertainties: ["Payment date is unknown"] };
  return { facts, now: fixture.now, requestId: fixture.requestId, messages, paymentClaim, verification: { claimMessageId: first.id, outcome: "business_reported", summary: "Northside Fitness reports $40 paid for invoice INV-102; payment date and settlement are unknown.", amountCents: 4000, paymentDate: null, invoiceId: facts.invoiceId, reference: null, settlementStatus: "unknown", businessMessage: null, missingFacts: ["payment date", "settlement status"] } };
}

