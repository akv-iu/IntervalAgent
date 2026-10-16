import { guardActions, guardStory, headline, resultSentence, type CellData, type ScenarioRow } from "../src/lib/evals-view";

const msg = (flags: string[] = []) => ({ seq: 1, role: "agent" as const, body: "x", when: "t", guardFlags: flags, checks: [] });
const cell = (failed: string[], applicable: number, flags: string[][] = []): CellData => ({
  passed: applicable - failed.length,
  applicable,
  failed,
  outcome: "No resolution",
  checks: [],
  messages: flags.map(msg),
});
const rows: ScenarioRow[] = [
  { id: "S08", title: "a", cells: { baseline: cell(["no_threats_or_false_claims"], 3), guarded: cell([], 3, [["regenerated"]]) } },
  { id: "S11", title: "b", cells: { baseline: cell(["quiet_hours"], 3), guarded: cell([], 3, [["rescheduled"]]) } },
  { id: "S05", title: "c", cells: { baseline: cell([], 4), guarded: cell([], 4, [[], ["handoff", "fixed_ack"]]) } },
];

test("headline counts scenarios that broke at least one hard rule", () => {
  expect(headline(rows)).toEqual({ total: 3, baselineBroken: ["S08", "S11"], guardedBroken: [] });
});

test("result sentences come from the data, in plain words", () => {
  expect(resultSentence("Baseline", rows[1].cells.baseline)).toBe("Baseline failed quiet hours (2 of 3 hard checks passed).");
  expect(resultSentence("Guarded", rows[1].cells.guarded)).toBe("Guarded passed all 3 applicable hard checks.");
  expect(resultSentence("Baseline", cell(["quiet_hours", "required_notice"], 3))).toBe(
    "Baseline failed quiet hours and required notice (1 of 3 hard checks passed).",
  );
});

test("guard actions are counted from the guarded transcripts only", () => {
  expect(guardActions(rows)).toEqual({ regenerated: 1, rescheduled: 1, handoff: 1, fixed_ack: 1 });
});

test("a stop handled by the guard is described, even though it leaves no message flag", () => {
  const stopCell: CellData = { ...cell([], 4), checks: [{ name: "stop_honored", hard: true, passed: true, detail: "" }] };
  expect(guardStory(stopCell)).toMatch(/stop request/);
  expect(guardStory(cell([], 3, [["rescheduled"]]))).toMatch(/moved into 8am to 9pm/);
  expect(guardStory(cell([], 3))).toMatch(/did not need to step in/);
});
