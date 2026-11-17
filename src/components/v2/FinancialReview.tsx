"use client";

import { useState, type FormEvent } from "react";
import { formatCents } from "@/lib/format";
import { recognitionCandidate, type FinancialRequest } from "@/lib/v2/financial";
import type { CaseState } from "@/lib/v2/store";

export default function FinancialReview({ c, busy, now, onDecide }: { c: CaseState; busy: boolean; now: string; onDecide: (value: FinancialRequest) => Promise<boolean> }) {
  const [note, setNote] = useState(""), [reference, setReference] = useState("");
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("succeeded");
  const decisions = c.financialDecisions ?? [];
  const audit = c.audit.at(-1);
  const pending = c.operations?.find((op) => ["pending", "unknown"].includes(op.outcome) && !decisions.some((d) => d.kind === "payment_reconciled" && d.targetId === op.id));
  let candidate: ReturnType<typeof recognitionCandidate> | undefined, reason = "";
  try { candidate = recognitionCandidate({ ...c, now }, c.lastReview); } catch (error) { reason = error instanceof Error ? error.message : "Review the current payment evidence first."; }
  if (candidate && (!audit || audit.sourceVersion !== c.facts.sourceVersion || c.messages.filter((m) => m.speaker !== "agent").at(-1)?.id !== audit.sourceMessageIds.at(-1))) { candidate = undefined; reason = "Review newer messages or financial changes before approving this payment."; }
  if (!pending && !candidate && !decisions.length && c.verification?.outcome !== "business_confirmed") return null;
  const blocked = busy || !!c.run || c.stopped || !c.takeover || decisions.length >= 12;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const evidence = { revision: c.revision, note, evidenceReference: reference };
    const value: FinancialRequest | undefined = pending ? { action: "reconcile_payment", operationId: pending.id, outcome, ...evidence } : candidate && audit ? { action: "approve_recognition", targetAuditId: audit.id, ...evidence } : undefined;
    if (value && await onDecide(value)) { setNote(""); setReference(""); }
  }
  return <section className="mt-4 border-t border-line pt-4" aria-label="Operator financial decision">
    <h4 className="font-medium">Operator financial decision</h4>
    <p className="mt-2 text-sm">You are playing the operator in this private simulation. Take over, inspect the evidence, and record your decision. This does not verify a bank, move money or send a reply. Original records remain in history.</p>
    {pending ? <p className="mt-2 text-sm">Attempt {pending.id}: {pending.outcome}, {formatCents(pending.amountCents)} for {pending.invoiceId}. Reconciliation records the outcome of this attempt; it does not initiate another payment.</p> : candidate ? <p className="mt-2 text-sm">Business-confirmed payment: {formatCents(candidate.amountCents)} on {candidate.date}, {candidate.invoiceId}. Approval records this existing payment once.</p> : <p className="mt-2 text-sm">{decisions.length ? "Saved decisions are retained below. No eligible financial action is currently available." : reason}</p>}
    {(pending || candidate) && <form className="mt-3 space-y-2" onSubmit={(event) => void submit(event)}>
      {pending && <label className="block text-sm">Verified simulated outcome<select className="ml-2 max-w-full rounded-md border border-line p-2" value={outcome} disabled={blocked} onChange={(event) => setOutcome(event.target.value as "succeeded" | "failed")}><option value="succeeded">Settled — record receipt</option><option value="failed">Not settled — no receipt</option></select></label>}
      <label className="block text-sm">Evidence reference<input className="mt-1 block w-full rounded-md border border-line p-2" required maxLength={80} disabled={blocked} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label className="block text-sm">What did you verify?<textarea className="mt-1 block min-h-24 w-full rounded-md border border-line p-2" required minLength={10} maxLength={1200} disabled={blocked} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <p className="text-sm text-muted">Use synthetic evidence only. A note alone is not processor confirmation. Saving retains operator control; resume and explicitly retry for a reviewed agent explanation.</p>
      <button className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={blocked || !reference.trim() || note.trim().length < 10}>{pending ? "Save reconciliation" : "Approve existing payment"}</button>
    </form>}
    {!c.takeover && (pending || candidate) && <p className="mt-2 text-sm">Take over this case before saving a financial decision.</p>}
    {decisions.map((decision) => <details className="mt-3 text-sm" key={decision.id}><summary>Operator decision · {decision.kind.replaceAll("_", " ")} · {decision.outcome}</summary><p>{decision.note}</p><p>Evidence: {decision.evidenceReference}. Target: {decision.targetId}. Saved {new Date(decision.at).toLocaleString()}.</p><p>Balance: {formatCents(decision.balanceBeforeCents)} → {formatCents(decision.balanceAfterCents)}. {decision.receiptId ? `Receipt: ${decision.receiptId}.` : "No payment receipt created."}{decision.extensionDate ? ` Extension approved through ${decision.extensionDate}; agreed installments were not rescheduled.` : ""}</p></details>)}
  </section>;
}
