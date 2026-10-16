"use client";

import { useState } from "react";
import Thread from "./Thread";
import { checkText, verdictText } from "./verdict";

export interface DetailMessage {
  seq: number;
  role: "agent" | "customer" | "system";
  body: string;
  when: string; // already formatted in the account's local time
  guardFlags: string[];
  checks: { name: string; passed: boolean | null; detail: string }[];
  notes?: string[]; // live page only: the guard's steps for this reply, in plain words
}

export const stepIndex = (i: number, delta: number, length: number) => Math.min(Math.max(i + delta, 0), Math.max(length - 1, 0));

const VERDICT_STYLE = { pass: "bg-pass-bg text-pass", fail: "bg-fail-bg text-fail", "n/a": "bg-neutral-100 text-muted" } as const;

// Steps through a conversation one message at a time; earlier messages stay for context.
export default function ConversationDetail({ title, messages, initialIndex = 0 }: { title: string; messages: DetailMessage[]; initialIndex?: number }) {
  const [index, setIndex] = useState(stepIndex(initialIndex, 0, messages.length));
  if (messages.length === 0) return <p className="text-sm text-muted">No messages in this conversation.</p>;
  const current = messages[index];
  const step = (d: number) => setIndex((i) => stepIndex(i, d, messages.length));
  const btn = "rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium enabled:hover:border-accent enabled:hover:text-accent-ink disabled:text-muted disabled:opacity-60";

  return (
    <section aria-label={`Conversation: ${title}`} className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-3">
        <h3 className="mr-auto font-semibold leading-tight">{title}</h3>
        <span aria-live="polite" className="text-sm text-muted">
          Message {index + 1} of {messages.length}
        </span>
        <button type="button" onClick={() => step(-1)} disabled={index === 0} className={btn}>
          Previous
        </button>
        <button type="button" onClick={() => step(1)} disabled={index === messages.length - 1} className={btn}>
          Next
        </button>
      </div>

      <div className="bg-tint/60 px-4 py-4">
        <Thread messages={messages.slice(0, index + 1)} current={index} />
      </div>

      {current.checks.length > 0 && (
        <div className="border-t border-line bg-white px-4 py-3">
          <h4 className="text-sm font-semibold">Checks on this message</h4>
          <ul className="mt-2 space-y-1.5 text-sm">
            {current.checks.map((c) => {
              const v = verdictText(c.passed);
              return (
                <li key={c.name} className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${VERDICT_STYLE[v]}`}>{v}</span>
                  <span>{checkText(c.name)}</span>
                  {c.detail && v === "fail" && <span className="text-ink-2">{c.detail}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
