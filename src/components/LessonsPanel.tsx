"use client";

import { useState } from "react";
import type { Lesson } from "@/lib/lessons";
import { LessonCard } from "./LessonsLog";

interface Recheck {
  id: number;
  text: string;
  action: string;
  when: string;
  verdict: string;
}

async function post(body: unknown) {
  const res = await fetch("/api/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? `request failed (${res.status})`);
  return out;
}

// The lessons this copy has learned: turn them on or off, delete them, or replay each saved moment.
// canDelete: false on the public site, where visitors can turn lessons off and on but not delete them.
export default function LessonsPanel({
  lessons,
  setLessons,
  off,
  canDelete,
}: {
  lessons: Lesson[];
  setLessons: (l: Lesson[]) => void;
  off: string | null;
  canDelete: boolean;
}) {
  const [checks, setChecks] = useState<Record<number, Recheck>>({});
  const [page, setPage] = useState(0);
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
  const active = lessons.filter((l) => l.active).length;

  return (
    <section aria-label="Lessons learned" className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Lessons learned</h2>
          <p className="text-sm text-ink-2">
            The AI model never changes. The agent reads soft lessons. The code enforces hard rules. Built-in rules always come first.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || active === 0 || Boolean(off)}
          onClick={() =>
            act(async () => {
              const out = await post({ op: "recheck", page });
              const results = out.results as (Recheck & { lessonsUsed: number[] })[];
              setChecks((c) => ({ ...c, ...Object.fromEntries(results.map((r) => [r.id, r])) }));
              // Each replay is a reply sent with lessons; the server counted it, so the panel does too.
              const used = results.flatMap((r) => r.lessonsUsed);
              setLessons(lessons.map((l) => ({ ...l, timesUsed: l.timesUsed + used.filter((id) => id === l.id).length })));
              setPage(out.next ?? 0);
            })
          }
          className="rounded-md border border-line px-3 py-1.5 text-sm font-medium enabled:hover:border-accent disabled:opacity-50"
        >
          {busy ? "Working..." : page === 0 ? `Recheck lessons (${Math.min(active, 8)} ${Math.min(active, 8) === 1 ? "reply" : "replies"})` : `Recheck the next ${Math.min(active - page * 8, 8)}`}
        </button>
      </div>
      {off && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{off}</p>}
      {error && (
        <p role="alert" className="rounded-md bg-fail-bg px-3 py-2 text-sm text-fail">
          {error}
        </p>
      )}
      {lessons.length === 0 ? (
        <p className="text-sm text-muted">No lessons yet. Click &quot;Fix this&quot; under a guarded reply to teach one.</p>
      ) : (
        <ol className="space-y-3">
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l}>
              {checks[l.id] && (
                <p className="mt-2 rounded-md border border-line px-2 py-1.5 text-xs text-ink-2">
                  <span className="font-semibold text-ink">Recheck, {checks[l.id].verdict}:</span> {checks[l.id].text || `(nothing sent; ${checks[l.id].action})`}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => act(async () => setLessons((await post({ op: "toggle", id: l.id, active: !l.active })).lessons))} className="rounded-md border border-line px-2 py-1 text-xs">
                  {l.active ? "Turn off" : "Turn on"}
                </button>
                {canDelete && (
                  <button type="button" disabled={busy} onClick={() => act(async () => setLessons((await post({ op: "delete", id: l.id })).lessons))} className="rounded-md border border-line px-2 py-1 text-xs text-fail">
                    Delete
                  </button>
                )}
              </div>
            </LessonCard>
          ))}
        </ol>
      )}
    </section>
  );
}
