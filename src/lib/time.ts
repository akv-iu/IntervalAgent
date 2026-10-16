// Local wall time <-> UTC instants using Intl (handles DST). No date library.
export const SIM_DATE = "2026-03-10";
export type Tz = "America/Denver" | "America/New_York";

const WINDOW_START = 8;
const WINDOW_END = 21; // exclusive

function localParts(instant: Date, tz: Tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

export function localToInstant(date: string, hour: number, minute: number, tz: Tz): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, d, hour, minute);
  let guess = wall;
  // Two passes settle the offset across a DST change.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    guess += wall - seen;
  }
  return new Date(guess);
}

export function localHour(instant: Date, tz: Tz): number {
  const p = localParts(instant, tz);
  return p.h + p.mi / 60 + p.s / 3600;
}

export function localDate(instant: Date, tz: Tz, addDays = 0): string {
  const p = localParts(instant, tz);
  return new Date(Date.UTC(p.y, p.mo - 1, p.d + addDays)).toISOString().slice(0, 10);
}

export function scheduleInWindow(instant: Date, tz: Tz): Date {
  const h = localHour(instant, tz);
  if (h < WINDOW_START) return localToInstant(localDate(instant, tz), WINDOW_START, 0, tz);
  if (h >= WINDOW_END) return localToInstant(localDate(instant, tz, 1), WINDOW_START, 0, tz);
  return instant;
}

export function inWindow(instant: Date, tz: Tz): boolean {
  const h = localHour(instant, tz);
  return h >= WINDOW_START && h < WINDOW_END;
}

// Inside the window, wait until a customer-requested hour (8 <= hour < 21) on the same local day.
export function notBeforeHour(instant: Date, hour: number, tz: Tz): Date {
  const at = scheduleInWindow(instant, tz);
  if (localHour(at, tz) >= hour) return at;
  return localToInstant(localDate(at, tz), Math.floor(hour), Math.round((hour % 1) * 60), tz);
}
