import type { CaseFacts, Message } from "./contracts";
import { formatCents } from "../money";
import { localDate } from "../time";

export function openingMessage(facts: CaseFacts, at: Date): Message {
  return { id: `opening-${facts.id}`, channel: "customer", speaker: "agent", origin: "synthetic_opening", at: at.toISOString(),
    text: `Hi ${facts.customer}, this is ${facts.businessName}. Our records as of ${localDate(new Date(facts.balanceAsOf), facts.timezone)} show ${formatCents(facts.balanceCents)} for invoice ${facts.invoiceId}. Have you already paid, or would you like to discuss options?` };
}

export function startingCases(at: Date): CaseFacts[] {
  const yesterday = new Date(at.getTime() - 86_400_000).toISOString();
  const common = { businessId: "northside", businessName: "Northside Fitness", balanceCents: 12900, balanceAsOf: yesterday, sourceVersion: "synthetic-v2-1", recognitionPolicy: "business_confirmation" as const, timezone: "America/Denver" as const, phone: "+1 202-555-0101", email: null };
  return [
    { ...common, id: "late-payment", customer: "Alex", email: "alex@example.test", invoiceId: "INV-101", payments: [] },
    { ...common, id: "fresh-record", customer: "Sam", email: "sam@example.test", invoiceId: "INV-102", balanceCents: 7900,
      payments: [{ id: "receipt-102", invoiceId: "INV-102", amountCents: 5000, date: yesterday.slice(0, 10), status: "settled", includedInBalance: true }] },
    { ...common, id: "conflicting-payment", customer: "Jordan", email: "jordan@example.test", invoiceId: "INV-103", payments: [] },
  ];
}
