import type { Investigation } from "../../src/lib/v2/contracts";
import type { PaymentClaim } from "../../src/lib/v2/claim";

// Scripted model output for explicit fixture claims; this helper does not interpret language.
export function scriptedClaim(input: Investigation, fields: { claimMessageId?: string; invoice?: string | null; amountCents?: number | null; date?: string | null } = {}): PaymentClaim {
  const customers = input.messages.filter((m) => m.channel === "customer" && m.speaker === "customer");
  const source = customers.find((m) => m.id === fields.claimMessageId) ?? customers[0];
  if (!source) throw new Error("Fixture requires a customer claim");
  const evidence = [{ messageId: source.id, quote: source.text.slice(0, 300) }];
  return { businessId: input.facts.businessId, caseId: input.facts.id, sourceVersion: input.facts.sourceVersion, intent: "payment_claim", claimMessageId: source.id, throughMessageId: customers.at(-1)!.id,
    invoice: { value: fields.invoice === undefined ? input.facts.invoiceId : fields.invoice, evidence },
    amount: { value: fields.amountCents ?? null, evidence: fields.amountCents ? evidence : [] },
    date: { value: fields.date ?? null, evidence: fields.date ? evidence : [] }, uncertainties: [],
  };
}
