import { renderToStaticMarkup } from "react-dom/server";
import OperatorCorrections, { PausedReplyNotice } from "../src/components/v2/OperatorCorrections";
import { Thread } from "../src/components/v2/InvestigationWorkspace";
import { startingCases } from "../src/lib/v2/fixtures";
import type { CaseState } from "../src/lib/v2/store";

function state(): CaseState {
  return { facts: startingCases(new Date("2026-10-23T12:00:00Z"))[0], messages: [], now: "2026-10-23T12:00:00Z", verification: null,
    revision: 2, turns: 1, businessReplies: 0, stopped: false, takeover: true, status: "taken_over", requestId: null, run: null,
    updates: [], events: [], activity: [], preferredChannel: null, commands: [], retries: 0, audit: [{ id: "original", at: "2026-10-23T12:00:00Z", before: [], after: [], review: { accepted: true, reasons: [] }, roleVersion: "original-version", sourceVersion: "synthetic", sourceMessageIds: ["customer"], replyId: "original-reply" }],
    lastReview: { draft: { reply: "Original reply", needsOperator: false }, verification: null, resolution: null, review: { accepted: true, reasons: [] }, activity: [] },
  };
}

test("pause notice accurately describes future replies after an earlier reply was published", () => {
  const c = state();
  const html = renderToStaticMarkup(<PausedReplyNotice c={c} />);
  expect(html).toContain("Automatic replies are paused"); expect(html).not.toContain("before a reply can be sent");
  expect(renderToStaticMarkup(<PausedReplyNotice c={{ ...c, stopped: true }} />)).toBe("");
  expect(renderToStaticMarkup(<PausedReplyNotice c={{ ...c, takeover: false, status: "ready" }} />)).toBe("");
});

test("operator panel distinguishes saved feedback, stale feedback and rejected unpublished revisions", () => {
  const c = state();
  c.corrections = [{ correctionId: "feedback", targetAuditId: "original", targetRole: "customer", text: "Answer the question first", original: c.lastReview!, at: c.now, revision: 2 }];
  const render = () => renderToStaticMarkup(<OperatorCorrections c={c} busy={false} onSave={async () => true} onRetry={async () => true} />);
  expect(render()).toContain("saved, not run"); expect(render()).toContain("not a reusable lesson or payment approval");
  expect(render().match(/<button[^>]*>Retry with correction and resume/)![0]).not.toContain('disabled=""');
  c.revision++;
  expect(render()).toContain("case changed"); expect(render().match(/<button[^>]*>Retry with correction and resume/)![0]).toContain('disabled=""');
  c.corrections[0].runId = "revision"; c.corrections[0].outcome = "blocked";
  c.corrections[0].result = { ...c.lastReview!, draft: { reply: "Unsupported revision", needsOperator: false }, review: { accepted: false, reasons: ["Missing policy"] } };
  expect(render()).toContain("Original customer reply"); expect(render()).toContain("Revised customer draft (not published)"); expect(render()).toContain("Missing policy");
});

test("the customer thread retains the original and labels the appended reviewed correction", () => {
  const c = state();
  c.messages = [{ id: "original", channel: "customer", speaker: "agent", text: "Original answer", at: c.now }, { id: "revised", channel: "customer", speaker: "agent", text: "Corrected answer", at: c.now, origin: "operator_revision" }];
  const html = renderToStaticMarkup(<Thread c={c} channel="customer" />);
  expect(html.indexOf("Original answer")).toBeLessThan(html.indexOf("Corrected answer")); expect(html).toContain("Reviewed correction");
});
