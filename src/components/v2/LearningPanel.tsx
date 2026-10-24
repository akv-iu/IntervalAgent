"use client";

import { useState } from "react";
import { roleNames } from "@/lib/v2/presentation";
import { EVALUATION_VERSION, type LearningState, type LearningCommand } from "@/lib/v2/learning";
import type { Activity } from "@/lib/v2/contracts";
import type { CaseState } from "@/lib/v2/store";

type LearningRequest<T = LearningCommand> = T extends unknown ? Omit<T, "id" | "caseId"> : never;
export default function LearningPanel({ c, state, busy, seconds, onAction }: { c: CaseState; state?: LearningState; busy: boolean; seconds: number; onAction: (value: LearningRequest) => Promise<boolean> }) {
  const correction = c.corrections?.at(-1), audit = c.audit.at(-1);
  const [role, setRole] = useState<Activity["role"]>(correction?.targetRole ?? "customer"), [scope, setScope] = useState<"scenario" | "business">("scenario"), [note, setNote] = useState("");
  const candidates = state?.candidates.filter((candidate) => candidate.scope.businessId === c.facts.businessId) ?? [];
  const history = state?.history.filter((entry) => candidates.some((candidate) => candidate.id === entry.candidateId)) ?? [];
  const pending = state?.candidates.some((candidate) => ["proposing", "evaluating"].includes(candidate.status));
  const blocked = busy || !!pending;
  const callsExhausted = (state?.calls ?? 0) >= 64;
  const source = correction?.targetRole === role ? { targetAuditId: correction.targetAuditId, correctionId: correction.correctionId } : audit && !audit.review.accepted ? { targetAuditId: audit.id } : null;
  async function decide(action: "activate_lesson" | "reject_lesson" | "rollback_lesson", candidateId: string) {
    if (state && await onAction({ action, learningRevision: state.revision, candidateId, note })) setNote("");
  }
  return <section className="mt-6 border-t border-line pt-4" aria-label="Evaluated agent learning">
    <h4 className="font-medium">Evaluated agent learning</h4>
    <p className="mt-2 text-sm">Case corrections affect this case. A reusable lesson must be proposed from saved feedback or a rejected review, compared against the current version, then explicitly activated. Changes stay in this private workspace and business. Model weights do not change.</p>
    <p className="mt-2 text-sm text-muted">Proposal/comparison uses your configured paid API. Limit: 8 candidates and 64 learning model calls per workspace; comparison is bounded to 32 calls. Calls/failures retain usage accounting. No automatic shared promotion.</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <label className="text-sm">Learning role<select className="ml-2 max-w-full rounded-md border border-line p-2" disabled={blocked || c.stopped} value={role} onChange={(event) => setRole(event.target.value as Activity["role"])}>{Object.entries(roleNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="text-sm">Lesson scope<select className="ml-2 max-w-full rounded-md border border-line p-2" disabled={blocked} value={scope} onChange={(event) => setScope(event.target.value as "scenario" | "business")}><option value="scenario">This business and scenario family</option><option value="business">This business, all scenario families</option></select></label>
      <button className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50" disabled={blocked || callsExhausted || c.stopped || !!c.run || !source || (state?.candidates.length ?? 0) >= 8} onClick={() => { if (source) void onAction({ action: "propose_lesson", revision: c.revision, targetRole: role, scope, ...source }); }}>Propose reusable lesson</button>
    </div>
    {!source && <p className="mt-2 text-sm">Save a correction for this role, or select a role with a rejected review, before proposing a lesson.</p>}
    {(busy || pending) && <p className="mt-2 text-sm" role="status">Learning work is running · {seconds}s. Customer dialogue and financial actions are separate. Refresh restores saved progress.</p>}
    <p className="mt-2 text-sm">Learning calls reserved: {state?.calls ?? 0}/64. Active versions: {state?.active.filter((a) => a.scope.businessId === c.facts.businessId).map((a) => `${roleNames[a.scope.role]} ${a.candidateId.slice(0, 8)}`).join(", ") || "base instructions"}.</p>
    <label className="mt-3 block text-sm">Activation/rejection/rollback assessment<textarea className="mt-1 block min-h-24 w-full rounded-md border border-line p-2" value={note} maxLength={1200} minLength={10} disabled={blocked} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="mt-3 space-y-3">{candidates.map((candidate) => <details className="rounded-md border border-line p-3 text-sm" key={candidate.id}>
      <summary>{roleNames[candidate.scope.role]} · {candidate.scope.scenario ?? "business-wide"} · {candidate.status} · {candidate.id.slice(0, 8)}</summary>
      <p className="mt-2">Source case {candidate.sourceCaseId}, review {candidate.sourceAuditId}. Base {candidate.baseVersion}; prior lesson {candidate.baseCandidateId ?? "none"}.</p>
      {candidate.proposal && <><p className="mt-2">Diagnosis: {candidate.proposal.diagnosis} · {candidate.proposal.focus}. {candidate.proposal.rationale}</p><p className="mt-2 whitespace-pre-wrap">{candidate.proposal.instruction ?? "No reusable instruction proposed."}</p></>}
      {candidate.error && <p className="mt-2">{candidate.error}</p>}
      {!!candidate.evaluationHistory?.length && <details className="mt-2"><summary>Earlier comparison reports</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words" tabIndex={0}>{JSON.stringify(candidate.evaluationHistory, null, 2)}</pre></details>}
      {candidate.evaluation && <div className="mt-2"><p>{candidate.evaluation.provenance} comparison · {candidate.evaluation.version} · {candidate.evaluation.calls} calls. Baseline {candidate.evaluation.rows.filter((r) => r.baselinePassed).length}/{candidate.evaluation.rows.length}; candidate {candidate.evaluation.rows.filter((r) => r.candidatePassed).length}/{candidate.evaluation.rows.length}.</p><p>{candidate.evaluation.reason}</p><ul className="mt-2 list-inside list-disc">{candidate.evaluation.rows.map((row) => <li key={row.id}>{row.id} ({row.category}): baseline {row.baselinePassed ? "pass" : "fail"}, candidate {row.candidatePassed ? "pass" : "fail"}{row.error ? ` · ${row.error}` : ""}</li>)}</ul><details className="mt-2"><summary>Comparison evidence</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words" tabIndex={0}>{JSON.stringify(candidate.evaluation.rows, null, 2)}</pre></details></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-md border border-line px-3 py-2 disabled:opacity-50" disabled={blocked || callsExhausted || !(candidate.status === "ready" || candidate.status === "evaluated" && candidate.evaluation?.version !== EVALUATION_VERSION)} onClick={() => { if (state) void onAction({ action: "evaluate_lesson", learningRevision: state.revision, candidateId: candidate.id }); }}>Compare with baseline</button>
        <button className="rounded-md border border-line px-3 py-2 disabled:opacity-50" disabled={blocked || candidate.status !== "evaluated" || !candidate.evaluation?.eligible || candidate.evaluation.version !== EVALUATION_VERSION || candidate.evaluation.provenance !== "live" || note.trim().length < 10} onClick={() => void decide("activate_lesson", candidate.id)}>Activate evaluated lesson</button>
        <button className="rounded-md border border-line px-3 py-2 disabled:opacity-50" disabled={blocked || candidate.status === "active" || candidate.status === "rejected" || note.trim().length < 10} onClick={() => void decide("reject_lesson", candidate.id)}>Reject candidate</button>
        <button className="rounded-md border border-line px-3 py-2 disabled:opacity-50" disabled={blocked || candidate.status !== "active" || note.trim().length < 10} onClick={() => void decide("rollback_lesson", candidate.id)}>Roll back this version</button>
      </div>
    </details>)}</div>
    {!!history.length && <details className="mt-3 text-sm"><summary>Activation and rejection history</summary><ul className="mt-2 space-y-2">{history.map((h) => <li key={h.id}>{h.action.replaceAll("_", " ")} · {h.candidateId.slice(0, 8)} · {new Date(h.at).toLocaleString()}: {h.note}. Before {h.before ?? "base"}; after {h.after ?? "base"}.</li>)}</ul></details>}
  </section>;
}
