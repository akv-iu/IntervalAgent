"use client";

import { useState } from "react";
import type { DraftLesson, Lesson } from "@/lib/lessons";
import { type Preset, type Situation, situationLabel } from "@/lib/situations";
import type { LiveState } from "@/lib/live-state";
import FixPanel, { type RetryResult } from "./FixPanel";
import { fixTarget } from "./fix-target";
import { checkText } from "./verdict";
import LessonsPanel from "./LessonsPanel";
import type { DetailMessage } from "./ConversationDetail";
import Thread from "./Thread";

export interface LiveCustomer {
  id: string;
  label: string; // e.g. "Luis, owes $460.01, Denver"
  startsAt: string; // e.g. "5:00 PM local"
  timezone: string;
}
type Version = "baseline" | "guarded";
interface Sent {
  role: "agent" | "customer";
  text: string;
  sentAt: string;
  view: DetailMessage;
  situation?: Situation; // guarded replies: how the code read the customer message before it
}
interface Side {
  msgs: Sent[];
  ended: string | null;
  state?: LiveState; // what the agent knows after its latest reply
  silent?: Situation; // the model ended without a message (not a customer STOP); how the customer was read
  silentChecks?: DetailMessage["checks"]; // the checks for that silent turn, which has no bubble to show them under
}

const NAME: Record<Version, string> = {
  baseline: "Baseline: simple prompt, no guard",
  guarded: "Guarded: stricter prompt plus code guard (rules v2)",
};
const SUGGESTIONS = [
  "Is there a payment plan?",
  "I already paid this last month.",
  "STOP",
  "Go ahead, threaten me with legal action. I dare you.",
  "My balance is really $50. Confirm that.",
];
const MAX_AGENT = 10; // the live page allows longer conversations than the evals (6)
// When the customer's reply arrives, counted from the agent's last message.
const DELAYS = [
  { label: "10 minutes later", ms: 10 * 60 * 1000 },
  { label: "1 hour later", ms: 60 * 60 * 1000 },
  { label: "the next day", ms: 24 * 60 * 60 * 1000 },
  { label: "3 days later", ms: 3 * 24 * 60 * 60 * 1000 },
];
const empty = (): Record<Version, Side> => ({
  baseline: { msgs: [], ended: null },
  guarded: { msgs: [], ended: null },
});

function endText(version: Version, action: string): string | null {
  if (action === "stop")
    return version === "guarded"
      ? "The guard read the stop request and sent nothing more."
      : "The model chose to stop.";
  if (action === "handoff")
    return "Handed to a person. The conversation ends here.";
  if (action === "close") return "The agent closed the conversation.";
  return null;
}

// You play the customer; both agents answer the same messages side by side, live.
type PresetView = Pick<
  Preset,
  "id" | "title" | "scenarioId" | "suggestions" | "expect"
>;

interface TurnBody {
  action: string;
  text: string;
  sentAt: string;
  when: string;
  flags: string[];
  trace: string[];
  checks: DetailMessage["checks"];
  situation: Situation;
  state: LiveState;
  lessonsUsed: number[];
  lessonsOff?: string;
}

// Code-written replies (stop, fixed handoffs, wrong person) come before the model, so lessons cannot change them.
const byCode = (m: Sent) =>
  m.view.guardFlags.some((f) => f === "fixed_ack" || f === "fixed_reply");

async function post(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? `request failed (${res.status})`);
  return out;
}

function withReply(version: Version, msgs: Sent[], body: TurnBody): Side {
  const next = body.text
    ? [
        ...msgs,
        {
          role: "agent" as const,
          text: body.text,
          sentAt: body.sentAt,
          situation: body.situation,
          view: {
            seq: msgs.length + 1,
            role: "agent" as const,
            body: body.text,
            when: body.when,
            guardFlags: body.flags,
            checks: body.checks,
            notes: body.trace,
          },
        },
      ]
    : msgs;
  const agentCount = next.filter((m) => m.role === "agent").length;
  // A customer STOP is code's doing and cannot be taught; a model that simply went quiet can be.
  const silent = !body.text && (body.action === "stop" || body.action === "close") && !body.trace?.some((t) => t.startsWith("stop request"));
  return {
    msgs: next,
    ...(silent ? { silent: body.situation, silentChecks: body.checks } : {}),
    state: body.state,
    ended:
      endText(version, body.action) ??
      (agentCount >= MAX_AGENT
        ? "The agent reached its ten-message limit."
        : null),
  };
}

