"use client";

import { useState } from "react";
import ConversationDetail, { type DetailMessage } from "./ConversationDetail";

export interface BrowserRow {
  id: number;
  name: string;
  meta: string;
  outcome: string;
  handedToHuman: boolean;
  amount: string;
}

// Conversation list plus the message player. All messages arrive with the page, so choosing one is instant.
export default function ConversationBrowser({ rows, messages }: { rows: BrowserRow[]; messages: Record<number, DetailMessage[]> }) {
  const [selected, setSelected] = useState<number | null>(rows[0]?.id ?? null);
  const row = rows.find((r) => r.id === selected);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="max-h-[36rem] overflow-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="px-3 py-2 font-medium">
                Customer
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Outcome
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Recovered by cutoff
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const active = r.id === selected;
              return (
                // The whole row is clickable; the name stays a real button for keyboard and screen reader users.
                <tr
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`cursor-pointer border-b border-line last:border-0 ${active ? "bg-tint" : "hover:bg-tint/60"}`}
                >
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => setSelected(r.id)}
                      aria-pressed={active}
                      className={`text-left font-medium ${active ? "text-accent-ink" : "text-ink hover:text-accent-ink"} underline-offset-2 hover:underline`}
                    >
                      {r.name}
                    </button>
                    <div className="text-xs text-muted">{r.meta}</div>
                  </th>
                  <td className="px-3 py-2">
                    {r.outcome}
                    {r.handedToHuman && <span className="ml-1.5 whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900">handed to person</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.amount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        {row ? (
          <ConversationDetail key={row.id} title={`${row.name}: ${row.outcome}`} messages={messages[row.id] ?? []} />
        ) : (
          <p className="text-sm text-muted">No conversations in this run.</p>
        )}
      </div>
    </div>
  );
}
