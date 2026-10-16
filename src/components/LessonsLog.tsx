// One saved lesson, and the read-only list the public site shows. No hooks: usable from server pages and client components.
import { HARD_RULES, type Lesson, REASONS } from "@/lib/lessons";
import { situationLabel } from "@/lib/situations";
import type { ReactNode } from "react";

const label = (list: readonly { id: string; label: string }[], id: string | null) => list.find((x) => x.id === id)?.label ?? id;

export function LessonCard({ lesson: l, children }: { lesson: Lesson; children?: ReactNode }) {
  return (
    <li className={`rounded-lg border p-3 text-sm ${l.active ? "border-line" : "border-dashed border-line bg-neutral-50"}`}>
      {/* Only the content fades when a lesson is off; the controls passed in as children stay at full strength. */}
      <div className={l.active ? "" : "opacity-60"}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold text-ink">
            Lesson #{l.id}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${l.hardRule ? "bg-tint-2 text-accent-ink" : "bg-neutral-100 text-ink-2"}`}>
              {l.hardRule ? `hard rule: ${label(HARD_RULES, l.hardRule)}` : "soft: the agent reads it"}
            </span>
          </p>
          <p className="text-xs text-muted">
            <span className={`mr-1.5 rounded-full px-2 py-0.5 font-medium ${l.active ? "bg-pass-bg text-pass" : "bg-neutral-200 text-ink-2"}`}>
              {l.active ? "On" : "Off, not used"}
            </span>
            used in {l.timesUsed} {l.timesUsed === 1 ? "reply" : "replies"}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          Applies {l.appliesTo === "all" ? "to every reply after the first message" : `when the customer ${situationLabel(l.situation)}`}. Reason:{" "}
          {label(REASONS, l.reason)}.
        </p>
        <p className="mt-1 text-ink-2">{l.instruction}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <p className="rounded-md bg-fail-bg/60 px-2 py-1.5 text-xs text-ink-2">
            <span className="font-semibold text-fail">Before:</span> {l.beforeText || "(nothing sent)"}
          </p>
          <p className="rounded-md bg-pass-bg/60 px-2 py-1.5 text-xs text-ink-2">
            <span className="font-semibold text-pass">After:</span> {l.afterText}
          </p>
        </div>
      </div>
      {children}
    </li>
  );
}

export default function LessonsLog({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length === 0) return <p className="text-sm text-muted">No lessons recorded yet.</p>;
  return (
    <ol className="space-y-3">
      {lessons.map((l) => (
        <LessonCard key={l.id} lesson={l} />
      ))}
    </ol>
  );
}
