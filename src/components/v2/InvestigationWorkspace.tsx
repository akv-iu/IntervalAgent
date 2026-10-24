"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatCents } from "@/lib/format";
import { caseAttention, roleNames, scenarioName, statusNames, type Attention } from "@/lib/v2/presentation";
import type { CaseState, WorkspaceView } from "@/lib/v2/store";
import BusinessDashboard, { CaseRecords } from "./BusinessDashboard";
import OperatorCorrections, { PausedReplyNotice } from "./OperatorCorrections";
import styles from "./workspace.module.css";

type Budget = { capDollars: number | null; conservativeUsedDollars: number; calls: number; unknown_calls: number; input_tokens: number; output_tokens: number };
type Payload = { workspace?: WorkspaceView; budget?: Budget; error?: string; expired?: boolean };
const button = "rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50";
const primary = `${button} border-accent-ink bg-accent-ink text-white`;
const field = "min-h-24 w-full rounded-md border border-line bg-white p-3 disabled:opacity-60";

export function RuntimeBox({ c, seconds }: { c: Pick<CaseState, "run" | "lastRun">; seconds: number }) {
  const run = c.run, saved = c.lastRun;
  const active = run?.activeRole && roleNames[run.activeRole];
  const steps = run?.steps ?? saved?.steps ?? [];
  const calls = [...new Map(steps.map((step) => [step.id, step])).values()];
  const shownCompleted = calls.filter((call) => call.state === "completed").length;
  const totalCompleted = run?.calls ?? saved?.calls ?? 0;
  const outcome = saved ? { completed: "complete", blocked: "review blocked", failed: "failed", interrupted: "interrupted" }[saved.outcome] : "";
  return <details className={styles.runtime} key={run?.id ?? saved?.id ?? "no-run"}>
    <summary>{run ? `Runtime · ${active || "working"}` : saved ? `Last run · ${outcome}` : "Runtime · no saved run"}</summary>
    {run || saved ? <>
      <p className={styles.runMeta}>{run ? seconds : ((saved?.durationMs ?? 0) / 1000).toFixed(1)}s · {run?.calls ?? saved?.calls ?? 0} completed model calls</p>
      <p>{run ? "The customer reply appears after review. Progress updates make no model calls." : "Kept here until the next message or retry starts a run. Audit history is retained separately."}</p>
      {saved?.failure && <p>{saved.failure.message}{saved.failure.status ? ` HTTP ${saved.failure.status}.` : ""}{saved.failure.code ? ` Code: ${saved.failure.code}.` : ""}</p>}
      {shownCompleted < totalCompleted && <p>Showing {shownCompleted} of {totalCompleted} completed calls. Earlier steps were not retained for this saved run.</p>}
      <ol className={styles.steps} aria-label="Latest run model calls" tabIndex={0}>{calls.map((call) => <li key={call.id}><span>{roleNames[call.role] ?? "Agent"}: {call.state}{call.tools?.length ? ` · requested ${call.tools.map((name) => name.replaceAll("_", " ")).join(", ")}` : ""}</span><time dateTime={call.at}>{new Date(call.at).toLocaleTimeString()}</time></li>)}</ol>
    </> : <p>Opening outreach makes no model call. Older run evidence, if any, remains in saved agent history.</p>}
  </details>;
}

async function getWorkspace(signal?: AbortSignal): Promise<Payload> {
  const response = await fetch("/api/v2/workspace", { cache: "no-store", signal });
  const payload: Payload = await response.json();
  if (response.status === 401) return { expired: true };
  if (response.status === 410) return { expired: true, error: payload.error };
  if (!response.ok) throw new Error(payload.error || "Cannot load workspace");
  return payload;
}

