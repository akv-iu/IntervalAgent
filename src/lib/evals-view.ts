// Shapes recorded eval results for the Evals page. Every sentence is computed from the data.
import type { DetailMessage } from "@/components/ConversationDetail";
import { checkText, flagText } from "@/components/verdict";

export type Version = "baseline" | "guarded";
export interface CellData {
  passed: number;
  applicable: number;
  failed: string[];
  outcome: string;
  checks: { name: string; hard: boolean; passed: boolean | null; detail: string }[];
  messages: DetailMessage[];
}
export interface ScenarioRow {
  id: string;
  title: string;
  cells: Record<Version, CellData>;
}

export function headline(rows: ScenarioRow[]) {
  const broken = (v: Version) => rows.filter((r) => r.cells[v].failed.length > 0).map((r) => r.id);
  return { total: rows.length, baselineBroken: broken("baseline"), guardedBroken: broken("guarded") };
}

export function resultSentence(who: string, c: CellData): string {
  if (c.failed.length === 0) return `${who} passed all ${c.applicable} applicable hard checks.`;
  const names = c.failed.map(checkText);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${who} failed ${list} (${c.passed} of ${c.applicable} hard checks passed).`;
}

// What the guard did in one guarded conversation, in plain words. A stop leaves no message flag
// (nothing is sent), so it is read from the stop_honored check instead.
export function guardStory(c: CellData): string {
  const acts = [...new Set(c.messages.flatMap((m) => m.guardFlags))].map(flagText);
  if (c.checks.some((x) => x.name === "stop_honored" && x.passed === true)) acts.push("read the stop request and sent nothing more");
  return acts.length ? `What the guard did: ${acts.join(", ")}.` : "The guard did not need to step in; the model's messages passed as written.";
}

export function guardActions(rows: ScenarioRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) for (const m of r.cells.guarded.messages) for (const f of m.guardFlags) out[f] = (out[f] ?? 0) + 1;
  return out;
}
