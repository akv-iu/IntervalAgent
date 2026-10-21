"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Thread from "@/components/Thread";
import VisitorActivity from "./VisitorActivity";
import type { CaseRecord } from "@/lib/v2/state";
import { createVisitorCase, endVisitorSession, getVisitorSession, loadVisitorCase, mergeVisitorMessages, postVisitorMessage, startVisitorSession, VisitorRequestError, type VisitorMessage, type VisitorSession } from "@/lib/v2/visitor-client";

const businesses = { northside: "Northside Fitness", subscriptions: "Harbor Subscriptions" };
const statusText = {
  open: "Ready for your message",
  investigating: "Investigation requested. This status does not confirm a worker is running.",
  awaiting_customer: "Waiting for more information from you.",
  awaiting_human: "Investigation paused for operator review. No financial change has been applied.",
  resolved: "Case marked resolved.",
  closed: "This case is closed.",
};
const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-60";
const primary = `${button} border-accent-ink bg-accent-ink text-white`;

export default function VisitorWorkspace({ caseId }: { caseId?: string }) {
  const router = useRouter();
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [business, setBusiness] = useState<VisitorSession["businessId"]>("northside");
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<VisitorRequestError | null>(null);
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const cursor = useRef(0);
  const reading = useRef(false);
  const pending = useRef<{ text: string; key: string } | null>(null);
  const stopKey = useRef<string | null>(null);
  const current = useRef<CaseRecord | null>(null);
  const writeBusy = useRef(false);
  const stopBusy = useRef(false);
  const retryUntil = useRef(0);
  const scope = useRef<string | null>(null);
  const sessionRead = useRef(0);

  const accept = useCallback((next: CaseRecord, incoming: VisitorMessage[]) => {
    if (scope.current !== `${next.businessId}/${next.workspaceId}`) return;
    if (!current.current || next.revision >= current.current.revision) {
      current.current = next;
      setRecord(next);
    }
    setMessages((previous) => mergeVisitorMessages(previous, incoming));
  }, []);

  const acceptActivity = useCallback((next: CaseRecord) => accept(next, []), [accept]);

  const fail = useCallback((reason: unknown) => {
    const failure = reason instanceof VisitorRequestError ? reason : new VisitorRequestError(0);
    setError(failure);
    if (failure.status === 401) setSession(null);
    if (failure.retryAt) { retryUntil.current = failure.retryAt; setRetryAt(failure.retryAt); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++sessionRead.current;
    getVisitorSession(controller.signal).then((value) => {
      if (controller.signal.aborted || requestId !== sessionRead.current) return;
      const identity = `${value.businessId}/${value.workspaceId}`;
      if (scope.current !== identity) {
        scope.current = identity; current.current = null; cursor.current = 0; pending.current = null; stopKey.current = null;
        setRecord(null); setMessages([]); setDraft(""); setNotice(""); setError(null);
      }
      setSession(value); setChecked(true);
    }).catch((reason) => {
      if (controller.signal.aborted || requestId !== sessionRead.current) return;
      if (reason instanceof VisitorRequestError && reason.status === 401 && !caseId) { setSession(null); setError(null); }
      else fail(reason);
      setChecked(true);
    });
    return () => controller.abort();
  }, [caseId, fail]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => { retryUntil.current = 0; setRetryAt(0); }, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!session || !caseId || reading.current || Date.now() < retryUntil.current) return;
    reading.current = true;
    try {
      const result = await loadVisitorCase(session, caseId, cursor.current, signal);
      if (signal?.aborted || scope.current !== `${session.businessId}/${session.workspaceId}`) return;
      cursor.current = result.cursor;
      accept(result.case, result.messages);
    } catch (reason) {
      if (signal?.aborted || scope.current !== `${session.businessId}/${session.workspaceId}`) return;
      fail(reason);
      throw reason;
    } finally { reading.current = false; }
  }, [session, caseId, accept, fail]);

  useEffect(() => {
    if (!session || !caseId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let delay = 5000;
    const tick = async () => {
      if (controller.signal.aborted) return;
      if (!document.hidden) {
        try { await refresh(controller.signal); delay = 5000; }
        catch { delay = Math.min(delay * 2, 60_000); }
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, Math.max(delay, retryUntil.current - Date.now()));
    };
    void tick();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, caseId, refresh]);

  async function start() {
    if (writeBusy.current || retryAt) return;
    writeBusy.current = true; setBusy(true); setError(null);
    sessionRead.current++;
    try {
      const active = session ?? await startVisitorSession(business);
      setSession(active);
      await createVisitorCase();
      router.push("/v2/cases/reference-case");
    } catch (reason) { fail(reason); }
    finally { writeBusy.current = false; setBusy(false); }
  }

  async function end() {
    if (writeBusy.current || retryAt) return;
    writeBusy.current = true; setBusy(true); setError(null);
    sessionRead.current++;
    try { await endVisitorSession(); setSession(null); setNotice("Session ended. Its saved cases remain stored, but this browser can no longer access them."); }
    catch (reason) { fail(reason); }
    finally { writeBusy.current = false; setBusy(false); }
  }

  async function send(stop = false) {
    const active = current.current;
    if (!session || !active || active.contactSuppressed || (stop ? stopBusy.current : writeBusy.current || stopBusy.current || retryAt || active.state === "closed")) return;
    const text = stop ? "STOP" : draft.trim();
    if (!text || text.length > 500) return;
    if (stop) { stopBusy.current = true; setStopping(true); stopKey.current ??= crypto.randomUUID(); }
    else { writeBusy.current = true; setBusy(true); if (pending.current?.text !== text) pending.current = { text, key: crypto.randomUUID() }; }
    setError(null); setNotice("");
    try {
      const result = await postVisitorMessage(session, active, text, stop ? stopKey.current! : pending.current!.key);
      if (scope.current !== `${session.businessId}/${session.workspaceId}`) return;
      accept(result.case, [result.message]);
      if (!stop) { pending.current = null; setDraft((value) => value.trim() === text ? "" : value); }
      setNotice(current.current?.contactSuppressed ? "Contact stopped. No further customer contact will be sent." : "Message saved.");
    } catch (reason) {
      if (scope.current !== `${session.businessId}/${session.workspaceId}`) return;
      if (stop || !current.current?.contactSuppressed) fail(reason);
      if (reason instanceof VisitorRequestError && reason.status === 409) { try { await refresh(); } catch { /* The refresh reports its own failure. */ } }
    } finally {
      if (stop) { stopBusy.current = false; setStopping(false); }
      else { writeBusy.current = false; setBusy(false); }
    }
  }

  if (!checked) return <p role="status">Checking demo access...</p>;
  const blocked = error?.status === 404 || error?.status === 401;
  return (
    <div className="mt-6 space-y-6">
      <p role="status" className="text-sm text-ink-2">{notice}</p>
      {error && <div role="alert" className="max-w-2xl space-y-3 rounded-md border border-fail p-4">
        <p>{error.message}</p>
        {error.status === 401 && <Link href="/v2" className="inline-flex min-h-11 items-center text-accent-ink underline">Start a new workspace</Link>}
        {error.status !== 401 && <button type="button" className={button} disabled={!!retryAt || busy} onClick={() => { if (caseId && session) { setError(null); void refresh().catch(() => {}); } else window.location.reload(); }}>Refresh access</button>}
      </div>}
      {!caseId && !blocked && (!error || session) && <section aria-labelledby="start-case" className="max-w-2xl space-y-5 border-y border-line py-6">
        <h2 id="start-case" className="text-xl font-semibold">{session ? `Continue with ${businesses[session.businessId]}` : "Choose a synthetic business"}</h2>
        <p className="text-ink-2">You will use reference account 1. Describe an invoice dispute in your own words. Your case and messages are saved in a private demo workspace for this browser.</p>
        {!session && <label className="block max-w-sm font-medium">Business
          <select value={business} disabled={busy} onChange={(event) => setBusiness(event.target.value as VisitorSession["businessId"])} className="mt-2 block min-h-11 w-full rounded-md border border-muted bg-white px-3 py-2">
            {Object.entries(businesses).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy || !!retryAt} onClick={() => void start()}>{busy ? "Opening case..." : session ? "Open reference case" : "Start reference case"}</button>
          {session && <button type="button" className={button} disabled={busy || !!retryAt} onClick={() => void end()}>End session to change business</button>}
        </div>
        {session && <p className="text-sm text-muted">Ending the session removes access to its saved cases from this browser. It does not delete them.</p>}
      </section>}
      {caseId && session && !record && !error && <p role="status">Loading saved case...</p>}
      {caseId && record && session && <div className="grid min-w-0 gap-8 md:grid-cols-[minmax(0,1fr)_16rem]">
        <aside aria-labelledby="case-status" className="min-w-0 border-b border-line pb-5 md:col-start-2 md:row-start-1 md:border-b-0 md:border-l md:pl-6">
          <h2 id="case-status" className="text-lg font-semibold">Case status</h2>
          <p className="mt-2 font-medium">{businesses[session.businessId]}</p>
          <p className="mt-1 break-all text-sm text-muted">Account: {record.accountId}</p>
          <p role="status" className="mt-4 text-sm">{record.contactSuppressed ? "Contact stopped. This case cannot send further customer contact." : statusText[record.state]}</p>
          <p className="mt-4 text-sm text-muted">Follow the saved investigation below your conversation. A saved draft is not a sent reply.</p>
          <Link href="/v2" className="mt-4 inline-flex min-h-11 items-center text-sm text-accent-ink underline">Workspace options</Link>
        </aside>
        <section aria-labelledby="conversation" className="min-w-0 md:col-start-1 md:row-start-1">
          <h2 id="conversation" className="mb-4 text-xl font-semibold">Your conversation</h2>
          {messages.length ? <div className="[&_p]:wrap-anywhere"><Thread customer="You" messages={messages.map((message) => ({ seq: message.revision, role: message.role, body: message.text, when: new Date(message.createdAt).toLocaleString(), guardFlags: [], checks: [] }))} /></div>
            : <p className="border-y border-line py-6 text-ink-2">No messages yet. Tell us which invoice you are disputing and what needs checking.</p>}
          <form className="mt-6 space-y-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <label htmlFor="case-message" className="block font-medium">Your message</label>
            <textarea id="case-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} rows={4} disabled={blocked || record.contactSuppressed || record.state === "closed"} aria-describedby="message-limit" className="block w-full resize-y rounded-md border border-muted p-3" />
            <p id="message-limit" className="text-sm text-muted">Up to 500 characters. Internal agent exchanges do not appear in this conversation.</p>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={primary} disabled={blocked || busy || stopping || !!retryAt || !draft.trim() || record.contactSuppressed || record.state === "closed"}>{busy ? "Saving message..." : "Send message"}</button>
              <button type="button" className={button} disabled={blocked || stopping || record.contactSuppressed} onClick={() => void send(true)}>{stopping ? "Stopping contact..." : "Stop contact"}</button>
            </div>
            <p className="text-sm text-muted">Stop contact cancels further customer contact for this case.</p>
          </form>
        </section>
      </div>}
      {caseId && record && session && <VisitorActivity key={`${session.businessId}/${session.workspaceId}/${caseId}`} session={session} record={record} retryAt={retryAt} onAccessError={fail} onCaseChange={acceptActivity} />}
    </div>
  );
}
