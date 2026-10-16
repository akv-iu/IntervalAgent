// Display helpers for the pages. Money stays integer cents until it is shown.
import type { DetailMessage } from "@/components/ConversationDetail";
import type { MessageRow } from "./reports";

export { formatCents } from "./money";

export const pct = (x: number | null, digits = 1) => (x === null ? "n/a" : `${(x * 100).toFixed(digits)}%`);
export const pts = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} pts`;

export function formatLocal(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}

export function toDetailMessages(rows: MessageRow[], timeZone: string): DetailMessage[] {
  return rows.map((m) => ({ seq: m.seq, role: m.role, body: m.body, when: formatLocal(m.sentAt, timeZone), guardFlags: m.guardFlags, checks: m.checks }));
}

export const OUTCOME_LABEL: Record<string, string> = {
  agreed_to_pay: "Agreed to pay in full",
  payment_plan: "Payment plan",
  promise_to_pay: "Promise to pay",
  disputed: "Disputed",
  stopped: "Asked to stop",
  no_response: "No resolution",
};
