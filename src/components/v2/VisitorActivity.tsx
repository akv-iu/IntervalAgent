"use client";

import { useEffect, useState } from "react";
import type { ActivitySnapshot } from "@/lib/v2/activity";
import type { CaseRecord } from "@/lib/v2/state";
import { formatCents } from "@/lib/money";
import { loadVisitorActivity, VisitorRequestError, type VisitorSession } from "@/lib/v2/visitor-client";

const roles = { customer: "Customer Agent", coordinator: "Coordinator Agent", investigator: "Investigator Agent", reviewer: "Reviewer Agent" };
const tools = { invoice_details: "Invoice details", payment_search: "Payment search", account_history: "Account history", adjustment_history: "Adjustment history", policy_lookup: "Policy lookup" };
const outcomes = { pending: "Pending", found: "Records found", not_found: "No matching records", unavailable: "Records unavailable" };
const decisions = { approve: "Draft accepted for human review", revise: "Revision requested", escalate: "Escalated for human investigation" };
const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-60";

export function ActivityPanel({ snapshot }: { snapshot: ActivitySnapshot }) {
  const { execution, proposal } = snapshot;
  const events = [
    ...snapshot.messages.map((message) => ({ id: `message-${message.ordinal}`, at: message.createdAt, title: `Step ${message.ordinal}: ${roles[message.sender]} to ${roles[message.recipient]}`, summary: message.summary, decision: message.decision, refs: message.evidenceRefs, parent: message.parentOrdinal })),
    ...snapshot.tools.map((tool) => ({ id: `tool-${tool.ordinal}`, at: tool.createdAt, title: `${tools[tool.name]}: ${outcomes[tool.status]}`, summary: "Scoped record lookup by Investigator Agent.", decision: null, refs: tool.evidenceRefs, parent: null })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const state = !execution ? "No investigation has been requested."
    : execution.state === "queued" ? execution.attempts ? "Investigation waiting for another attempt." : "Investigation queued. A worker has not claimed it."
    : execution.state === "running" ? execution.leaseActive ? "Worker lease active. Saved checkpoints appear below." : "Worker lease expired. Waiting for recovery."
    : execution.state === "succeeded" ? "Investigation finished. This does not confirm a financial change."
    : execution.state === "cancelled" ? "Investigation cancelled."
    : "Investigation stopped after a failure or resource limit. Operator review is required.";
  return <div className="min-w-0 space-y-6 wrap-anywhere">
    <p className="text-sm text-ink-2">{state}</p>
    {execution && <div className="space-y-2 text-sm">
      <p>{execution.mode === "mock" ? "Mock workflow using synthetic records. No model was called."
        : execution.mode === "model_test" ? "Model-test workflow. Reported usage is test-workflow evidence, not verified live-model evidence."
        : "Workflow provenance is not available yet."}</p>
      <p className="text-muted">Investigation for message revision {execution.caseRevision}. {execution.version && `Recipe: ${execution.version}. `}{execution.policyVersion && `Policy version: ${execution.policyVersion}.`}</p>
      {execution.guardDecision && <p>Application guard: {decisions[execution.guardDecision]}. This is a code check, not another agent.</p>}
      {execution.usage && <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-accent-ink underline">Resource use</summary>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-l border-line py-2 pl-4">
          <dt>Model requests</dt><dd>{execution.usage.modelRequests}</dd><dt>Tool calls</dt><dd>{execution.usage.toolCalls}</dd>
          <dt>Reported input tokens</dt><dd>{execution.usage.observedInputTokens}</dd><dt>Reported output tokens</dt><dd>{execution.usage.observedOutputTokens}</dd>
          <dt>Model attempts without known usage</dt><dd>{execution.usage.unknownModelAttempts}</dd><dt>Capacity held for unknown or pending usage</dt><dd>{execution.usage.heldTokens}</dd>
          <dt>Charged token budget</dt><dd>{execution.usage.chargedTokens}</dd>
        </dl>
        <p className="mt-2 text-muted">Reported totals cover known usage only. Held capacity and charged budget are not measured token consumption or a currency charge.</p>
      </details>}
    </div>}
    <section aria-labelledby="pending-proposal" className="border-y border-line py-5">
      <h3 id="pending-proposal" className="text-lg font-semibold">Pending proposal</h3>
      {proposal ? <div className="mt-3 space-y-3">
        <p className="font-medium">Proposed remaining balance: {formatCents(proposal.projectedBalanceCents)}</p>
        <ul className="list-disc space-y-2 pl-5">{proposal.actions.map((action, index) => <li key={index}>
          {action.type === "allocate_payment" ? `Allocate ${formatCents(action.amountCents)} from payment ${action.paymentId} to invoice ${action.invoiceId}.`
            : `Credit ${formatCents(action.amountCents)} to invoice ${action.invoiceId} for cancellation ${action.cancellationId}.`}
        </li>)}</ul>
        <p className="text-sm text-ink-2">Human approval required. These changes have not been applied. No draft has been sent as a customer reply.</p>
      </div> : <p className="mt-3 text-sm text-muted">No current, completed proposal is ready for human review. Saved drafts in the activity below are internal.</p>}
    </section>
    <div>
      <p role="status" className="mb-3 text-sm text-muted">{snapshot.messages.length} saved agent steps and {snapshot.tools.length} tool attempts.</p>
      {events.length ? <ol className="divide-y divide-line border-y border-line">{events.map((event) => <li key={event.id} className="space-y-2 py-4">
        <p className="font-medium">{event.title}</p>
        <p className="max-w-prose text-sm">{event.summary}</p>
        {event.decision && <p className="text-sm font-medium">{decisions[event.decision]}</p>}
        <p className="text-xs text-muted"><time dateTime={event.at}>{event.at.slice(11, 19)} UTC</time>{event.parent !== null && `; reply to agent step ${event.parent}`}</p>
        {!!event.refs.length && <p className="text-xs text-muted">Evidence: {event.refs.map((ref) => `${ref.recordType} ${ref.recordId} (v${ref.version})`).join(", ")}</p>}
      </li>)}</ol> : <p className="text-sm text-muted">No saved agent activity yet. This view does not start a worker.</p>}
    </div>
    <section aria-labelledby="case-evidence">
      <h3 id="case-evidence" className="text-lg font-semibold">Evidence used</h3>
      <p className="my-3 text-sm text-muted">Synthetic records cited by this investigation. Open a record to inspect its saved version.</p>
      {!snapshot.evidence.length && <p className="text-sm text-muted">No evidence references have been saved yet.</p>}
      {snapshot.evidence.map((item) => <details key={`${item.recordType}/${item.recordId}/${item.version}`} className="border-b border-line py-1">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">{item.recordType}: {item.recordId}, version {item.version}{item.status === "missing" && " (unavailable)"}</summary>
        {item.status === "missing" ? <p className="pb-3 text-sm">The cited version cannot be resolved from this case. Its contents are unavailable.</p>
          : <dl className="grid gap-2 pb-4 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">{item.fields.map((field) => <div key={field.label} className="contents"><dt className="text-muted">{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
      </details>)}
      {snapshot.evidenceTruncated && <p className="mt-3 text-sm">Showing the first 200 cited records. Additional references remain in the activity.</p>}
    </section>
  </div>;
}

export default function VisitorActivity({ session, record, retryAt, onAccessError, onCaseChange }: { session: VisitorSession; record: CaseRecord; retryAt: number; onAccessError: (error: VisitorRequestError) => void; onCaseChange: (record: CaseRecord) => void }) {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [error, setError] = useState<VisitorRequestError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let delay = 5000;
    const tick = async () => {
      if (controller.signal.aborted) return;
      if (!document.hidden && Date.now() >= retryAt) {
        try {
          const result = await loadVisitorActivity(session, record.caseId, controller.signal);
          if (controller.signal.aborted) return;
          onCaseChange(result.case); setSnapshot(result); setError(null); delay = 5000;
        } catch (reason) {
          if (controller.signal.aborted) return;
          const failure = reason instanceof VisitorRequestError ? reason : new VisitorRequestError(0);
          setError(failure);
          if (failure.status === 401 || failure.status === 429) onAccessError(failure);
          delay = Math.max(Math.min(delay * 2, 60_000), failure.retryAt - Date.now());
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, Math.max(delay, retryAt - Date.now()));
    };
    void tick();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, record.caseId, retryAt, onAccessError, onCaseChange, refreshKey]);
  const current = snapshot && snapshot.case.revision >= record.revision ? snapshot : null;
  return <section aria-labelledby="agent-activity" className="min-w-0 space-y-4 border-t border-line pt-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="agent-activity" className="text-xl font-semibold">Agent activity</h2>
      <button type="button" className={button} disabled={!!retryAt} onClick={() => setRefreshKey((key) => key + 1)}>Refresh activity</button>
    </div>
    <p className="max-w-prose text-sm text-muted">The latest investigation, separate from your customer conversation. A Reviewer accepting a draft does not authorize a financial change.</p>
    {error && <p role="alert" className="text-sm text-fail">Activity could not be refreshed. {error.message} {current && "The saved activity below may be out of date."}</p>}
    {current ? <ActivityPanel snapshot={current} /> : <p role="status" className="text-sm text-muted">{error ? "Agent activity is unavailable." : "Loading current investigation..."}</p>}
  </section>;
}
