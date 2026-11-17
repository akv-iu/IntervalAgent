import { samReconciliation } from "../../scripts/v2-reconciliation-input";
export { samReconciliation };
export function agreedSamClaim(input = samReconciliation()) {
  const claim = structuredClone(input.paymentClaim!);
  claim.throughMessageId = input.messages.findLast((m) => m.speaker === "customer")!.id;
  claim.invoice.evidence = [{ messageId: input.messages.at(-2)!.id, quote: "invoice INV-102" }, { messageId: claim.throughMessageId, quote: "that is correct" }];
  claim.amount = { value: 4000, evidence: [{ messageId: claim.throughMessageId, quote: "i have paid 40 only" }] };
  return { ...claim, reportResponse: { stance: "agrees" as const, businessMessageId: input.messages.findLast((m) => m.speaker === "business")!.id } };
}
