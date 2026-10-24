"use client";

import { useState, type FormEvent } from "react";
import type { Activity, InvestigationResult } from "@/lib/v2/contracts";
import { roleNames } from "@/lib/v2/presentation";
import type { CaseState } from "@/lib/v2/store";
import styles from "./workspace.module.css";

export function PausedReplyNotice({ c }: { c: Pick<CaseState, "status" | "stopped" | "takeover" | "reviewHold"> }) {
  return !c.stopped && (c.status === "needs_review" || c.takeover || c.reviewHold) ? <p className={styles.notice}>Automatic replies are paused for operator review. Your messages remain saved. An operator must explicitly resume replies.</p> : null;
}

function Attempt({ result, label }: { result: InvestigationResult; label: string }) {
  return <div className={styles.correctionAttempt}>
    <p><strong>{label} customer {result.review.accepted ? "reply" : "draft (not published)"}:</strong> {result.draft.reply}</p>
    {result.verification && <p><strong>Business findings:</strong> {result.verification.summary}{result.verification.businessMessage ? ` Proposed business message: ${result.verification.businessMessage}` : ""}</p>}
    {result.resolution && <p><strong>Resolution proposal:</strong> {result.resolution.summary}</p>}
    <p><strong>Reviewer:</strong> {result.review.accepted ? "Accepted" : "Blocked"}{result.review.reasons.length ? `: ${result.review.reasons.join("; ")}` : ""}</p>
  </div>;
}

export default function OperatorCorrections({ c, busy, onSave, onRetry }: {
  c: CaseState; busy: boolean;
  onSave: (value: { text: string; targetRole: Activity["role"]; targetAuditId: string; revision: number }) => Promise<boolean>;
  onRetry: (value: { correctionId: string; revision: number }) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [targetRole, setTargetRole] = useState<Activity["role"]>("customer");
  const targetAuditId = c.audit.at(-1)?.id;
  const corrections = c.corrections ?? [], latest = corrections.at(-1);
  const retryable = latest && !latest.runId && latest.revision === c.revision && latest.targetAuditId === targetAuditId;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (targetAuditId && await onSave({ text, targetRole, targetAuditId, revision: c.revision })) setText("");
  }
  return <section className={styles.correctionPanel} aria-labelledby="correction-title">
    <h4 id="correction-title">Correct this case</h4>
    <p className="mt-2 text-sm">Feedback targets the latest reviewed attempt. Saving pauses automatic replies without a model call. Retrying explicitly resumes replies and sends the correction through the agents and Reviewer.</p>
    <p className="mt-2 text-sm text-muted">This is case feedback, not a reusable lesson or payment approval. Existing records are retained. Maximum six saved corrections and six retries per case.</p>
    {!targetAuditId && <p className="mt-2 text-sm">An agent run must reach review before you can correct its result.</p>}
    <form className="mt-3 space-y-2" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium" htmlFor="v2-correction-role">Role to correct</label>
      <select id="v2-correction-role" className="max-w-full rounded-md border border-line bg-white p-2" value={targetRole} disabled={busy || c.stopped || !targetAuditId || corrections.length >= 6} onChange={(event) => setTargetRole(event.target.value as Activity["role"])}>{Object.entries(roleNames).map(([role, name]) => <option key={role} value={role}>{name}</option>)}</select>
      <label className="block text-sm font-medium" htmlFor="v2-correction-text">What should the agent change?</label>
      <textarea id="v2-correction-text" className="min-h-24 w-full rounded-md border border-line bg-white p-3 disabled:opacity-60" maxLength={1200} value={text} onChange={(event) => setText(event.target.value)} required disabled={busy || c.stopped || !targetAuditId || corrections.length >= 6} />
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={busy || c.stopped || !targetAuditId || corrections.length >= 6 || !text.trim()}>Save correction and pause</button>
        <button type="button" className="rounded-md border border-accent-ink bg-accent-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || c.stopped || !retryable || c.retries >= 6} onClick={() => { if (latest) void onRetry({ correctionId: latest.correctionId, revision: c.revision }); }}>Retry with correction and resume</button>
      </div>
    </form>
    {latest && !latest.runId && !retryable && <p className="mt-2 text-sm">The case changed after this correction. Save fresh feedback against the current attempt before retrying.</p>}
    {corrections.length > 0 && <div className="mt-4 space-y-3"><h4>Correction history</h4>{[...corrections].reverse().map((correction) => <details className={styles.technical} key={correction.correctionId}>
      <summary>{roleNames[correction.targetRole]} correction · {correction.outcome ?? (correction.runId ? "running" : "saved, not run")}</summary>
      <p className="mt-2 whitespace-pre-wrap">{correction.text}</p><p className={styles.status}>Saved {new Date(correction.at).toLocaleString()} · original attempt {correction.targetAuditId}</p>
      <Attempt result={correction.original} label="Original" />
      {correction.result && <Attempt result={correction.result} label="Revised" />}
      {!correction.result && correction.runId && correction.outcome && <p className="mt-2 text-sm">No revised reviewed result was committed. Inspect Runtime; save fresh feedback to attempt another correction.</p>}
    </details>)}</div>}
  </section>;
}
