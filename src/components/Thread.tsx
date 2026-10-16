import type { DetailMessage } from "./ConversationDetail";
import { checkText, flagText } from "./verdict";

const WHO = { agent: "Agent", customer: "Customer (scripted)", system: "System note" } as const;

// Text-message style thread. The agent writes on the right in blue, the scripted customer on the left.
function checksLine(m: DetailMessage): string | null {
  if (!m.checks.length) return null;
  const failed = m.checks.filter((c) => c.passed === false).map((c) => checkText(c.name));
  return failed.length ? `Checks: failed ${failed.join(", ")}` : `Checks: all ${m.checks.length} passed`;
}

export default function Thread({
  messages,
  current,
  showChecks = false,
  customer = WHO.customer,
}: {
  messages: DetailMessage[];
  current?: number;
  showChecks?: boolean;
  customer?: string;
}) {
  return (
    <ol className="space-y-3">
      {messages.map((m, i) => {
        const mine = m.role === "agent";
        return (
          <li key={m.seq} className={`flex flex-col ${mine ? "items-end" : m.role === "system" ? "items-center" : "items-start"}`}>
            <span className="mb-1 text-xs text-muted">
              {m.role === "customer" ? customer : WHO[m.role]}, {m.when}
            </span>
            <p
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                mine ? "rounded-br-sm bg-accent-ink text-white" : m.role === "system" ? "bg-amber-50 text-amber-900" : "rounded-bl-sm border border-line bg-white"
              } ${i === current ? "ring-2 ring-accent ring-offset-2 ring-offset-tint" : ""}`}
            >
              {m.body}
            </p>
            {m.guardFlags.length > 0 && <span className="mt-1 text-xs font-medium text-accent-ink">Guard: {m.guardFlags.map(flagText).join(", ")}</span>}
            {m.notes && m.notes.length > 0 && (
              <ul className="mt-1 max-w-[88%] space-y-0.5 text-right text-xs text-muted" aria-label="What the guard did">
                {m.notes.map((n, k) => (
                  <li key={k}>{n}</li>
                ))}
              </ul>
            )}
            {showChecks && checksLine(m) && (
              <span className={`mt-0.5 text-xs font-medium ${m.checks.some((c) => c.passed === false) ? "text-fail" : "text-pass"}`}>{checksLine(m)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
