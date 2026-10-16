"use client";

import { useState } from "react";
import { type DraftLesson, HARD_RULES, type HardRule, MAX_INSTRUCTION, REASONS } from "@/lib/lessons";

export interface RetryResult {
  text: string;
  action: string;
  trace: string[];
}

const MAX_TRIES = 3;

// What each hard rule makes the code check, in words a viewer can follow.
const RULE_CHECK: Record<HardRule, string> = {
  no_close: "the agent must not end the conversation",
  mention_plan: "the agent must offer the payment plan amounts",
  offer_person: "the agent must offer someone on our team",
  handoff: "the agent must hand off to a person",
};

const suggestionFor = (reason: DraftLesson["reason"]) => REASONS.find((r) => r.id === reason)!.suggest;

// Correct the latest guarded reply: write a lesson, retry the same moment with it, then keep or drop it.
export default function FixPanel({
  before,
  situation,
  onRetry,
  onAccept,
  onClose,
}: {
  before: string;
  situation: string; // e.g. "refuses to pay": how the code read the customer's message
  onRetry: (d: DraftLesson) => Promise<RetryResult>;
  onAccept: (d: DraftLesson, after: RetryResult) => Promise<void>;
  onClose: () => void;
}) {
  // Starts with the suggestion for "Gave up too early"; picking another reason swaps in its suggestion
  // until the person edits the text or the rule themselves.
  const [draft, setDraft] = useState<DraftLesson>(() => ({ reason: "gave_up", ...suggestionFor("gave_up"), appliesTo: "situation" }));
  const [edited, setEdited] = useState({ instruction: false, hardRule: false });
  const [after, setAfter] = useState<RetryResult | null>(null);
  const [tested, setTested] = useState<DraftLesson | null>(null); // the exact lesson that produced "after"
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const retry = () =>
    act(async () => {
      const tried = draft;
      const result = await onRetry(tried);
      setTested(tried);
      setAfter(result);
      setTries((t) => t + 1);
    });
  const pickReason = (reason: DraftLesson["reason"]) => {
    const s = suggestionFor(reason);
    setDraft((d) => {
      const hardRule = edited.hardRule ? d.hardRule : s.hardRule;
      return {
        ...d,
        reason,
        instruction: edited.instruction ? d.instruction : s.instruction,
        hardRule,
        appliesTo: hardRule === "handoff" ? "situation" : d.appliesTo,
      };
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-accent bg-white p-3 text-sm" role="group" aria-label="Fix this reply">
      {!after ? (
        <fieldset disabled={busy} className="space-y-3">
          <p className="text-xs text-ink-2">Teach the agent what to do next time. The AI model itself never changes.</p>
          <label className="flex flex-col gap-1 font-medium">
            What went wrong
            <select value={draft.reason} onChange={(e) => pickReason(e.target.value as DraftLesson["reason"])} className="rounded-md border border-line px-2 py-1.5 font-normal">
              {REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted">Fills in a suggested lesson. Edit it freely.</span>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            What should the agent do instead?
            <textarea
              value={draft.instruction}
              maxLength={MAX_INSTRUCTION}
              rows={3}
              onChange={(e) => {
                setEdited((x) => ({ ...x, instruction: true }));
                setDraft({ ...draft, instruction: e.target.value });
              }}
              placeholder="For example: Do not close. Acknowledge it, and offer the payment plan or someone on our team."
              className="rounded-md border border-line px-2 py-1.5 font-normal"
            />
            <span className="text-xs font-normal text-muted">
              {draft.instruction.length}/{MAX_INSTRUCTION}. Soft lesson: the agent reads this and usually follows it.
            </span>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Make it a hard rule? (optional)
            <select
              value={draft.hardRule ?? ""}
              onChange={(e) => {
                const hardRule = (e.target.value || null) as DraftLesson["hardRule"];
                setEdited((x) => ({ ...x, hardRule: true }));
                setDraft({ ...draft, hardRule, appliesTo: hardRule === "handoff" ? "situation" : draft.appliesTo });
              }}
              className="rounded-md border border-line px-2 py-1.5 font-normal"
            >
              <option value="">No, soft lesson only</option>
              {HARD_RULES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted">
              {draft.hardRule
                ? `Hard rule: ${RULE_CHECK[draft.hardRule]}. The code checks every reply; if the agent misses it, the reply is rewritten.`
                : "A hard rule is checked by code on every reply, so it always holds."}
            </span>
          </label>
          <fieldset className="space-y-1">
            <legend className="font-medium">When should the agent use it?</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="scope" checked={draft.appliesTo === "situation"} onChange={() => setDraft({ ...draft, appliesTo: "situation" })} className="mt-1" />
              <span>Only when the customer {situation}</span>
            </label>
            <label className={`flex items-start gap-2 ${draft.hardRule === "handoff" ? "opacity-50" : ""}`}>
              <input
                type="radio"
                name="scope"
                checked={draft.appliesTo === "all"}
                disabled={draft.hardRule === "handoff"}
                onChange={() => setDraft({ ...draft, appliesTo: "all" })}
                className="mt-1"
              />
              <span>
                On every reply
                {draft.hardRule === "handoff" && <span className="text-xs text-muted"> (not with hand-off: it would end every conversation)</span>}
              </span>
            </label>
            <p className="text-xs text-muted">Never on the first message, which has fixed rules.</p>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={retry} disabled={busy || !draft.instruction.trim() || tries >= MAX_TRIES} className="rounded-md bg-accent-ink px-3 py-1.5 font-semibold text-white disabled:opacity-60">
              {busy ? "Retrying..." : "Retry with this lesson"}
            </button>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-line px-3 py-1.5">
              Cancel
            </button>
            {tries >= MAX_TRIES && <span className="self-center text-xs text-muted">Three tries used. Discard, or accept the last reply.</span>}
          </div>
        </fieldset>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="rounded-md bg-fail-bg/60 px-2 py-1.5 text-ink-2">
              <span className="font-semibold text-fail">Before:</span> {before || "(nothing sent)"}
            </p>
            <p className="rounded-md bg-pass-bg/60 px-2 py-1.5 text-ink-2">
              <span className="font-semibold text-pass">After, with your lesson:</span> {after.text || `(nothing sent; the agent chose ${after.action})`}
            </p>
          </div>
          {after.trace.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted" aria-label="What the guard did">
              {after.trace.map((n, k) => (
                <li key={k}>{n}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => act(() => onAccept(tested!, after))} disabled={busy || !after.text} className="rounded-md bg-accent-ink px-3 py-1.5 font-semibold text-white disabled:opacity-60">
              {busy ? "Saving..." : "Accept: save the lesson and use this reply"}
            </button>
            <button type="button" onClick={() => setAfter(null)} disabled={busy || tries >= MAX_TRIES} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-50">
              Edit and retry ({MAX_TRIES - tries} left)
            </button>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-line px-3 py-1.5">
              Discard: save nothing
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-fail-bg px-2 py-1 text-fail">
          {error}
        </p>
      )}
    </div>
  );
}
