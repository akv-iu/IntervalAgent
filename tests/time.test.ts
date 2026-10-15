import { localHour, localToInstant, scheduleInWindow, SIM_DATE, type Tz } from "../src/lib/time";

function hm(d: Date, tz: Tz): [number, number] {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
  return [+p.find((x) => x.type === "hour")!.value, +p.find((x) => x.type === "minute")!.value];
}

const zones: Tz[] = ["America/Denver", "America/New_York"];

describe.each(zones)("window boundaries in %s", (tz) => {
  test("07:59 moves to 08:00 same day", () => {
    const out = scheduleInWindow(localToInstant(SIM_DATE, 7, 59, tz), tz);
    expect(out.getTime()).toBe(localToInstant(SIM_DATE, 8, 0, tz).getTime());
  });
  test("08:00 is allowed as-is", () => {
    const t = localToInstant(SIM_DATE, 8, 0, tz);
    expect(scheduleInWindow(t, tz).getTime()).toBe(t.getTime());
  });
  test("20:59 is allowed as-is", () => {
    const t = localToInstant(SIM_DATE, 20, 59, tz);
    expect(scheduleInWindow(t, tz).getTime()).toBe(t.getTime());
  });
  test("21:00 moves to 08:00 next day", () => {
    const out = scheduleInWindow(localToInstant(SIM_DATE, 21, 0, tz), tz);
    expect(out.getTime()).toBe(localToInstant("2026-03-11", 8, 0, tz).getTime());
  });
});

test("localToInstant converts local wall time", () => {
  expect(hm(localToInstant(SIM_DATE, 10, 30, "America/New_York"), "America/New_York")).toEqual([10, 30]);
  // 2026-03-10 Denver is MDT (UTC-6)
  expect(localToInstant(SIM_DATE, 10, 0, "America/Denver").toISOString()).toBe("2026-03-10T16:00:00.000Z");
});

test("DST: Denver 08:00 on 03-07 (MST) to 03-09 (MDT) is 47h apart", () => {
  const a = localToInstant("2026-03-07", 8, 0, "America/Denver").getTime();
  const b = localToInstant("2026-03-09", 8, 0, "America/Denver").getTime();
  expect(b - a).toBe(47 * 3600_000);
});

test("localHour is fractional local hour", () => {
  expect(localHour(localToInstant(SIM_DATE, 20, 30, "America/Denver"), "America/Denver")).toBe(20.5);
});

test("month end rolls to next month", () => {
  const out = scheduleInWindow(localToInstant("2026-03-31", 22, 0, "America/Denver"), "America/Denver");
  expect(out.getTime()).toBe(localToInstant("2026-04-01", 8, 0, "America/Denver").getTime());
});
