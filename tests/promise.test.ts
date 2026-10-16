import { parsePromise } from "../src/lib/promise";

// 2026-03-10 is a Tuesday.
const at = (iso: string) => new Date(iso);

describe("parsePromise: the local date a customer promised to pay", () => {
  test.each([
    ["I'll pay Friday.", "2026-03-10T17:00:00.000Z", "America/Denver", "2026-03-13"],
    ["I can pay on the 20th", "2026-03-25T17:00:00.000Z", "America/Denver", "2026-04-20"],
    ["I get paid on the 20th, I'll pay then.", "2026-03-10T17:00:00.000Z", "America/Denver", "2026-03-20"],
    // 23:30 on March 10 in New York is already March 11 in UTC; "tomorrow" is the next local day.
    ["I'll pay tomorrow", "2026-03-11T03:30:00.000Z", "America/New_York", "2026-03-11"],
    ["I'll pay next week", "2026-03-10T17:00:00.000Z", "America/Denver", "2026-03-17"],
    ["Can I start over next month?", "2026-03-10T17:00:00.000Z", "America/Denver", "2026-04-01"],
    ["I'll pay Tuesday", "2026-03-10T17:00:00.000Z", "America/Denver", "2026-03-17"], // said on a Tuesday: next week's
    ["I'll pay on the 31st", "2026-04-10T17:00:00.000Z", "America/Denver", "2026-04-30"], // April has 30 days
  ])("%s (sent %s, %s) -> %s", (text, sentAt, tz, want) => expect(parsePromise(text, at(sentAt), tz as "America/Denver")).toBe(want));

  test("no date, no promise", () => expect(parsePromise("I'll pay soon", at("2026-03-10T17:00:00.000Z"), "America/Denver")).toBeNull());
  test("a refusal is not a promise", () => expect(parsePromise("I will not pay Friday or ever", at("2026-03-10T17:00:00.000Z"), "America/Denver")).toBeNull());
});

test("a contact request is not a payment promise", () => expect(parsePromise("Text me Friday", at("2026-03-10T17:00:00.000Z"), "America/Denver")).toBeNull());

describe("Codex check 2 (16c)", () => {
  const sent = at("2026-03-10T17:00:00.000Z");
  test.each(["Text me Friday about my payment", "I can't pay Friday", "I cannot pay until I know more, text me Friday"])("no promise: %s", (text) =>
    expect(parsePromise(text, sent, "America/Denver")).toBeNull());
  test("still a promise: I'll pay Friday, text me then", () => expect(parsePromise("I'll pay Friday, text me then", sent, "America/Denver")).toBe("2026-03-13"));
});