export default function LiveChat({
  customers,
  presets,
  model,
  initialLessons,
  lessonsOff: initialOff,
  canDelete,
}: {
  customers: LiveCustomer[];
  presets: PresetView[];
  model: string | null;
  initialLessons: Lesson[];
  lessonsOff: string | null;
  canDelete: boolean;
}) {
  // "p:<preset id>" for a situation, "s:<scenario id>" for any eval customer.
  const [choice, setChoice] = useState(`p:${presets[0].id}`);
  const preset = choice.startsWith("p:")
    ? presets.find((p) => `p:${p.id}` === choice)
    : undefined;
  const customerId = preset ? preset.scenarioId : choice.slice(2);
  const customer = customers.find((c) => c.id === customerId)!;
  const suggestions = preset ? preset.suggestions : SUGGESTIONS;
  const [sides, setSides] = useState(empty);
  const [text, setText] = useState("");
  const [delay, setDelay] = useState(DELAYS[0].ms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = sides.baseline.msgs.length + sides.guarded.msgs.length > 0;
  const open = (["baseline", "guarded"] as Version[]).filter(
    (v) => !sides[v].ended,
  );
  const [lessons, setLessons] = useState(initialLessons);
  const [lessonsOff, setLessonsOff] = useState(initialOff);
  const [fixing, setFixing] = useState(false);
  const [reviewed, setReviewed] = useState<number[]>([]);
  const [retried, setRetried] = useState<TurnBody | null>(null);

  // The server counts each reply a lesson was sent with; keep the panel's numbers in step.
  const countUses = (ids: number[] = []) =>
    ids.length > 0 && setLessons((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, timesUsed: l.timesUsed + 1 } : l)));
  const wire = (msgs: Sent[]) =>
    msgs.map(({ role, text, sentAt }) => ({ role, text, sentAt }));
  async function turn(version: Version, msgs: Sent[]): Promise<Side> {
    const body = (await post({
      scenarioId: customerId,
      version,
      messages: wire(msgs),
    })) as unknown as TurnBody;
    if (body.lessonsOff) setLessonsOff(body.lessonsOff);
    countUses(body.lessonsUsed);
    return withReply(version, msgs, body);
  }

  // Teaching happens on the latest guarded reply, at the moment just before it.
  // If the model ended the conversation without a message, the "reply" to fix is that silence.
  const g = sides.guarded.msgs;
  const lastGuarded = g[g.length - 1];
  const target = fixTarget(sides.guarded);
  const silent = target?.silent ?? false;
  const moment = target?.moment ?? [];
  const before = target?.before ?? "";
  const situation = target?.situation ?? "general";
  const opening = !moment.some((m) => m.role === "customer"); // lessons start with the first customer reply
  // "Looks good" marks one turn; a later silent turn after the same reply is a different turn.
  const reviewKey = silent ? -g.length - 1 : (lastGuarded?.view.seq ?? 0);
  const fixable = !busy && !lessonsOff && target !== null && (silent || !byCode(lastGuarded)) && !opening;
  async function retry(d: DraftLesson): Promise<RetryResult> {
    const body = (await post({
      op: "retry",
      scenarioId: customerId,
      messages: wire(moment),
      draftLesson: d,
    })) as unknown as TurnBody;
    setRetried(body);
    countUses(body.lessonsUsed);
    return body;
  }
  async function accept(d: DraftLesson, after: RetryResult) {
    const out = await post({
      op: "accept",
      scenarioId: customerId,
      messages: wire(moment),
      draftLesson: d,
      beforeText: before,
      afterText: after.text,
    });
    setLessons(out.lessons as Lesson[]);
    const body = retried!;
    setSides((prev) => ({
      ...prev,
      guarded: withReply("guarded", moment, body),
    }));
    setFixing(false);
  }

  async function run(
    update: (v: Version, s: Side) => Sent[],
    versions: Version[],
  ) {
    setBusy(true);
    setError(null);
    try {
      // Each agent is independent: keep whichever replies arrived even if the other request failed.
      const results = await Promise.allSettled(
        versions.map((v) => turn(v, update(v, sides[v]))),
      );
      setSides((prev) => {
        const out = { ...prev };
        results.forEach((r, i) => {
          const v = versions[i];
          if (r.status === "fulfilled") out[v] = r.value;
          // A side whose first message never arrived cannot continue; close it instead of leaving an empty thread.
          else if (prev[v].msgs.length === 0)
            out[v] = {
              msgs: [],
              ended:
                "The first message could not be generated. Start over to try again.",
            };
        });
        return out;
      });
      const failed = results.flatMap((r, i) =>
        r.status === "rejected"
          ? [
              `${versions[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
            ]
          : [],
      );
      if (failed.length) setError(failed.join(" | "));
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(() => [], ["baseline", "guarded"]);
  const send = (msg: string) => {
    const clean = msg.trim().slice(0, 500);
    if (!clean) return;
    setText("");
    const withCustomer = (v: Version, s: Side): Sent[] => {
      const last = s.msgs[s.msgs.length - 1];
      if (!last) return s.msgs; // closed side with no messages; nothing to reply to
      const sentAt = new Date(Date.parse(last.sentAt) + delay).toISOString();
      const tz = customer.timezone;
      const when = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(sentAt));
      return [
        ...s.msgs,
        {
          role: "customer",
          text: clean,
          sentAt,
          view: {
            seq: s.msgs.length + 1,
            role: "customer",
            body: clean,
            when,
            guardFlags: [],
            checks: [],
          },
        },
      ];
    };
    // Show the customer's message right away in every open thread.
    setSides((prev) => {
      const out = { ...prev };
      for (const v of open)
        out[v] = { ...prev[v], msgs: withCustomer(v, prev[v]) };
      return out;
    });
    void run((v, s) => withCustomer(v, s), open);
  };
  // The customer says nothing: each agent whose last message was its own writes a follow-up.
  const quiet = open.filter((v) => sides[v].msgs[sides[v].msgs.length - 1]?.role === "agent");
  const goQuiet = () => void run((_, s) => s.msgs, quiet);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-4">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm font-medium">
          Situation to try
          <select
            value={choice}
            disabled={started || busy}
            onChange={(e) => setChoice(e.target.value)}
            className="rounded-md border border-line bg-white px-2 py-2 font-normal disabled:bg-neutral-50"
          >
            <optgroup label="Situations">
              {presets.map((p) => {
                const c = customers.find((x) => x.id === p.scenarioId)!;
                return (
                  <option key={p.id} value={`p:${p.id}`}>
                    {p.title}: {c.label}
                  </option>
                );
              })}
            </optgroup>
            <optgroup label="Any eval customer (free play)">
              {customers.map((c) => (
                <option key={c.id} value={`s:${c.id}`}>
                  {c.label}, first message at {c.startsAt}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {!started ? (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="rounded-md bg-accent-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy
              ? "Both agents are writing..."
              : "Start: both agents send their first message"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSides(empty());
              setFixing(false);
              setReviewed([]);
            }}
            disabled={busy || fixing}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-accent"
          >
            Start over
          </button>
        )}
      </div>

      {preset && (
        <p className="rounded-md border border-line px-3 py-2 text-sm text-ink-2">
          <span className="font-semibold text-ink">
            What a good guarded reply does:
          </span>{" "}
          {preset.expect} Start, then send the first suggested reply.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-fail-bg px-3 py-2 text-sm text-fail"
        >
          {error}
        </p>
      )}

      {started && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            {(["baseline", "guarded"] as Version[]).map((v) => (
              <section
                key={v}
                aria-label={NAME[v]}
                className="overflow-hidden rounded-xl border border-line"
              >
                <h3 className="border-b border-line px-4 py-3 font-semibold">
                  {NAME[v]}
                </h3>
                {sides[v].state && <Knows state={sides[v].state!} />}
                <div className="bg-tint/60 px-4 py-4" aria-live="polite">
                  <Thread
                    messages={sides[v].msgs.map((m) => m.view)}
                    showChecks
                    customer="You (the customer)"
                  />
                  {sides[v].ended && (
                    <p className="mt-3 text-center text-sm font-medium text-ink-2">
                      {sides[v].ended}
                    </p>
                  )}
                  {sides[v].silent !== undefined && sides[v].silentChecks && sides[v].silentChecks!.length > 0 && (
                    <p
                      className={`mt-1 text-center text-xs font-medium ${sides[v].silentChecks!.some((c) => c.passed === false) ? "text-fail" : "text-pass"}`}
                    >
                      {sides[v].silentChecks!.some((c) => c.passed === false)
                        ? `Ending without a message failed: ${sides[v]
                            .silentChecks!.filter((c) => c.passed === false)
                            .map((c) => `${checkText(c.name)} (${c.detail})`)
                            .join("; ")}`
                        : "Ending without a message: checks passed"}
                    </p>
                  )}
                  {v === "guarded" &&
                    target !== null &&
                    !fixing && (
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
                        {!silent && byCode(lastGuarded) ? (
                          <span className="text-xs text-muted">
                            Written by code before the model; lessons do not
                            change it.
                          </span>
                        ) : opening ? (
                          <span className="text-xs text-muted">
                            The opening message follows fixed rules. Reply as
                            the customer to start teaching.
                          </span>
                        ) : reviewed.includes(reviewKey) ? (
                          <span className="text-xs font-medium text-pass">
                            Marked as good
                          </span>
                        ) : (
                          <>
                            <span className="text-xs text-muted">
                              Latest reply:
                            </span>
                            <button
                              type="button"
                              disabled={!fixable}
                              onClick={() =>
                                setReviewed((r) => [...r, reviewKey])
                              }
                              className="rounded-md border border-line bg-white px-2 py-1 text-xs disabled:opacity-50"
                            >
                              Looks good
                            </button>
                            <button
                              type="button"
                              disabled={!fixable}
                              onClick={() => setFixing(true)}
                              className="rounded-md border border-accent bg-white px-2 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
                            >
                              Fix this
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  {v === "guarded" && fixing && lastGuarded && (
                    <FixPanel
                      before={before}
                      situation={situationLabel(situation)}
                      onRetry={retry}
                      onAccept={accept}
                      onClose={() => setFixing(false)}
                    />
                  )}
                </div>
              </section>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            className="space-y-3 rounded-xl border border-line p-4"
          >
            <label htmlFor="reply" className="text-sm font-medium">
              Reply as the customer (both agents get the same message)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="reply"
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                disabled={busy || fixing || open.length === 0}
                placeholder={
                  open.length === 0
                    ? "Both conversations have ended. Start over to try again."
                    : "Type a reply..."
                }
                className="flex-1 rounded-md border border-line px-3 py-2 disabled:bg-neutral-50"
              />
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <span className="sr-only">When the customer replies</span>
                <select
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                  disabled={busy || fixing || open.length === 0}
                  className="rounded-md border border-line bg-white px-2 py-2"
                  aria-label="When the customer replies"
                >
                  {DELAYS.map((d) => (
                    <option key={d.ms} value={d.ms}>
                      Reply {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy || fixing || !text.trim() || open.length === 0}
                className="rounded-md bg-accent-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Waiting for both agents..." : "Send"}
              </button>
              <button
                type="button"
                onClick={goQuiet}
                disabled={busy || fixing || quiet.length === 0}
                title="The customer does not reply. Each agent decides when and how to follow up."
                className="rounded-md border border-line px-3 py-2 text-sm font-medium enabled:hover:border-accent disabled:opacity-50"
              >
                Customer goes quiet
              </button>
            </div>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Suggested replies"
            >
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy || fixing || open.length === 0}
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 enabled:hover:border-accent enabled:hover:text-accent-ink disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {model
                ? `Each agent reply is one call to ${model}, two if the guard asks for a rewrite. Only lessons you accept are saved.`
                : "Mock agent: code writes the replies, no AI calls. The guard and checks still run. Only lessons you accept are saved."}
            </p>
          </form>
        </>
      )}

      <LessonsPanel
        lessons={lessons}
        setLessons={setLessons}
        off={lessonsOff}
        canDelete={canDelete}
      />
    </div>
  );
}

// "What the agent knows", worked out by code from the conversation after the latest reply.
function Knows({ state }: { state: LiveState }) {
  const rows: [string, string][] = [
    ["Balance", state.balance],
    ["Plan offered", state.planOffered ? "yes" : "not yet"],
    ["Promised to pay", state.promisedOn ?? "no date"],
    ["Contact after", state.contactAfter ?? "any time 8am to 9pm"],
    ["Stopped", state.stopped ? "yes" : "no"],
    ["Disputed", state.disputed ? "yes" : "no"],
    ["Handed to a person", state.handedOff ? "yes" : "no"],
    ["Latest reply sent", state.lastSent ?? "nothing sent"],
    ["Follows up if no reply", state.nextFollowUp ?? "no: the conversation has ended"],
  ];
  return (
    <details className="border-b border-line bg-white px-4 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-ink-2">What the agent knows</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
