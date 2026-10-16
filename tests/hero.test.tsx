// The home page hero: its events come from one real conversation in the run, never invented.
import { renderToStaticMarkup } from "react-dom/server";
import Hero from "../src/components/Hero";
import { heroStory } from "../src/lib/hero";
import type { ConversationRow, MessageRow } from "../src/lib/reports";

const conv = (id: number, key: string, p: Partial<ConversationRow> = {}): ConversationRow => ({
  id,
  accountKey: key,
  firstName: "Maya",
  agingBucket: "1-30",
  balanceCents: 15104,
  timezone: "America/Denver",
  scenarioId: null,
  version: "guarded",
  channel: "sms",
  tone: "friendly",
  outcome: "agreed_to_pay",
  recoveredCents: 15104,
  recoveredByCutoffCents: 15104,
  handedToHuman: false,
  startedAt: new Date("2026-03-10T16:00:00.000Z"),
  paidAt: new Date("2026-03-12T16:10:00.000Z"),
  ...p,
});
const msgs: MessageRow[] = [
  {
    seq: 1,
    role: "agent",
    body: "Hi Maya, this is Northside Fitness. Your account is past due with a balance of $151.04.",
    sentAt: new Date("2026-03-10T16:00:00.000Z"),
    guardFlags: [],
    checks: [
      { name: "quiet_hours", passed: true, detail: "" },
      { name: "exact_amounts", passed: true, detail: "" },
      { name: "plan_offered", passed: null, detail: "" },
    ],
  },
  { seq: 2, role: "customer", body: "Oh, I missed that. I'll pay the full $151.04 today.", sentAt: new Date("2026-03-10T16:10:00.000Z"), guardFlags: [], checks: [] },
];

describe("heroStory", () => {
  test("tells one paid conversation in time order, from its real messages and payment", () => {
    const s = heroStory([conv(2, "demo-002", { recoveredByCutoffCents: 0, paidAt: null, outcome: "disputed" }), conv(1, "demo-001")], { 1: msgs, 2: msgs })!;
    expect(s.conversationId).toBe(1);
    expect(s.title).toBe("Maya, Mountain Time"); // the account has a timezone, not a city
    expect(s.events.map((e) => e.title)).toEqual(["Text sent", "Guard checks: 2 of 2 passed", "Customer replied", "$151.04 payment received"]);
    expect(s.events[0].detail).toBe("Mar 10, 10:00 AM MDT");
    expect(s.events[2].detail).toContain("I'll pay the full $151.04 today.");
    expect(s.events[3].detail).toBe("Mar 12, 10:10 AM MDT");
  });

  test("prefers the longer paid conversation, then the account key, so the pick is stable", () => {
    const three = [...msgs, { ...msgs[1], seq: 3, body: "Thanks!" }];
    expect(heroStory([conv(1, "demo-001"), conv(5, "demo-005")], { 1: msgs, 5: three })!.conversationId).toBe(5);
    expect(heroStory([conv(9, "demo-009"), conv(4, "demo-004")], { 9: msgs, 4: msgs })!.conversationId).toBe(4);
  });

  test("no payment by the cutoff means no story", () =>
    expect(heroStory([conv(1, "demo-001", { recoveredByCutoffCents: 0, paidAt: null })], { 1: msgs })).toBeNull());

  test("a long reply is shortened", () => {
    const long = [msgs[0], { ...msgs[1], body: "x".repeat(200) }];
    expect(heroStory([conv(1, "demo-001")], { 1: long })!.events[2].detail.length).toBeLessThanOrEqual(90);
  });
});

describe("Hero", () => {
  const html = renderToStaticMarkup(<Hero story={heroStory([conv(1, "demo-001")], { 1: msgs })} />);
  test("one h1, and links to the agent and the evals", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="/try"');
    expect(html).toContain('href="/evals"');
  });
  test("no sign-in, demo booking, or invented claims", () => expect(html).not.toMatch(/log ?in|sign ?in|book a demo|licensed|bonded/i));
  test("says where the events come from", () => expect(html).toMatch(/Synthetic customer/));
  test("points to the same customer in the list below, without claiming to open it", () => expect(html).toContain("Find Maya in the conversations below"));
  test("long replies wrap instead of widening the page", () => expect(html).toMatch(/class="[^"]*break-words[^"]*"[^>]*>&quot;|class="[^"]*break-words/));
  test("events are an ordered list, in time order", () => expect(html).toMatch(/<ol[\s\S]*Text sent[\s\S]*Customer replied[\s\S]*payment received[\s\S]*<\/ol>/));
  test("renders without a story (no run yet)", () => expect(renderToStaticMarkup(<Hero story={null} />)).toContain('href="/try"'));
});
