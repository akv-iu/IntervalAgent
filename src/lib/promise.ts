// The local date a customer promised to pay, read from their text. Live Try page only.
// ponytail: weekday names, tomorrow, next week, next month, "the 20th", in a clause that says the customer
// will pay (or start paying) and does not negate it; anything else is no promise.
import { FIRM_REFUSAL } from "./situations";
import { localDate, type Tz } from "./time";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PAYS = /\b(pay|paid|start|begin)\b/i; // a verb: "about my payment" is not a promise
const NEGATED = /\b(can'?t|cannot|can not|won'?t|will not|not|never|don'?t|do not|unable)\b/i;
const clauses = (text: string) => text.split(/(?<=[.!?])\s+|[,;:]\s*|\s+but\s+/i);

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function dateIn(clause: string, today: string): string | null {
  const [y, m, d] = today.split("-").map(Number);
  const t = clause.toLowerCase();
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\bnext week\b/.test(t)) return addDays(today, 7);
  if (/\bnext month\b/.test(t)) return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const day = DAYS.findIndex((name) => new RegExp(String.raw`\b${name}\b`).test(t));
  if (day >= 0) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDays(today, (day - weekday + 7) % 7 || 7); // the same weekday means next week's
  }

  const nth = t.match(/\bthe (\d{1,2})(?:st|nd|rd|th)?\b/);
  if (nth) {
    const want = Number(nth[1]);
    if (want < 1 || want > 31) return null;
    // This month if still ahead, else next month; clamp to the month's last day (the 31st in April is the 30th).
    const month = want > d ? m - 1 : m;
    const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, month, Math.min(want, last))).toISOString().slice(0, 10);
  }
  return null;
}

export function parsePromise(text: string, sentAt: Date, tz: Tz): string | null {
  if (FIRM_REFUSAL.test(text)) return null;
  const today = localDate(sentAt, tz);
  for (const c of clauses(text)) {
    if (!PAYS.test(c) || NEGATED.test(c)) continue;
    const date = dateIn(c, today);
    if (date) return date;
  }
  return null;
}