export function Thread({ c, channel }: { c: Pick<CaseState, "messages" | "facts" | "stopped">; channel: "customer" | "business" }) {
  const messages = c.messages.filter((message) => message.channel === channel);
  return <ol className={`${styles.thread} ${channel === "customer" ? styles.customerThread : ""}`} aria-label={`${channel} conversation`}>
    {messages.length ? messages.map((message) => <li key={message.id} className={channel === "customer" && message.speaker === "customer" ? styles.outgoing : undefined}>
      <p className={styles.speaker}>{message.speaker === "agent" ? (channel === "customer" ? c.facts.businessName : "Business Verification") : message.speaker === "business" ? "Simulated business contact" : c.facts.customer}
        {message.origin === "synthetic_opening" && <span className={styles.openingLabel}>Synthetic opening</span>}
        {message.origin === "operator_revision" && <span className={styles.openingLabel}>Reviewed correction</span>}
      </p>
      <p className={`${styles.bubble} whitespace-pre-wrap`}>{message.text}</p>
      {message.disposition === "late" && <p className="mt-1 text-xs text-muted">Late evidence retained for operator review; not applied.</p>}
    </li>) : <li className={styles.empty}>{channel === "customer" ? c.stopped ? "Contact is stopped. No messages were saved." : "No customer messages have been saved." : "A verification request appears here when the agents need fresh business evidence."}</li>}
  </ol>;
}

