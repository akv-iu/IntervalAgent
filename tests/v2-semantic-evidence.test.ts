import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "../fixtures/v2/semantic-20261026-1/manifest.json";
import assessment from "../fixtures/v2/semantic-20261026-1/assessment.json";
import { semanticSuite, semanticChecks } from "../scripts/v2-semantic-evaluation";
import type { InvestigationResult } from "../src/lib/v2/contracts";
import type { ModelCall } from "../src/lib/v2/model";

vi.mock("@openai/agents", () => { throw new Error("Evidence checks must not load a model client"); });
vi.mock("openai", () => { throw new Error("Evidence checks must not load an API client"); });
vi.mock("pg", () => { throw new Error("Evidence checks must not load a database client"); });

type Capture = { suiteHash: string; candidateRevision: string; rows: { caseId: string; variant: string; sourceRevision: string; result: InvestigationResult | null; failures: string[]; calls: { id: string; result: ModelCall | null }[] }[] };
const directory = "fixtures/v2/semantic-20261026-1";
const capture = (name: string): Capture => JSON.parse(readFileSync(join(directory, `${name}.json`), "utf8"));

test("frozen inputs, outputs, rubric, assessment and budget retain their declared hashes", () => {
  for (const [name, expected] of Object.entries(manifest.files)) expect(createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")).toBe(expected);
  for (const name of ["initial", "development-retest"]) expect(capture(name).suiteHash).toBe(manifest.files["cases.json"]);
});

test("original matched results and the incomplete retest remain visible rather than becoming a hybrid pass rate", () => {
  const initial = capture("initial"), retest = capture("development-retest");
  expect(initial.rows).toHaveLength(18); expect(retest.rows).toHaveLength(3);
  for (const [run, data] of [["initial", initial], ["development-retest", retest]] as const) {
    for (const row of data.rows) {
      const sample = semanticSuite.cases.find((s) => s.id === row.caseId)!;
      if (row.result) expect(semanticChecks(sample, row.result, row.variant === "candidate")).toEqual(row.failures);
      else expect(row.failures).toHaveLength(1);
      expect(assessment.rows.filter((r) => r.run === run && r.variant === row.variant && r.caseId === row.caseId)).toHaveLength(1);
    }
  }
  for (const variant of ["baseline", "candidate"] as const) {
    const rows = initial.rows.filter((r) => r.variant === variant);
    expect(rows.filter((r) => !r.failures.length)).toHaveLength(manifest.initialStructuredPass[variant]);
    expect(rows.filter((r) => {
      const manual = assessment.rows.find((a) => a.run === "initial" && a.variant === variant && a.caseId === r.caseId)!;
      return !r.failures.length && manual.meaningCorrect && !manual.unnecessaryKnownQuestion && !manual.unsupportedUpdateProposal;
    })).toHaveLength(manifest.initialAssessedPass[variant]);
  }
  expect(retest.rows.filter((r) => r.result && !r.failures.length)).toHaveLength(2);
  expect(retest.rows.filter((r) => !r.result)).toHaveLength(1);
  expect(initial.candidateRevision).not.toBe(retest.candidateRevision);
});

test("closed batch accounting includes all 100 attempts and cannot claim two dollars of actual billing", () => {
  const calls = [capture("initial"), capture("development-retest")].flatMap((p) => p.rows.flatMap((r) => r.calls));
  expect(calls).toHaveLength(manifest.attempts); expect(new Set(calls.map((c) => c.id)).size).toBe(100);
  const known = calls.flatMap((c) => c.result?.usageKnown ? [c.result] : []);
  expect(calls.length - known.length).toBe(manifest.unknownUsageCalls);
  const input = known.reduce((n, c) => n + c.inputTokens, 0), output = known.reduce((n, c) => n + c.outputTokens, 0);
  expect(input).toBe(manifest.reportedInputTokens); expect(output).toBe(manifest.reportedOutputTokens);
  expect((input * 0.25 + output) / 1_000_000).toBeCloseTo(manifest.conservativeReportedTokenDollars, 9);
  const budget = JSON.parse(readFileSync(join(directory, "budget.json"), "utf8"));
  expect(budget).toEqual({ capCents: 200, reservedCents: 200, calls: 100 });
  expect(manifest.conservativeReportedTokenDollars).toBeLessThan(manifest.capDollars);
});
