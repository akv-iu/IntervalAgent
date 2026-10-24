"use client";

import { useState, type FormEvent } from "react";
import { formatCents } from "@/lib/format";
import type { FinancialRequest } from "@/lib/v2/financial";
import type { CaseState } from "@/lib/v2/store";

export default function FinancialAdjustments({ c, busy, onDecide }: { c: CaseState; busy: boolean; onDecide: (value: FinancialRequest) => Promise<boolean> }) {
  const [action, setAction] = useState("approve_credit"), [target, setTarget] = useState(""), [amount, setAmount] = useState("");
  const [note, setNote] = useState(""), [reference, setReference] = useState(""), [outcome, setOutcome] = useState<"succeeded" | "failed">("succeeded");
  const receipts = c.facts.payments.filter((p) => p.provenance && p.status === "settled" && !p.reversedBy && p.invoiceId === c.facts.invoiceId);
  const pending = c.facts.payments.filter((p) => p.status === "pending" && !p.includedInBalance && !p.reconciledBy && p.invoiceId === c.facts.invoiceId);
  const extension = c.updates.findLast((u) => u.kind === "extension_requested");
  const audit = c.audit.at(-1), currentReview = !!c.lastReview?.review.accepted && audit?.sourceVersion === c.facts.sourceVersion && audit?.sourceMessageIds.at(-1) === c.messages.filter((m) => m.speaker !== "agent").at(-1)?.id;
  const selected = (action === "reverse_receipt" ? receipts : pending).find((p) => p.id === target);
  const validCredit = /^\d+(?:\.\d{1,2})?$/.test(amount) && Math.round(Number(amount) * 100) > 0 && Math.round(Number(amount) * 100) <= c.facts.balanceCents;
  const eligible = action === "approve_credit" ? currentReview && validCredit : action === "approve_extension" ? !!extension : !!selected;
  const blocked = busy || !!c.run || c.stopped || !c.takeover || (c.financialDecisions?.length ?? 0) >= 12;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const evidence = { revision: c.revision, note, evidenceReference: reference };
    const value: FinancialRequest | undefined = action === "approve_credit" && audit ? { ...evidence, action, targetAuditId: audit.id, amountCents: Math.round(Number(amount) * 100) }
      : action === "approve_extension" && extension ? { ...evidence, action, sourceMessageId: extension.sourceMessageId }
      : action === "reverse_receipt" && selected ? { ...evidence, action, receiptId: selected.id }
      : action === "reconcile_record" && selected ? { ...evidence, action, paymentId: selected.id, outcome } : undefined;
    if (value && await onDecide(value)) { setNote(""); setReference(""); setTarget(""); setAmount(""); }
  }
  return <details className="mt-4 border-t border-line pt-4"><summary>Financial corrections and exceptions</summary>
    <p className="mt-2 text-sm">Takeover-only synthetic ledger decisions. A credit reduces debt without collecting money. Reversing a local receipt restores that amount; it does not issue a refund. Existing payment plans become stale after balance corrections.</p>
    <form className="mt-3 space-y-2" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm">Decision<select className="ml-2 max-w-full rounded-md border border-line p-2" disabled={blocked} value={action} onChange={(event) => { setAction(event.target.value); setTarget(""); }}><option value="approve_credit">Approve a credit</option><option value="approve_extension">Approve latest extension request</option><option value="reverse_receipt">Reverse a local receipt</option><option value="reconcile_record">Reconcile a pending source payment</option></select></label>
      {action === "approve_credit" ? <><label className="block text-sm">Credit amount (dollars)<input className="ml-2 max-w-full rounded-md border border-line p-2" inputMode="decimal" value={amount} disabled={blocked} required onChange={(event) => setAmount(event.target.value)} /></label>{!currentReview && <p className="text-sm">The latest case evidence must have an accepted review before a credit.</p>}</> : action === "approve_extension" ? <p className="text-sm">{extension && extension.kind === "extension_requested" ? `Latest request: ${extension.date}. Approval does not change an agreed installment schedule.` : "No extension request is saved."}</p> : <label className="block text-sm">Payment evidence<select className="ml-2 max-w-full rounded-md border border-line p-2" value={target} disabled={blocked} required onChange={(event) => setTarget(event.target.value)}><option value="">Choose a saved record</option>{(action === "reverse_receipt" ? receipts : pending).map((p) => <option key={p.id} value={p.id}>{p.id} · {formatCents(p.amountCents)}</option>)}</select></label>}
      {action === "reconcile_record" && <label className="block text-sm">Source payment outcome<select className="ml-2 max-w-full rounded-md border border-line p-2" value={outcome} disabled={blocked} onChange={(event) => setOutcome(event.target.value as "succeeded" | "failed")}><option value="succeeded">Settled — record receipt</option><option value="failed">Not settled — no receipt</option></select></label>}
      <label className="block text-sm">Correction evidence reference<input className="mt-1 block w-full rounded-md border border-line p-2" required maxLength={80} disabled={blocked} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label className="block text-sm">Decision reason<textarea className="mt-1 block min-h-24 w-full rounded-md border border-line p-2" required minLength={10} maxLength={1200} disabled={blocked} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={blocked || !eligible || note.trim().length < 10 || !reference.trim()}>Save financial correction</button>
    </form>
  </details>;
}
