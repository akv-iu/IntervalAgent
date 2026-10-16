import type { DetailMessage } from "./ConversationDetail";
import { flagText } from "./verdict";

const WHO = { agent: "Agent", customer: "Customer (scripted)", system: "System note" } as const;

// Text-message style thread. The agent writes on the right in blue, the scripted customer on the left.
export default function Thread({ messages, current }: { messages: DetailMessage[]; current?: number }) {
  return (
    <ol className="space-y-3">
      {messages.map((m, i) => {
        const mine = m.role === "agent";
        return (
          <li key={m.seq} className={`flex flex-col ${mine ? "items-end" : m.role === "system" ? "items-center" : "items-start"}`}>
            <span className="mb-1 text-xs text-muted">
              {WHO[m.role]}, {m.when}
            </span>
            <p
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                mine ? "rounded-br-sm bg-accent-ink text-white" : m.role === "system" ? "bg-amber-50 text-amber-900" : "rounded-bl-sm border border-line bg-white"
              } ${i === current ? "ring-2 ring-accent ring-offset-2 ring-offset-tint" : ""}`}
            >
              {m.body}
            </p>
            {m.guardFlags.length > 0 && <span className="mt-1 text-xs font-medium text-accent-ink">Guard: {m.guardFlags.map(flagText).join(", ")}</span>}
          </li>
        );
      })}
    </ol>
  );
}