export default function InvestigationWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [caseId, setCaseId] = useState("late-payment");
  const [customerText, setCustomerText] = useState("");
  const [businessText, setBusinessText] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ payload: string; id: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousAttention = useRef<{ caseId: string; role: Attention | null }>({ caseId, role: null });
  const c = workspace?.cases[caseId];
  const cases = workspace ? Object.values(workspace.cases) : [];
  const businesses = [...new Map(cases.map((item) => [item.facts.businessId, item.facts.businessName])).entries()];
  const businessCases = cases.filter((item) => item.facts.businessId === c?.facts.businessId);
  const runId = c?.run?.id, runStartedAt = c?.run?.startedAt;
  const attention = c ? busy && !c.takeover && !c.reviewHold ? null : caseAttention(c) : null;

  function accept(payload: Payload) {
    if (payload.expired) setWorkspace(null);
    if (payload.workspace) setWorkspace(payload.workspace);
    if (payload.budget) setBudget(payload.budget);
    if (payload.error) setError(payload.error);
  }
  async function load(signal?: AbortSignal) { accept(await getWorkspace(signal)); }

  function selectCase(id: string) {
    if (!workspace || !Object.hasOwn(workspace.cases, id) || running.current) return;
    setCaseId(id); setCustomerText(""); setBusinessText(""); setError(""); pending.current = null;
  }

  useEffect(() => {
    const abort = new AbortController();
    getWorkspace(abort.signal).then((payload) => { if (!abort.signal.aborted) accept(payload); }).catch((e: unknown) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Cannot load workspace"); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!busy && !runId) return;
    const start = runStartedAt ? Date.parse(runStartedAt) : Date.now(); let active = true, polling = false;
    const timer = setInterval(async () => {
      setWaitSeconds(Math.floor((Date.now() - start) / 1000));
      if (polling) return;
      polling = true;
      try { const payload = await getWorkspace(); if (active && (!busy || running.current)) accept(payload); }
      catch { /* The action request reports failures; polling only refreshes saved progress. */ }
      finally { polling = false; }
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [busy, runId, runStartedAt]);
  useEffect(() => {
    const previous = previousAttention.current;
    if (previous.caseId !== caseId) { previousAttention.current = { caseId, role: attention }; return; }
    if (!attention) return;
    previousAttention.current = { caseId, role: attention };
    if (!previous.role || previous.role === attention || !root.current) return;
    const surface = root.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;
    const from = surface.querySelector(`[data-pane="${previous.role}"] [data-handoff-anchor]`);
    const to = surface.querySelector(`[data-pane="${attention}"] [data-handoff-anchor]`);
    if (!from || !to) return;
    const bounds = surface.getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const light = document.createElement("span"); light.className = styles.transfer; light.setAttribute("aria-hidden", "true"); surface.append(light);
    const animation = light.animate([
      { transform: `translate(${a.left - bounds.left}px, ${a.top - bounds.top}px)`, opacity: 0 },
      { transform: `translate(${a.left - bounds.left}px, ${a.top - bounds.top}px)`, opacity: 1, offset: 0.08 },
      { transform: `translate(${b.left - bounds.left}px, ${b.top - bounds.top}px)`, opacity: 1, offset: 0.9 },
      { transform: `translate(${b.left - bounds.left}px, ${b.top - bounds.top}px)`, opacity: 0 },
    ], { duration: 800, easing: "cubic-bezier(.3,0,.2,1)" });
    const cancel = () => { animation.cancel(); light.remove(); };
    animation.onfinish = () => light.remove();
    reducedMotion.addEventListener("change", cancel);
    return () => { reducedMotion.removeEventListener("change", cancel); cancel(); };
  }, [attention, caseId]);

  async function act(action: string, text?: string, interrupt = false, correction: { revision?: number; targetAuditId?: string; targetRole?: string; correctionId?: string } = {}) {
    if (running.current && !interrupt) return false;
    if (interrupt) controller.current?.abort();
    running.current = true; setBusy(true); setWaitSeconds(0); setError("");
    const abort = new AbortController(); controller.current = abort;
    const control = action === "create" || action === "reset";
    const fields = control ? { action } : { caseId, action, ...(text ? { text } : {}), ...(action === "business" ? { requestId: c?.requestId } : {}), ...correction };
    const serialized = JSON.stringify(fields);
    if (pending.current?.payload !== serialized) pending.current = { payload: serialized, id: crypto.randomUUID() };
    const command = control ? fields : { ...fields, id: pending.current.id };
    try {
      const response = await fetch("/api/v2/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: abort.signal });
      const payload: Payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Action did not complete");
      accept(payload); pending.current = null; return true;
    } catch (e: unknown) {
      if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : "Action did not complete"); await load().catch(() => {}); }
      return false;
    } finally { if (controller.current === abort) { running.current = false; setBusy(false); } }
  }
  async function submit(event: FormEvent, channel: "customer" | "business") {
    event.preventDefault();
    const done = await act(channel, channel === "customer" ? customerText : businessText);
    if (done) { if (channel === "customer") setCustomerText(""); else setBusinessText(""); }
  }
  const awaiting = c?.requestId && c.verification && ["awaiting_business", "needs_facts", "pending", "conflicting"].includes(c.verification.outcome);
  const processing = busy || !!c?.run;
  const paneClass = (role: Attention) => `${styles.pane} ${attention === role ? styles.activePane : ""}`;
  const guide = c?.stopped ? "Contact is stopped. You can inspect the saved history." : attention === "business" ? "Your turn as the business. Answer the verification request in the business inbox." : attention === "operator" ? "Your turn as the operator. Inspect the evidence before resuming automatic replies." : processing ? "The agents are working. Expand Runtime to see the current steps." : c?.status === "run_failed" ? "The run failed. Expand Runtime for details, then use Retry from saved evidence after addressing the error." : "Your turn as the customer. Continue the conversation below.";

  return <div className={styles.workspace} ref={root}>
    {error && <p role="alert" className="mb-4 rounded-md border border-fail bg-fail-bg p-3 text-fail">{error}</p>}
    {!workspace ? <>
      <p role="status" className="mb-4 text-sm">{loading ? "Restoring your private workspace…" : "Start a private workspace to explore two businesses and twelve synthetic client cases."}</p>
      <button className={primary} disabled={loading || busy} onClick={() => void act("create")}>Start private workspace</button>
    </> : <>
      <div className={styles.toolbar}>
        <div className={styles.selection}>
        <label className="min-w-0 text-sm font-medium">Business
          <select className="max-w-full rounded-md border border-line bg-white p-2 font-normal" value={c?.facts.businessId ?? ""} disabled={processing} onChange={(event) => { const first = cases.find((item) => item.facts.businessId === event.target.value); if (first) selectCase(first.facts.id); }}>
            {businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">Client
          <select className="max-w-full rounded-md border border-line bg-white p-2 font-normal" value={caseId} disabled={processing} onChange={(event) => selectCase(event.target.value)}>
            {businessCases.map((item) => <option key={item.facts.id} value={item.facts.id}>{item.facts.customer}: {scenarioName(item)}</option>)}
          </select>
        </label>
        </div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={processing} onClick={() => void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Cannot refresh"))}>Refresh history</button><button className={button} disabled={processing} onClick={() => { if (window.confirm("Reset only your workspace? History will be cleared. Expiry and usage accounting will not reset.")) void act("reset"); }}>Reset workspace</button></div>
      </div>
      {c && <>
        <BusinessDashboard workspace={workspace} businessId={c.facts.businessId} selectedId={caseId} disabled={processing} onSelect={selectCase} />
        <div id="v2-case" className={styles.caseHeader}>
          <div className={styles.caseMeta}><h2>{c.facts.customer}&apos;s case</h2><p className="mt-1 text-sm">{c.facts.businessName} · {c.facts.invoiceId} · {formatCents(c.facts.balanceCents)} on record</p><p className={styles.status}>{statusNames[c.status]} · {c.turns}/10 customer turns</p><p className={styles.status}>Balance as of {new Date(c.facts.balanceAsOf).toLocaleString()} ({c.facts.timezone})</p>
            <details className={styles.caseContext}><summary>Synthetic source and policy</summary><p className="mt-2 text-sm">{c.facts.recognitionPolicy === "business_confirmation" ? "Reviewed, complete business confirmation can record an existing payment under this business's policy." : "Recording an existing payment requires operator approval; business confirmation alone cannot change the balance. Operator payment approval is not available in this checkpoint."}</p><ul className="mt-2 list-inside list-disc text-sm">{c.facts.accountNotes?.map((note) => <li key={note}>{note}</li>)}</ul></details>
          </div>
          <RuntimeBox c={c} seconds={waitSeconds} />
        </div>
        <div className={styles.guide}><p role="status" aria-live="polite">{guide}</p>{attention && <a href={`#v2-${attention}`}>Go to {attention === "business" ? "business inbox" : attention === "operator" ? "operator review" : "customer conversation"}</a>}</div>
        <div className={styles.layout}>
          <section id="v2-customer" data-pane="customer" className={paneClass("customer")} aria-labelledby="customer-title">
            <div className={styles.paneHead}><div><h3 id="customer-title">Customer conversation</h3><p>{c.facts.businessName} · chatting as {c.facts.customer}</p></div><span className={styles.signal} data-handoff-anchor aria-hidden="true" /></div>
            <Thread c={c} channel="customer" />
            {c.verification?.outcome === "business_reported" && c.verification.amountCents !== null && <div className={styles.notice}><p>Business report: {formatCents(c.verification.amountCents)} paid toward {c.verification.invoiceId}.</p>{!c.reviewHold && !c.stopped && <button type="button" className={`${button} mt-2`} disabled={processing} onClick={() => void act("customer", "I dispute the business report and would like an operator to review it.")}>Dispute business report</button>}</div>}
            <PausedReplyNotice c={c} />
            {c.status === "run_failed" && <p className={styles.notice}>{c.lastRun?.failure?.message ?? "Your message is saved, but the agent run failed. The earlier error details were not retained. Use Retry from saved evidence to try again."}</p>}
            <form onSubmit={(event) => void submit(event, "customer")} className="space-y-2">
              <label htmlFor="v2-customer-message" className="block text-sm font-medium">Message as {c.facts.customer}</label>
              <textarea id="v2-customer-message" className={field} value={customerText} onChange={(event) => setCustomerText(event.target.value)} maxLength={1800} required disabled={processing || c.stopped} />
              <div className="flex flex-wrap gap-2"><button className={primary} disabled={processing || c.stopped || !customerText.trim()}>{c.takeover || c.reviewHold ? "Save for operator" : "Send customer message"}</button><button type="button" className={button} disabled={c.stopped} onClick={() => void act("customer", "STOP", true)}>Stop contact</button><button type="button" className={button} disabled={processing || c.stopped || !!c.reviewHold || c.takeover || !c.messages.some((m) => m.speaker !== "agent")} onClick={() => void act("retry")}>Retry from saved evidence</button></div>
            </form>
          </section>
          <section id="v2-business" data-pane="business" className={paneClass("business")} aria-labelledby="business-title">
            <div className={styles.paneHead}><div><h3 id="business-title">Business inbox</h3><p>{attention === "business" ? "Your reply is needed" : awaiting ? "Verification request saved" : "No reply needed right now"}</p></div><span className={styles.signal} data-handoff-anchor aria-hidden="true" /></div>
            <p className={styles.role}>You are playing {c.facts.businessName}</p><p className="mt-2 text-sm text-muted">This inbox is simulated. No email or text is sent. Your reply supplies evidence about an existing payment.</p>
            <Thread c={c} channel="business" />
            <form onSubmit={(event) => void submit(event, "business")} className="space-y-2">
              <label htmlFor="v2-business-message" className="block text-sm font-medium">Reply as the business</label><textarea id="v2-business-message" className={field} value={businessText} onChange={(event) => setBusinessText(event.target.value)} maxLength={1800} required disabled={processing || !awaiting || c.stopped} /><button className={primary} disabled={processing || !awaiting || c.stopped || !businessText.trim()}>Submit business evidence</button>
            </form>
          </section>
        </div>
        <section id="v2-operator" data-pane="operator" className={`${paneClass("operator")} ${styles.operator}`} aria-labelledby="operator-title">
          <div className={styles.paneHead}><div><h3 id="operator-title">Operator review</h3><p>{attention === "operator" ? "Your judgment is needed" : "Inspect saved evidence or take over"}</p></div><span className={styles.signal} data-handoff-anchor aria-hidden="true" /></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Takeover pauses automatic replies. Resume allows a later message or retry. STOP stays in force.</p><button className={button} disabled={c.stopped} onClick={() => void act(c.takeover || c.reviewHold ? "resume" : "takeover", undefined, true)}>{c.takeover || c.reviewHold ? "Resume automatic replies" : "Take over this case"}</button></div>
          {c.lastReview && <details className={styles.technical}><summary>Review and evidence packet: {c.lastReview.review.accepted ? "accepted" : "blocked"}</summary><p className="mt-2">{c.lastReview.verification?.summary || "No business-verification findings were returned. See saved agent history for what was attempted."}</p>{c.lastReview.resolution && <p className="mt-2">{c.lastReview.resolution.summary}</p>}<ul className="mt-2 list-inside list-disc">{c.lastReview.review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>}
          <OperatorCorrections key={caseId} c={c} busy={processing} onSave={({ text, ...correction }) => act("correct", text, false, correction)} onRetry={(correction) => act("retry_correction", undefined, false, correction)} />
          <div className={styles.savedPanel}>
            <div><h4>Saved commitments and requests</h4><CaseRecords c={c} /></div>
            <details className={styles.technical}><summary>Saved agent history</summary>{c.activity.length ? <ol className="mt-2 space-y-2 text-sm">{c.activity.map((item, index) => <li key={index}><span className="font-medium">{item.role.replaceAll("_", " ")} / {item.action}</span>: {item.summary}</li>)}</ol> : <p className="mt-2 text-sm text-muted">No agent work has run. Opening or refreshing makes no model calls.</p>}</details>
          </div>
        </section>
      </>}
      <p className={styles.footnote}>Private workspace expires {new Date(workspace.expiresAt).toLocaleString()}. Recovery needs this browser session.</p>
    </>}
    <p className={styles.footnote}>Live OpenAI agents with synthetic records. Reviewed business-confirmed payments can update the simulated balance. No real payments, calls or emails execute.</p>
    {budget && <details className={styles.technical}><summary>Demo limits and API usage</summary><p className="mt-2">{budget.capDollars === null ? "No local dollar cap. Model calls are billed to the configured OpenAI API account." : `Local API cap: $${budget.capDollars.toFixed(2)}.`} Conservative usage/reservations: ${budget.conservativeUsedDollars.toFixed(4)}. Tracked calls: {budget.calls}; reported input/output tokens: {budget.input_tokens}/{budget.output_tokens}; unknown calls: {budget.unknown_calls}. Includes earlier checkpoint reservations. This is an accounting estimate, not an invoice. Per-run and workspace limits still apply.</p></details>}
  </div>;
}
