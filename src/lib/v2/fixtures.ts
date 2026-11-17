import type { CaseFacts, Message } from "./contracts";
import { formatCents } from "../money";
import { localDate } from "../time";

export function openingMessage(facts: CaseFacts, at: Date): Message {
  return { id: `opening-${facts.id}`, channel: "customer", speaker: "agent", origin: "synthetic_opening", at: at.toISOString(),
    text: `Hi ${facts.customer}, this is ${facts.businessName}. Our records as of ${localDate(new Date(facts.balanceAsOf), facts.timezone)} show ${formatCents(facts.balanceCents)} for invoice ${facts.invoiceId}. Have you already paid, or would you like to discuss options?` };
}

export function startingCases(at: Date): CaseFacts[] {
  const yesterday = new Date(at.getTime() - 86_400_000).toISOString();
  const snapshotDate = localDate(new Date(yesterday), "America/Denver");
  const common = { businessId: "northside", businessName: "Northside Fitness", balanceCents: 12900, balanceAsOf: yesterday, sourceVersion: "synthetic-v2-2", recognitionPolicy: "business_confirmation" as const, timezone: "America/Denver" as const, phone: "+1 202-555-0101", email: null };
  const northside: CaseFacts[] = [
    { ...common, id: "late-payment", scenario: "late_payment", customer: "Alex", email: "alex@example.test", invoiceId: "INV-101", payments: [], accountNotes: ["The snapshot cannot establish whether a later payment was received."] },
    { ...common, id: "fresh-record", scenario: "partial_payment", customer: "Sam", email: "sam@example.test", invoiceId: "INV-102", balanceCents: 7900,
      payments: [{ id: "receipt-102", invoiceId: "INV-102", amountCents: 5000, date: snapshotDate, status: "settled", includedInBalance: true }], accountNotes: ["The $50 payment is already included in the $79 remaining balance."] },
    { ...common, id: "conflicting-payment", scenario: "conflicting_reference", customer: "Jordan", email: "jordan@example.test", invoiceId: "INV-103", payments: [], accountNotes: ["A $40 pending payment references INV-099; it is not allocated to INV-103."] },
    { ...common, id: "cancellation-overlap", scenario: "cancellation_overlap", customer: "Taylor", email: "taylor@example.test", invoiceId: "INV-104", balanceCents: 8900, payments: [], accountNotes: [`A cancellation request was logged on ${snapshotDate}.`, "The snapshot still contains a renewal invoice; no cancellation credit or effective cancellation date is recorded."] },
    { ...common, id: "affordability", scenario: "affordability", customer: "Morgan", email: "morgan@example.test", invoiceId: "INV-105", balanceCents: 24000, payments: [], accountNotes: ["No payment arrangement or extension has been approved. A request or promise does not change the balance."] },
    { ...common, id: "pending-payment", scenario: "pending_payment", customer: "Casey", email: "casey@example.test", invoiceId: "INV-106", balanceCents: 9900,
      payments: [{ id: "pending-106", invoiceId: "INV-106", amountCents: 9900, date: snapshotDate, status: "pending", includedInBalance: false }], accountNotes: ["The recorded payment is pending. There is no settled receipt or balance reduction."] },
  ];
  const cedar = { businessId: "cedar", businessName: "Cedar Home Services", sourceVersion: "synthetic-v2-cedar-1", recognitionPolicy: "operator_review" as const, timezone: "America/Denver" as const, balanceAsOf: yesterday, phone: "+1 202-555-0102" };
  return [...northside,
    { ...cedar, id: "cedar-late-payment", scenario: "late_payment", customer: "Riley", email: "riley@example.test", invoiceId: "CED-201", balanceCents: 18500, payments: [], accountNotes: ["The snapshot cannot establish whether a later payment was received."] },
    { ...cedar, id: "cedar-fresh-record", scenario: "partial_payment", customer: "Jamie", email: "jamie@example.test", invoiceId: "CED-202", balanceCents: 9500,
      payments: [{ id: "cedar-receipt-202", invoiceId: "CED-202", amountCents: 6000, date: snapshotDate, status: "settled", includedInBalance: true }], accountNotes: ["The $60 payment is already included in the $95 remaining balance."] },
    { ...cedar, id: "cedar-conflicting-payment", scenario: "conflicting_reference", customer: "Drew", email: "drew@example.test", invoiceId: "CED-203", balanceCents: 21000, payments: [], accountNotes: ["A $70 pending payment references CED-199; it is not allocated to CED-203."] },
    { ...cedar, id: "cedar-cancellation-overlap", scenario: "cancellation_overlap", customer: "Avery", email: "avery@example.test", invoiceId: "CED-204", balanceCents: 12500, payments: [], accountNotes: [`An annual service-plan cancellation was requested on ${snapshotDate}.`, "The renewal invoice remains in the snapshot; no approved credit or effective cancellation date is recorded."] },
    { ...cedar, id: "cedar-affordability", scenario: "affordability", customer: "Robin", email: "robin@example.test", invoiceId: "CED-205", balanceCents: 42000, payments: [], accountNotes: ["No payment arrangement or extension has been approved. A request or promise does not change the balance."] },
    { ...cedar, id: "cedar-pending-payment", scenario: "pending_payment", customer: "Quinn", email: "quinn@example.test", invoiceId: "CED-206", balanceCents: 16000,
      payments: [{ id: "cedar-pending-206", invoiceId: "CED-206", amountCents: 16000, date: snapshotDate, status: "pending", includedInBalance: false }], accountNotes: ["The recorded payment is pending. There is no settled receipt or balance reduction."] },
  ];
}
