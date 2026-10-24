import { renderToStaticMarkup } from "react-dom/server";
import BusinessDashboard, { CaseRecords } from "../src/components/v2/BusinessDashboard";
import { startingCases } from "../src/lib/v2/fixtures";
import type { CaseState, WorkspaceView } from "../src/lib/v2/store";
import { calculateProposal } from "../src/lib/v2/options";

function workspace(): WorkspaceView {
  return { resets: 0, expiresAt: "2026-10-24T12:00:00Z", cases: Object.fromEntries(startingCases(new Date("2026-10-23T12:00:00Z")).map((facts) => [facts.id, {
    facts, messages: [], now: "2026-10-23T12:00:00Z", verification: null, revision: 0, turns: 0, businessReplies: 0,
    stopped: false, takeover: false, status: "ready", requestId: null, run: null, updates: [], events: [], activity: [], preferredChannel: null, commands: [], retries: 0, audit: [], lastReview: null,
  } satisfies CaseState])) };
}

test("dashboard shows only the selected business, with actual case status and working case targets", () => {
  const view = workspace();
  view.cases["cedar-late-payment"].status = "run_failed";
  view.cases["cedar-late-payment"].turns = 2;
  const html = renderToStaticMarkup(<BusinessDashboard workspace={view} businessId="cedar" selectedId="cedar-late-payment" disabled={false} onSelect={() => {}} />);
  expect(html).toContain("6 clients"); expect(html).toContain("Cedar Home Services"); expect(html).toContain("Riley"); expect(html).toContain("CED-201");
  expect(html).toContain("$185.00"); expect(html).toContain("Technical failure"); expect(html).toContain("2/10 customer turns"); expect(html).toContain('href="#v2-case"');
  expect(html).not.toContain("Alex"); expect(html).not.toContain("Northside Fitness"); expect(html).not.toContain("INV-101");
  const processing = renderToStaticMarkup(<BusinessDashboard workspace={view} businessId="cedar" selectedId="cedar-late-payment" disabled onSelect={() => {}} />);
  expect(processing).not.toContain('href="#v2-case"'); expect(processing).toContain("Available after this action");
});

test("dashboard and case records distinguish saved promises, requests and event states from executed actions", () => {
  const view = workspace(), c = view.cases["late-payment"];
  c.preferredChannel = "email";
  c.updates = [{ kind: "promise", amountCents: 5000, date: "2026-10-25", sourceMessageId: "promise" }, { kind: "extension_requested", date: "2026-10-25", sourceMessageId: "extension" }];
  c.events = ["planned", "superseded", "blocked"].map((state, index) => ({ id: `event-${index}`, sourceMessageId: "contact", channel: "email", date: "2026-10-25", window: "afternoon", timezone: "America/Denver", state: state as "planned" | "superseded" | "blocked", beyondExpiry: true }));
  const html = renderToStaticMarkup(<BusinessDashboard workspace={view} businessId="northside" selectedId="late-payment" disabled={false} onSelect={() => {}} />);
  for (const text of ["Promise: $50.00", "No payment received.", "Extension requested", "Not approved.", "Current channel preference: email.", "planned: email", "superseded: email", "blocked: email", "Not executed.", "beyond this workspace"]) expect(html).toContain(text);
  expect(renderToStaticMarkup(<CaseRecords c={c} />)).toContain("Promise: $50.00");
  expect(renderToStaticMarkup(<BusinessDashboard workspace={view} businessId="cedar" selectedId="cedar-late-payment" disabled={false} onSelect={() => {}} />)).not.toContain("Promise: $50.00");
});

test("saved offers show exact dates/amounts, supersession and stale facts without implying agreement", () => {
  const view = workspace(), c = view.cases["fresh-record"];
  const first = calculateProposal(c.facts, c.now, { method: "cash", count: 2, firstDate: "2026-10-24", sourceMessageId: "request" });
  c.updates = [first];
  const render = () => renderToStaticMarkup(<CaseRecords c={c} />);
  const html = render();
  for (const text of ["Latest offer at last case update", "$39.50", "2026-10-24", "2026-11-24", "Not agreed.", "No payment received.", "No added fees or interest."]) expect(html).toContain(text);
  expect(html).not.toContain("Promise:"); expect(html).not.toContain("Applied to this simulated balance");
  c.updates.push(calculateProposal(c.facts, c.now, { method: "card", count: 1, firstDate: "2026-10-25", sourceMessageId: "new-request" }));
  expect(render()).toContain("Superseded"); expect(render()).toContain("Latest offer at last case update");
  c.facts.balanceCents = 1;
  expect(render()).toContain("Outdated; needs recalculation"); expect(render()).not.toContain("Latest offer at last case update");
  expect(renderToStaticMarkup(<BusinessDashboard workspace={view} businessId="cedar" selectedId="cedar-late-payment" disabled={false} onSelect={() => {}} />)).not.toContain("Payment proposal");
});
