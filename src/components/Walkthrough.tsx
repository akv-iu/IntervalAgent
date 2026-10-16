"use client";

import { useState } from "react";
import type { CellData } from "@/lib/evals-view";
import Thread from "./Thread";

export interface WalkExample {
  id: string;
  title: string;
  tests: string; // what this case checks, written by hand
  setup: string; // computed from the account and scenario
  why: string; // why it matters, written by hand
  baseline: CellData;
  guarded: CellData;
  baselineSentence: string; // computed
  guardedSentence: string; // computed
  guardStory: string; // computed
}

const STEPS = ["The setup", "Simple agent (baseline)", "Careful agent (guarded)", "What the checks found"] as const;

function Result({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={`rounded-md px-3 py-2 text-sm font-medium ${ok ? "bg-pass-bg text-pass" : "bg-fail-bg text-fail"}`}>
      {ok ? "Pass. " : "Fail. "}
      {text}
    </p>
  );
}

// Five recorded cases, each walked through in four steps.
export default function Walkthrough({ examples }: { examples: WalkExample[] }) {
  const [ex, setEx] = useState(0);
  const [step, setStep] = useState(0);
  const e = examples[ex];
  const btn = "rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium enabled:hover:border-accent enabled:hover:text-accent-ink disabled:text-muted disabled:opacity-60";

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap gap-1 border-b border-line bg-white p-2" role="group" aria-label="Choose a case">
        {examples.map((x, i) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={i === ex}
            onClick={() => {
              setEx(i);
              setStep(0);
            }}
            className={`rounded-md px-3 py-1.5 text-left text-sm ${i === ex ? "bg-accent-ink text-white" : "text-ink-2 hover:bg-tint hover:text-accent-ink"}`}
          >
            <span className="font-semibold">{x.id}</span> {x.title}
          </button>
        ))}
      </div>

      <div className="grid gap-0 md:grid-cols-[13rem_minmax(0,1fr)]">
        <ol className="flex gap-1 overflow-x-auto border-b border-line bg-tint/60 p-3 md:flex-col md:border-r md:border-b-0" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm ${i === step ? "bg-white font-semibold text-accent-ink shadow-sm" : "text-ink-2 hover:text-accent-ink"}`}
              >
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${i <= step ? "bg-accent-ink text-white" : "bg-white text-muted ring-1 ring-line"}`}>{i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>

        <div className="p-4 sm:p-5" aria-live="polite">
          <h3 className="text-lg font-semibold tracking-tight">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </h3>

          {step === 0 && (
            <div className="mt-3 max-w-2xl space-y-3 text-ink-2">
              <p>{e.tests}</p>
              <p>{e.setup}</p>
              <p className="text-sm text-muted">Both agents use the same model and see the same account facts. Only the instructions and the code guard differ.</p>
            </div>
          )}

          {step === 1 && (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg bg-tint/60 p-3">
                <Thread messages={e.baseline.messages} />
              </div>
              <Result ok={e.baseline.failed.length === 0} text={e.baselineSentence} />
            </div>
          )}

          {step === 2 && (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg bg-tint/60 p-3">
                <Thread messages={e.guarded.messages} />
              </div>
              <p className="text-sm text-ink-2">{e.guardStory}</p>
              <Result ok={e.guarded.failed.length === 0} text={e.guardedSentence} />
            </div>
          )}

          {step === 3 && (
            <div className="mt-3 max-w-2xl space-y-3">
              <Result ok={e.baseline.failed.length === 0} text={e.baselineSentence} />
              <Result ok={e.guarded.failed.length === 0} text={e.guardedSentence} />
              <p className="text-ink-2">{e.why}</p>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button type="button" className={btn} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Previous
            </button>
            <button type="button" className={btn} disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
