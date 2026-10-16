"use client";

import { useState } from "react";
import type { ScenarioRow, Version } from "@/lib/evals-view";
import ConversationDetail from "./ConversationDetail";
import { checkText, verdictText } from "./verdict";

const VERSIONS: Version[] = ["baseline", "guarded"];
const NAME: Record<Version, string> = { baseline: "Baseline", guarded: "Guarded" };
const PILL = { pass: "bg-pass-bg text-pass", fail: "bg-fail-bg text-fail", "n/a": "bg-neutral-100 text-muted" } as const;

function Pill({ passed }: { passed: boolean | null }) {
  const v = verdictText(passed);
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PILL[v]}`}>{v}</span>;
}

// All 12 scenarios; choosing one shows both agents' conversations side by side with their verdicts.
export default function EvalBrowser({ rows, initialId }: { rows: ScenarioRow[]; initialId: string }) {
  const [selId, setSelId] = useState(initialId);
  const row = rows.find((r) => r.id === selId) ?? rows[0];
  const checkNames = row.cells.guarded.checks.map((c) => c.name);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="px-3 py-2 font-medium">
                Scenario
              </th>
              {VERSIONS.map((v) => (
                <th key={v} scope="col" className="px-3 py-2 font-medium">
                  {NAME[v]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const active = r.id === row.id;
              return (
                <tr key={r.id} onClick={() => setSelId(r.id)} className={`cursor-pointer border-b border-line align-top last:border-0 ${active ? "bg-tint" : "hover:bg-tint/60"}`}>
                  <th scope="row" className="px-3 py-2.5 text-left font-normal">
                    <button type="button" aria-pressed={active} onClick={() => setSelId(r.id)} className="text-left">
                      <span className="font-semibold">{r.id}</span> <span className={active ? "text-accent-ink" : "text-ink-2"}>{r.title}</span>
                    </button>
                  </th>
                  {VERSIONS.map((v) => {
                    const c = r.cells[v];
                    return (
                      <td key={v} className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <Pill passed={c.failed.length === 0} />
                          <span className="tabular-nums">
                            {c.passed}/{c.applicable} hard
                          </span>
                        </span>
                        {c.failed.length > 0 && <span className="mt-0.5 block text-xs text-fail">failed: {c.failed.map(checkText).join(", ")}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section aria-label={`${row.id} side by side`} className="space-y-4">
        <h3 className="text-lg font-semibold tracking-tight">
          {row.id} {row.title}: same customer, two agents
        </h3>
        <div className="grid gap-5 lg:grid-cols-2">
          {VERSIONS.map((v) => (
            <ConversationDetail key={`${row.id}-${v}`} title={`${NAME[v]}: ${row.cells[v].outcome}`} messages={row.cells[v].messages} initialIndex={row.cells[v].messages.length - 1} />
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  Check
                </th>
                {VERSIONS.map((v) => (
                  <th key={v} scope="col" className="px-3 py-2 font-medium">
                    {NAME[v]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checkNames.map((name) => (
                <tr key={name} className="border-b border-line align-top last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {checkText(name)}
                    {!row.cells.guarded.checks.find((c) => c.name === name)?.hard && <span className="text-muted"> (soft)</span>}
                  </th>
                  {VERSIONS.map((v) => {
                    const c = row.cells[v].checks.find((x) => x.name === name);
                    return (
                      <td key={v} className="px-3 py-2">
                        <Pill passed={c?.passed ?? null} />
                        {c?.detail && c.passed === false && <span className="mt-0.5 block text-xs text-ink-2">{c.detail}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
