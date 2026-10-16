import { renderToStaticMarkup } from "react-dom/server";
import ConversationDetail, { stepIndex } from "../src/components/ConversationDetail";
import { verdictText } from "../src/components/verdict";
import EmptyState from "../src/components/EmptyState";
import LessonsPanel from "../src/components/LessonsPanel";
import type { Lesson } from "../src/lib/lessons";

const msgs = [
  { seq: 1, role: "agent" as const, body: "Hello from Northside Fitness", when: "3/10, 10:00 AM", guardFlags: [], checks: [{ name: "quiet_hours", passed: true, detail: "" }] },
  { seq: 2, role: "customer" as const, body: "Please stop texting me.", when: "3/10, 10:10 AM", guardFlags: [], checks: [] },
  { seq: 3, role: "agent" as const, body: "Noted.", when: "3/10, 10:20 AM", guardFlags: ["rescheduled"], checks: [{ name: "no_threats_or_false_claims", passed: false, detail: "x" }] },
];

describe("ConversationDetail", () => {
  test("first message: Previous disabled, Next enabled, real buttons", () => {
    const html = renderToStaticMarkup(<ConversationDetail title="S09" messages={msgs} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Previous/);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Next/);
    expect(html).toContain("Message 1 of 3");
    expect(html).toContain("quiet hours");
    expect(html).toContain("pass");
  });

  test("last message: Next disabled, failed check shown in words", () => {
    const html = renderToStaticMarkup(<ConversationDetail title="S09" messages={msgs} initialIndex={2} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Next/);
    expect(html).toContain("Message 3 of 3");
    expect(html).toContain("fail");
    expect(html).toContain("moved into 8am to 9pm");
  });

  test("stepping stays inside the conversation", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(2, 1, 3)).toBe(2);
  });

  test("verdicts are words, not just colors", () => {
    expect([verdictText(true), verdictText(false), verdictText(null)]).toEqual(["pass", "fail", "n/a"]);
  });

  test("an empty conversation says so", () => {
    expect(renderToStaticMarkup(<ConversationDetail title="x" messages={[]} />)).toContain("No messages");
  });
});

test("empty database shows setup guidance and no invented numbers", () => {
  const html = renderToStaticMarkup(<EmptyState what="bulk simulation" />);
  expect(html).toContain("No data imported yet");
  expect(html).toContain("npm run db:import");
  expect(html.replace(/npm run [a-z:]+|results\/[^ <]+|db:[a-z]+/g, "")).not.toMatch(/\$\d|\d+%/);
});

describe("LessonsPanel", () => {
  const lesson: Lesson = {
    id: 1, createdAt: "2026-10-16T12:00:00.000Z", situation: "refusal", reason: "gave_up", instruction: "Offer the plan.", hardRule: null,
    appliesTo: "situation", scenarioId: "S01", moment: [], beforeText: "b", afterText: "a", active: true, timesUsed: 0,
  };
  const html = (canDelete: boolean) => renderToStaticMarkup(<LessonsPanel lessons={[lesson]} setLessons={() => {}} off={null} canDelete={canDelete} />);
  test("locally a lesson can be turned off or deleted", () => expect(html(true)).toMatch(/Turn off[\s\S]*Delete/));
  test("on the public site a lesson can be turned off but not deleted", () => {
    expect(html(false)).toContain("Turn off");
    expect(html(false)).not.toContain("Delete");
  });
});
