"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatCents } from "@/lib/format";
import { caseAttention, roleNames, scenarioName, statusNames, type Attention } from "@/lib/v2/presentation";
import type { CaseState, WorkspaceView } from "@/lib/v2/store";
import { businessReplyAllowed } from "@/lib/v2/contracts";
import BusinessDashboard, { CaseList, CaseRecords } from "./BusinessDashboard";
import OperatorCorrections, { PausedReplyNotice } from "./OperatorCorrections";
import PaymentPanel from "./PaymentPanel";
import FinancialReview from "./FinancialReview";
import FinancialAdjustments from "./FinancialAdjustments";
import LearningPanel from "./LearningPanel";
import OutreachStrategy from "./OutreachStrategy";
import type { PaymentProposal } from "@/lib/v2/options";
import type { SimulationOutcome } from "@/lib/v2/payments";
import styles from "./workspace.module.css";

type Budget = { capDollars: number | null; conservativeUsedDollars: number; calls: number; unknown_calls: number; input_tokens: number; output_tokens: number };
type Payload = { workspace?: WorkspaceView; budget?: Budget; error?: string; expired?: boolean };
const button = "rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50";
const primary = `${button} border-accent-ink bg-accent-ink text-white`;
const field = "min-h-20 w-full rounded-md border border-line bg-white p-3 disabled:opacity-60";
type ContextPanel = "business" | "operator" | "details";

