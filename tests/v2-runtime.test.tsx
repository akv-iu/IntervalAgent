import { renderToStaticMarkup } from "react-dom/server";
import { RuntimeBox, Thread } from "../src/components/v2/InvestigationWorkspace";
import { openingMessage, startingCases } from "../src/lib/v2/fixtures";
import type { CaseState, FinishedRun } from "../src/lib/v2/store";

test("the compact runtime shows actual active metadata and completed-call count", () => {
  const run: CaseState["run"] = { id: "run-2", revision: 2, startedAt: "2026-10-23T12:00:00Z", calls: 2, activeRole: "reviewer", steps: [{ id: "call", role: "reviewer", state: "started", at: "2026-10-23T12:00:03Z" }] };
  const html = renderToStaticMarkup(<RuntimeBox c={{ run }} seconds={3} />);
  expect(html).toContain("Runtime · Reviewer"); expect(html).toContain("3s · 2 completed model calls");
  expect(html).toContain("Reviewer: started"); expect(html).not.toContain("Last run");
});

test("completed and failed runtime remain inspectable without a current run or invented old metrics", () => {
  const saved: FinishedRun = { id: "run-1", startedAt: "2026-10-23T12:00:00Z", finishedAt: "2026-10-23T12:00:06.100Z", durationMs: 6100, calls: 4, steps: [], outcome: "completed" };
  const html = renderToStaticMarkup(<RuntimeBox c={{ run: null, lastRun: saved }} seconds={99} />);
  expect(html).toContain("Last run · complete"); expect(html).toContain("6.1s · 4 completed model calls"); expect(html).not.toContain("99s");
  expect(renderToStaticMarkup(<RuntimeBox c={{ run: null, lastRun: { ...saved, outcome: "failed" } }} seconds={0} />)).toContain("Last run · failed");
  const failed = renderToStaticMarkup(<RuntimeBox c={{ run: null, lastRun: { ...saved, outcome: "failed", failure: { kind: "quota", status: 429, code: "credit_balance_exhausted", message: "Check API billing." } } }} seconds={0} />);
  expect(failed).toContain("Check API billing."); expect(failed).toContain("HTTP 429"); expect(failed).toContain("credit_balance_exhausted");
  const legacy = renderToStaticMarkup(<RuntimeBox c={{ run: null }} seconds={0} />);
  expect(legacy).toContain("no saved run"); expect(legacy).not.toContain("completed model calls");
});

test("runtime groups start/completion into one row per call and shows requested tools", () => {
  const run: NonNullable<CaseState["run"]> = { id: "run", revision: 1, startedAt: "2026-10-24T12:00:00Z", calls: 1, steps: [
    { id: "calculate", role: "account_resolution", state: "started", at: "2026-10-24T12:00:01Z" },
    { id: "calculate", role: "account_resolution", state: "completed", at: "2026-10-24T12:00:02Z", tools: ["calculate_payment_proposal"] },
    { id: "findings", role: "account_resolution", state: "started", at: "2026-10-24T12:00:02Z" },
  ] };
  const html = renderToStaticMarkup(<RuntimeBox c={{ run }} seconds={2} />);
  expect(html.match(/<li>/g)).toHaveLength(2);
  expect(html).toContain("requested calculate payment proposal");
  expect(html).toContain("Account Resolution: started"); expect(html).toContain("Account Resolution: completed");
  expect(html).not.toContain("Earlier steps were not retained"); expect(html).toContain('tabindex="0"');
});

test("legacy truncated runtime reports the missing calls instead of implying the visible rows are the full run", () => {
  const saved: FinishedRun = { id: "old-run", startedAt: "2026-10-23T12:00:00Z", finishedAt: "2026-10-23T12:00:06Z", durationMs: 6000, calls: 7, steps: [{ id: "last-call", role: "reviewer", state: "completed", at: "2026-10-23T12:00:06Z" }], outcome: "completed" };
  const html = renderToStaticMarkup(<RuntimeBox c={{ run: null, lastRun: saved }} seconds={0} />);
  expect(html).toContain("Showing 1 of 7 completed calls."); expect(html).toContain("Earlier steps were not retained");
  expect(html).not.toContain("requested undefined");
});

test("the customer sees business outreach first and business-labelled replies, with their own response separate", () => {
  const at = new Date("2026-10-23T12:00:00Z"), facts = startingCases(at)[1];
  const messages: CaseState["messages"] = [openingMessage(facts, at), { id: "customer", channel: "customer", speaker: "customer", text: "I already paid", at: at.toISOString() }, { id: "agent-reply", channel: "customer", speaker: "agent", text: "I can help check that payment", at: at.toISOString() }];
  const html = renderToStaticMarkup(<Thread c={{ facts, messages, stopped: false }} channel="customer" />);
  expect(html).toContain("Northside Fitness"); expect(html).toContain("Synthetic opening");
  expect(html.indexOf("Hi Sam")).toBeLessThan(html.indexOf("I already paid"));
  expect(html).not.toContain("Case Orchestrator"); expect(html).not.toContain("no opening");
});
