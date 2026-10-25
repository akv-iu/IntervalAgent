import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { V2_REPLAY_DIRECTORY, loadReplay, parseReplay, renderReplayReport, replayEvidence } from "../src/lib/v2/eval-replay";

vi.mock("@openai/agents", () => { throw new Error("Offline replay must not load the Agents SDK"); });
vi.mock("openai", () => { throw new Error("Offline replay must not load an API client"); });
vi.mock("pg", () => { throw new Error("Offline replay must not load PostgreSQL"); });

const manifestText = readFileSync(join(V2_REPLAY_DIRECTORY, "manifest.json"), "utf8");
const traceText = readFileSync(join(V2_REPLAY_DIRECTORY, "comparisons.json"), "utf8");
const rehashed = (trace: unknown, manifest = JSON.parse(manifestText)) => {
  const text = JSON.stringify(trace);
  return parseReplay(JSON.stringify({ ...manifest, traceSha256: createHash("sha256").update(text).digest("hex") }), text);
};

test("the pinned live-output replay reproduces gains and failures without model/database clients", () => {
  const report = replayEvidence(loadReplay());
  expect(report).toMatchObject({ replayPassed: true, newApiCalls: 0, databaseUsed: false, suiteVersion: "learning-evals-2" });
  expect(report.comparisons.map((c) => [c.role, c.baseline.passed, c.candidate.passed, c.eligible])).toEqual([["customer", 2, 4, true], ["reviewer", 2, 3, false]]);
  expect(report.capturedMetrics).toMatchObject({ calls: 36, unknownUsageCalls: 0 });
  expect(report.rejectedSuggestion.replayStatus).toBe("rejected");
  const text = renderReplayReport(report);
  expect(text).toContain("Candidate eligibility is reported separately"); expect(text).toContain("not end-to-end"); expect(text).toContain("No financial ledger outcomes");
  expect(JSON.stringify(replayEvidence(loadReplay()))).toBe(JSON.stringify(report));
});

test("missing, changed, oversized and incompatible evidence fails closed instead of falling back", () => {
  expect(() => loadReplay("fixtures/v2/no-such-recording")).toThrow();
  expect(() => parseReplay(manifestText, traceText + " ")).toThrow("checksum");
  expect(() => parseReplay(manifestText, " ".repeat(1_000_001))).toThrow("size limit");
  const manifest = JSON.parse(manifestText); manifest.suiteVersion = "future-suite";
  expect(() => parseReplay(JSON.stringify(manifest), traceText)).toThrow();
  expect(() => parseReplay("not json", traceText)).toThrow();
});

test("strict archives reject credentials/extra fields and malformed token accounting", () => {
  const trace = JSON.parse(traceText); trace.credentials = "must not be accepted";
  expect(() => rehashed(trace)).toThrow(); delete trace.credentials;
  trace.comparisons[0].calls[0].inputTokens = -1;
  expect(() => rehashed(trace)).toThrow();
  expect(traceText).not.toMatch(/sk-[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\/|Bearer\s+\S+|recovery_v2=/);
});

test.each(["scores", "eligibility"])("recorded %s cannot certify itself when replayed outputs disagree", (kind) => {
  const input = loadReplay(), c = input.traces.comparisons[1];
  if (kind === "scores") c.evaluation.rows[0].candidatePassed = true;
  else c.evaluation.eligible = true;
  const report = replayEvidence(input);
  expect(report.replayPassed).toBe(false); expect(report.comparisons[1].eligible).toBe(false);
});

test("an altered live customer reply is rescored instead of trusting its saved pass flag", () => {
  const trace = JSON.parse(traceText);
  trace.comparisons[0].evaluation.rows[0].candidate.draft.reply = "Your balance is zero and paid in full.";
  const report = replayEvidence(rehashed(trace));
  expect(report.replayPassed).toBe(false); expect(report.comparisons[0].eligible).toBe(false);
});

test.each(["duplicate-call", "call-count", "missing-case", "wrong-category", "missing-output", "wrong-model", "missing-role"])("%s cannot be reported as a reproducible full suite", (kind) => {
  const input = loadReplay(), c = input.traces.comparisons[0];
  if (kind === "duplicate-call") c.calls[1].id = c.calls[0].id;
  if (kind === "call-count") c.evaluation.calls--;
  if (kind === "missing-case") c.evaluation.rows.pop();
  if (kind === "wrong-category") c.evaluation.rows[0].category = "safety";
  if (kind === "missing-output") c.evaluation.rows[0].candidate = null;
  if (kind === "wrong-model") c.evaluation.model = "different-model";
  if (kind === "missing-role") input.traces.comparisons[1].role = "customer";
  expect(() => replayEvidence(input)).toThrow();
});

test("unknown usage is excluded from known-token totals and call latencies have explicit denominators", () => {
  const input = loadReplay(), first = input.traces.comparisons[0].calls[0];
  const prior = replayEvidence(input).capturedMetrics; first.usageKnown = false;
  const next = replayEvidence(input).capturedMetrics;
  expect(next.calls).toBe(36); expect(next.unknownUsageCalls).toBe(1);
  expect(next.inputTokens).toBe(prior.inputTokens - first.inputTokens); expect(next.outputTokens).toBe(prior.outputTokens - first.outputTokens);
  const times = [...input.traces.comparisons.flatMap((c) => c.calls), ...input.traces.rejected.calls].map((c) => c.latencyMs).sort((a, b) => a - b);
  expect(next.capturedCallLatencyMs).toEqual({ p50: times[17], p95: times[34], sum: times.reduce((a, b) => a + b, 0) });
  expect(Object.values(next.byRole).reduce((a, b) => a + b, 0)).toBe(36);
});

test("a replay CLI live flag is rejected even with API environment configuration present", () => {
  const directory = mkdtempSync(join(tmpdir(), "v2-replay-"));
  try {
    mkdirSync(join(directory, "results/v2-replay"), { recursive: true });
    writeFileSync(join(directory, "results/v2-replay/report.md"), "Old PASS result must not survive failure");
    const run = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/v2-eval-replay.ts"), "--live"], { cwd: directory, encoding: "utf8", env: { ...process.env, V2_OPENAI_API_KEY: "do-not-use", OPENAI_API_KEY: "do-not-use", V2_DATABASE_URL: "invalid-unused" } });
    expect(run.status).toBe(1); expect(run.stderr).toContain("no live or fallback mode"); expect(run.stderr).toContain("failed closed");
    expect(JSON.parse(readFileSync(join(directory, "results/v2-replay/report.json"), "utf8"))).toMatchObject({ replayPassed: false, newApiCalls: 0 });
    expect(readFileSync(join(directory, "results/v2-replay/report.md"), "utf8")).not.toContain("PASS");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