export function RuntimeBox({ c, seconds }: { c: Pick<CaseState, "run" | "lastRun">; seconds: number }) {
  const run = c.run, saved = c.lastRun;
  const active = run?.activeRole && roleNames[run.activeRole];
  const steps = run ? run.steps ?? [] : saved?.steps ?? [];
  const calls = [...new Map(steps.map((step) => [step.id, step])).values()];
  const flow: typeof calls = [];
  for (const call of calls) {
    if (flow.at(-1)?.role === call.role) flow[flow.length - 1] = call;
    else flow.push(call);
  }
  const shownCompleted = calls.filter((call) => call.state === "completed").length;
  const totalCompleted = run?.calls ?? saved?.calls ?? 0;
  const outcome = saved ? { completed: "complete", blocked: "review blocked", failed: "failed", interrupted: "interrupted" }[saved.outcome] : "";
  return <section className={styles.runtime} aria-label="Agent activity" data-running={run ? "true" : "false"}>
    <div className={styles.runtimeHead}>
      <span className={styles.runSignal} aria-hidden="true" />
      <p role="status" aria-live="polite">{run ? active ? `${active} is working` : "Run started" : saved ? `Last run · ${outcome}` : "No agent activity yet"}</p>
      {(run || saved) && <span className={styles.runMeta}>{run ? seconds : ((saved?.durationMs ?? 0) / 1000).toFixed(1)}s</span>}
    </div>
    {flow.length > 0 && <ol className={styles.runFlow} aria-label="Recent agent handoffs">{flow.slice(-4).map((call) => <li key={call.id} data-state={call.state}><span aria-hidden="true">{call.state === "completed" ? "✓" : "•"}</span>{roleNames[call.role] ?? "Agent"}</li>)}</ol>}
    {(run || saved) && <details key={run?.id ?? saved?.id}>
      <summary>{totalCompleted} completed model calls <span>View steps</span></summary>
      {!run && saved?.failure && <p>{saved.failure.message}{saved.failure.status ? ` HTTP ${saved.failure.status}.` : ""}{saved.failure.code ? ` Code: ${saved.failure.code}.` : ""}</p>}
      {shownCompleted < totalCompleted && <p>Showing {shownCompleted} of {totalCompleted} completed calls. Earlier steps were not retained for this saved run.</p>}
      <ol className={styles.steps} aria-label="Latest run model calls" tabIndex={0}>{calls.map((call) => <li key={call.id}><span>{roleNames[call.role] ?? "Agent"}: {call.state}{call.tools?.length ? ` · requested ${call.tools.map((name) => name.replaceAll("_", " ")).join(", ")}` : ""}</span><time dateTime={call.at}>{new Date(call.at).toLocaleTimeString()}</time></li>)}</ol>
    </details>}
  </section>;
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
  const [panelChoice, setPanelChoice] = useState<{ context: string; panel: ContextPanel }>({ context: "", panel: "details" });
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ payload: string; id: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const previousAttention = useRef<{ caseId: string; role: Attention | null }>({ caseId, role: null });
  const c = workspace?.cases[caseId];
  const cases = workspace ? Object.values(workspace.cases).sort((a, b) => a.facts.invoiceId.localeCompare(b.facts.invoiceId)) : [];
  const businesses = [...new Map(cases.map((item) => [item.facts.businessId, item.facts.businessName])).entries()];
  const businessCases = cases.filter((item) => item.facts.businessId === c?.facts.businessId);
  const runId = c?.run?.id, runStartedAt = c?.run?.startedAt;
  const attention = c ? busy && !c.takeover && !c.reviewHold ? null : caseAttention(c) : null;
  const panelContext = `${caseId}:${attention ?? "idle"}`;
  const panel = panelChoice.context === panelContext ? panelChoice.panel : attention === "business" ? "business" : attention === "operator" ? "operator" : "details";
  const showPanel = (value: ContextPanel) => setPanelChoice({ context: panelContext, panel: value });
  const customerMessages = c?.messages.filter((m) => m.channel === "customer").length;

  useEffect(() => {
    if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [caseId, customerMessages]);

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

  async function act(action: string, text?: string, interrupt = false, correction: { revision?: number; targetAuditId?: string; targetRole?: string; correctionId?: string; proposal?: PaymentProposal; agreementId?: string; outcome?: SimulationOutcome; operationId?: string; note?: string; evidenceReference?: string; amountCents?: number; paymentId?: string; receiptId?: string; sourceMessageId?: string; learningRevision?: number; candidateId?: string; scope?: "scenario" | "business" } = {}) {
    if (running.current && !interrupt) return false;
    setPanelChoice({ context: `${caseId}:idle`, panel: action === "reset" ? "details" : panel });
    if (interrupt) controller.current?.abort();
    running.current = true; setBusy(true); setWaitSeconds(0); setError("");
    const abort = new AbortController(); controller.current = abort;
    const control = action === "create" || action === "reset";
    const fields = control ? { action } : action.endsWith("_lesson") ? { action, ...(action === "propose_lesson" ? { caseId } : {}), ...correction } : { caseId, action, ...(text ? { text } : {}), ...(action === "business" ? { requestId: c?.requestId } : {}), ...correction };
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
  const canReply = c && businessReplyAllowed(c);
  const processing = busy || !!c?.run;
  const paneClass = (role: Attention) => `${styles.pane} ${attention === role ? styles.activePane : ""}`;
  const guide = c?.stopped ? "Contact stopped" : attention === "business" ? "Business reply needed" : attention === "operator" ? "Operator review needed" : processing ? "Processing your request" : c?.status === "run_failed" ? "Run failed. Inspect activity, then retry." : `You are chatting as ${c?.facts.customer ?? "the customer"}`;

  return <div className={styles.workspace} ref={root}>
    {error && <p role="alert" className="mb-4 rounded-md border border-fail bg-fail-bg p-3 text-fail">{error}</p>}
    {!workspace ? <div className={styles.welcome}>
      <span className={styles.welcomeMark} aria-hidden="true">R</span>
      <h2>A clearer view of every case.</h2>
      <p role="status">{loading ? "Restoring your workspace…" : "Choose a client, continue the conversation and follow the agents as they work."}</p>
      <button className={primary} disabled={loading || busy} onClick={() => void act("create")}>{busy ? "Starting…" : "Start private workspace"}</button>
      <p className={styles.footnote}>Two businesses. Twelve synthetic cases. Saved for 24 hours.</p>
    </div> : <>
      {c && <div className={styles.shell}>
        <aside className={styles.clients} aria-label="Business and clients">
          <label className={styles.businessSelect}>Business
            <select value={c.facts.businessId} disabled={processing} onChange={(event) => { const first = cases.find((item) => item.facts.businessId === event.target.value); if (first) selectCase(first.facts.id); }}>
              {businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <div className={styles.listHeading}><h2>Clients</h2><span>{businessCases.length}</span></div>
          <CaseList cases={businessCases} selectedId={caseId} disabled={processing} onSelect={selectCase} />
          <div className={styles.clientFooter}>
            <button className={button} disabled={processing} onClick={() => void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Cannot refresh"))}>Refresh history</button>
            <details className={styles.workspaceSettings}><summary>Workspace settings</summary>
              <p>Expires {new Date(workspace.expiresAt).toLocaleString()}. Recovery needs this browser session.</p>
              <button className={button} disabled={processing} onClick={() => { if (window.confirm("Reset only your workspace? History will be cleared. Expiry and usage accounting will not reset.")) void act("reset"); }}>Reset workspace</button>
              {budget && <p>{budget.capDollars === null ? "No local dollar cap." : `API cap: $${budget.capDollars.toFixed(2)}.`} Conservative usage/reservations: ${budget.conservativeUsedDollars.toFixed(4)}. Tracked calls: {budget.calls}; reported tokens: {budget.input_tokens}/{budget.output_tokens}; unknown calls: {budget.unknown_calls}. Estimates are not invoices. Run/workspace limits still apply.</p>}
            </details>
          </div>
        </aside>
        <div className={styles.caseMain}>
          <header id="v2-case" className={styles.caseHeader}>
            <div className={styles.caseMeta}><h2>{c.facts.customer}</h2><p>{c.facts.businessName} <span aria-hidden="true">/</span> {c.facts.invoiceId}</p></div>
            <div className={styles.balance}><span>Balance on record</span><strong>{formatCents(c.facts.balanceCents)}</strong></div>
          </header>
          <div className={styles.layout}>
            <section id="v2-customer" data-pane="customer" className={`${paneClass("customer")} ${styles.conversation}`} aria-labelledby="customer-title">
              <div className={styles.paneHead}><div><h3 id="customer-title">Conversation</h3><p>{guide}</p></div><span className={styles.signal} data-handoff-anchor aria-hidden="true" /></div>
              <div className={styles.conversationBody} ref={conversation}>
                <Thread c={c} channel="customer" />
                <PaymentPanel key={caseId} c={c} now={workspace.observedAt} busy={processing} onConfirm={(proposal) => void act("confirm_plan", undefined, false, { revision: c.revision, proposal })} onPay={(agreementId, outcome) => void act("simulate_payment", undefined, false, { revision: c.revision, agreementId, outcome })} />
                {c.verification?.outcome === "business_reported" && c.verification.amountCents !== null && <div className={styles.notice}><p>Business report: {formatCents(c.verification.amountCents)} paid toward {c.verification.invoiceId}.</p>{!c.reviewHold && !c.stopped && <button type="button" className={`${button} mt-2`} disabled={processing} onClick={() => void act("customer", "I dispute the business report and would like an operator to review it.")}>Dispute business report</button>}</div>}
                <PausedReplyNotice c={c} />
                {c.status === "run_failed" && <p className={styles.notice}>{c.lastRun?.failure?.message ?? "Your message is saved. Inspect activity for details, then retry."}</p>}
              </div>
              <div className={styles.composer}>
                {(attention === "business" || attention === "operator") && <a className={styles.handoffAction} href={`#v2-${attention}`} onClick={() => showPanel(attention)}><span className={styles.signal} aria-hidden="true" />{attention === "business" ? "Open business request" : "Review this case"}</a>}
                <RuntimeBox c={c} seconds={waitSeconds} />
                <form onSubmit={(event) => void submit(event, "customer")}>
                  <label htmlFor="v2-customer-message" className="sr-only">Message as {c.facts.customer}</label>
                  <textarea id="v2-customer-message" className={field} placeholder={c.stopped ? "Contact is stopped" : `Message as ${c.facts.customer}…`} value={customerText} onChange={(event) => setCustomerText(event.target.value)} maxLength={1800} required disabled={processing || c.stopped} />
                  <div className={styles.composerActions}><span>{c.turns}/10 messages</span><button className={primary} disabled={processing || c.stopped || !customerText.trim()}>{processing ? "Please wait…" : c.takeover || c.reviewHold ? "Save for operator" : "Send message"}</button></div>
                </form>
                <div className={styles.chatActions}><button type="button" disabled={c.stopped} onClick={() => void act("customer", "STOP", true)}>Stop contact</button><button type="button" disabled={processing || c.stopped || !!c.reviewHold || c.takeover || !c.messages.some((m) => m.speaker !== "agent")} onClick={() => void act("retry")}>Retry from saved evidence</button></div>
              </div>
            </section>
            <aside className={styles.context} aria-label="Case tools">
              <nav className={styles.contextNav} aria-label="Case panels">
                <button id="business-panel-button" type="button" data-pane="business" aria-pressed={panel === "business"} aria-controls="v2-business" onClick={() => showPanel("business")}>Business<span className={styles.signal} data-handoff-anchor data-needed={attention === "business"} aria-hidden="true" />{attention === "business" && <span className="sr-only">Reply needed</span>}</button>
                <button id="operator-panel-button" type="button" data-pane="operator" aria-pressed={panel === "operator"} aria-controls="v2-operator" onClick={() => showPanel("operator")}>Review<span className={styles.signal} data-handoff-anchor data-needed={attention === "operator"} aria-hidden="true" />{attention === "operator" && <span className="sr-only">Review needed</span>}</button>
                <button id="details-panel-button" type="button" aria-pressed={panel === "details"} aria-controls="v2-details" onClick={() => showPanel("details")}>Details</button>
              </nav>
              <div className={styles.contextBody}>
                <section id="v2-business" hidden={panel !== "business"} className={paneClass("business")} aria-labelledby="business-title">
                  <div className={styles.paneHead}><div><h3 id="business-title">Business inbox</h3><p>{awaiting ? "Your reply is needed" : canReply ? "Receipt recorded; you can add a correction" : "No reply needed"}</p></div></div>
                  <p className={styles.role}>Reply as {c.facts.businessName}</p>
                  <Thread c={c} channel="business" />
                  <form onSubmit={(event) => void submit(event, "business")} className="space-y-2">
                    <label htmlFor="v2-business-message" className="sr-only">Reply as the business</label><textarea id="v2-business-message" className={field} placeholder="Confirm the request or explain what differs…" value={businessText} onChange={(event) => setBusinessText(event.target.value)} maxLength={1800} required disabled={processing || !canReply || c.stopped} /><button className={primary} disabled={processing || !canReply || c.stopped || !businessText.trim()}>Send business reply</button>
                  </form>
                  <p className={styles.footnote}>Simulated inbox. Your reply supplies evidence; it does not initiate a payment.</p>
                </section>
                <section id="v2-operator" hidden={panel !== "operator"} className={paneClass("operator")} aria-labelledby="operator-title">
                  <div className={styles.paneHead}><div><h3 id="operator-title">Operator review</h3><p>{attention === "operator" ? "Your decision is needed" : "Evidence and case controls"}</p></div></div>
                  <div className={styles.operatorControl}><p>Automatic replies: {c.stopped ? "stopped" : c.takeover || c.reviewHold || c.status === "needs_review" ? "paused" : "enabled"}</p><button className={button} disabled={c.stopped} onClick={() => void act(c.takeover || c.reviewHold ? "resume" : "takeover", undefined, true)}>{c.takeover || c.reviewHold ? "Resume automatic replies" : "Take over this case"}</button></div>
                  {c.lastReview ? <details className={styles.technical} open><summary>Evidence packet · {c.lastReview.review.accepted ? "accepted" : "blocked"}</summary><p className="mt-2">{c.lastReview.verification?.summary || "No business-verification findings returned."}</p>{c.lastReview.resolution && <p className="mt-2">{c.lastReview.resolution.summary}</p>}<ul className="mt-2 list-inside list-disc">{c.lastReview.review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : <p className={styles.empty}>Reviewed evidence will appear after an agent run.</p>}
                  <FinancialReview key={`financial-${caseId}`} c={c} now={workspace.observedAt ?? c.now} busy={processing} onDecide={({ action, ...fields }) => act(action, undefined, false, fields)} />
                  <FinancialAdjustments key={`adjustments-${caseId}`} c={c} busy={processing} onDecide={({ action, ...fields }) => act(action, undefined, false, fields)} />
                  <details className={styles.technical}><summary>Correct an agent response</summary><OperatorCorrections key={caseId} c={c} busy={processing} onSave={({ text, ...correction }) => act("correct", text, false, correction)} onRetry={(correction) => act("retry_correction", undefined, false, correction)} /></details>
                  <details className={styles.technical}><summary>Evaluated agent learning</summary><LearningPanel key={`learning-${caseId}`} c={c} state={workspace.learning} busy={processing} seconds={waitSeconds} onAction={({ action, ...fields }) => act(action, undefined, false, fields)} /></details>
                </section>
                <section id="v2-details" hidden={panel !== "details"} className={styles.pane} aria-labelledby="details-title">
                  <div className={styles.paneHead}><div><h3 id="details-title">Case details</h3><p>{scenarioName(c)}</p></div></div>
                  <dl className={styles.factList}><div><dt>Status</dt><dd>{statusNames[c.status]}</dd></div><div><dt>Invoice</dt><dd>{c.facts.invoiceId}</dd></div><div><dt>Snapshot</dt><dd>{new Date(c.facts.balanceAsOf).toLocaleDateString(undefined, { timeZone: c.facts.timezone })}<span>{c.facts.timezone}</span></dd></div><div><dt>Latest case time</dt><dd>{new Date(c.now).toLocaleString(undefined, { timeZone: c.facts.timezone })}</dd></div></dl>
                  <details className={styles.caseContext}><summary>Source and recognition policy</summary><p>{c.facts.recognitionPolicy === "business_confirmation" ? "Complete, reviewed business confirmation can record an existing payment." : "Recording an existing payment requires operator approval."}</p><ul className="mt-2 list-inside list-disc text-sm">{c.facts.accountNotes?.map((note) => <li key={note}>{note}</li>)}</ul></details>
                  <OutreachStrategy key={`outreach-${caseId}`} c={c} />
                  <div className={styles.caseRecords}><h4>Saved commitments and requests</h4><CaseRecords c={c} /></div>
                  <details className={styles.technical}><summary>Saved agent history</summary>{c.activity.length ? <ol className="mt-2 space-y-2 text-sm">{c.activity.map((item, index) => <li key={index}><span className="font-medium">{item.role.replaceAll("_", " ")} / {item.action}</span>: {item.summary}</li>)}</ol> : <p className="mt-2 text-sm text-muted">No agent work yet.</p>}</details>
                </section>
              </div>
            </aside>
          </div>
        </div>
      </div>}
      {c && <BusinessDashboard workspace={workspace} businessId={c.facts.businessId} selectedId={caseId} disabled={processing} onSelect={selectCase} />}
    </>}
    <p className={styles.footnote}>Live agents with synthetic records. No real payments, calls or emails.</p>
  </div>;
}
