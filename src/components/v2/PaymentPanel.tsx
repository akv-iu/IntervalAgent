"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";
import { proposalIsCurrent, sameProposal, type PaymentProposal } from "@/lib/v2/options";
import { nextPayment, paymentHold, type SimulationOutcome } from "@/lib/v2/payments";
import type { CaseState } from "@/lib/v2/store";

const button = "rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50";

export default function PaymentPanel({ c, busy, onConfirm, onPay, now = c.now }: { c: CaseState; busy: boolean; onConfirm: (proposal: PaymentProposal) => void; onPay: (agreementId: string, outcome: SimulationOutcome) => void; now?: string }) {
  const [outcome, setOutcome] = useState<SimulationOutcome>("succeeded");
  const proposal = c.updates.filter((u) => u.kind === "payment_proposed").at(-1), agreement = c.agreements?.at(-1);
  const confirmed = proposal && c.agreements?.some((a) => sameProposal(a.proposal, proposal));
  const hold = paymentHold(c.facts, c.operations, c.verification, c.requestId);
  const blocked = busy || !!c.run || c.stopped || c.takeover || !!c.reviewHold || c.status === "needs_review" || !!hold;
  let due: ReturnType<typeof nextPayment> | undefined, reason = "";
  if (agreement) { try { due = nextPayment(agreement, c.facts, c.operations ?? [], now); } catch (error) { reason = error instanceof Error ? error.message : "Inspect this plan before attempting a payment."; } }
  if (!proposal && !agreement) return null;
  return <section className="mt-4 border-t border-line pt-4" aria-label="Simulated plan and payment">
    <h4 className="font-medium">Simulated plan and payment</h4>
    <p className="mt-2 text-sm text-muted">Confirm the exact offer below, then simulate a due payment separately. No real money moves. Chat acceptance alone does neither. Future dates do not extend workspace expiry.</p>
    {hold && <p className="mt-2 text-sm">{hold}</p>}
    {proposal && !confirmed && <div className="mt-3 text-sm">
      <p>{proposal.invoiceId} · {proposal.method.replaceAll("_", " ")} · {formatCents(proposal.balanceCents)} total, no added fees or interest.</p>
      <ol className="ml-4 list-decimal">{proposal.schedule.map((part) => <li key={part.date}>{formatCents(part.amountCents)} on {part.date}</li>)}</ol>
      {!proposalIsCurrent(proposal, c.facts, now) && <p>Offer outdated. Ask for a fresh reviewed proposal.</p>}
      <button className={`${button} mt-2`} disabled={blocked || !proposalIsCurrent(proposal, c.facts, now)} onClick={() => onConfirm(proposal)}>Confirm this simulated plan</button>
    </div>}
    {agreement && <div className="mt-3 text-sm">
      <p>Confirmed simulated plan: {agreement.proposal.method.replaceAll("_", " ")}, {agreement.proposal.schedule.length} payment(s). Confirmation alone received no money.</p>
      {reason && reason !== hold && <p className="mt-2">{reason}</p>}
      {due && <>
        <p className="mt-2">Next installment: {formatCents(due.amountCents)}, due {due.date}. No later installment will execute automatically.</p>
        <label className="mt-2 block">Demo processor outcome
          <select className="ml-2 max-w-full rounded-md border border-line p-2" value={outcome} disabled={blocked} onChange={(event) => setOutcome(event.target.value as SimulationOutcome)}>
            <option value="succeeded">Success</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="unknown">Unknown</option>
          </select>
        </label>
        <p className="mt-1 text-muted">This test control selects the simulated processor response. It is not bank evidence.</p>
        <button className={`${button} mt-2`} disabled={blocked} onClick={() => onPay(agreement.id, outcome)}>Simulate due payment of {formatCents(due.amountCents)}</button>
      </>}
    </div>}
  </section>;
}
