import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Draft, Resolution, Review, Verification } from "./contracts";
import { EVALUATION_VERSION, LearningEvaluationSchema, ProposedLesson, assessEvaluation, unsafeLesson } from "./learning";
import { scoreLearningResult } from "./learning-checks";

export const V2_REPLAY_DIRECTORY = "fixtures/v2/learning-20261024-1";
const Role = z.enum(["customer", "business_verification", "account_resolution", "reviewer"]);
const Count = z.number().int().nonnegative().max(10_000_000);
const Call = z.object({ id: z.uuid(), role: Role, inputTokens: Count, outputTokens: Count, usageKnown: z.boolean(), latencyMs: Count, tools: z.array(z.string().min(1).max(80)).max(10) }).strict();
const Result = z.object({ draft: Draft, review: Review, verification: Verification.nullable(), resolution: Resolution.nullable(), activity: z.array(z.object({ role: Role, action: z.string().min(1).max(80), summary: z.string().max(1200) }).strict()).max(100) }).strict();
const Manifest = z.object({
  format: z.literal("v2-saved-output-replay-1"), dataset: z.literal("learning-20261024-1"), suiteVersion: z.literal(EVALUATION_VERSION),
  traceSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceReport: z.literal("live-report-learning-evals-2.json"), checkpointCommit: z.string().regex(/^[a-f0-9]{40}$/),
  model: z.literal("gpt-6-luna"), roleVersion: z.literal("v2-phase4-1"), agentsSdk: z.literal("0.21.0"),
  configurationReference: z.object({ maxOutputTokens: z.literal(1400), maxComparisonCalls: z.literal(32), deadlineMs: z.literal(90000) }).strict(),
  provenance: z.literal("live-model-synthetic-data"), selection: z.string().min(1).max(800), scoringContext: z.string().min(1).max(800),
}).strict();
const Traces = z.object({
  comparisons: z.array(z.object({ candidateId: z.uuid(), role: z.enum(["customer", "reviewer"]), businessId: z.literal("northside"), scenario: z.null(), proposal: ProposedLesson, evaluation: LearningEvaluationSchema, calls: z.array(Call).min(1).max(32) }).strict()).length(2),
  rejected: z.object({ candidateId: z.uuid(), role: z.literal("reviewer"), proposal: ProposedLesson, recordedStatus: z.literal("rejected"), calls: z.array(Call).length(1) }).strict(),
}).strict();

export function parseReplay(manifestText: string, traceText: string) {
  if (Buffer.byteLength(manifestText) > 16_384 || Buffer.byteLength(traceText) > 1_000_000) throw new Error("Replay artifact exceeds its size limit.");
  const manifest = Manifest.parse(JSON.parse(manifestText));
  if (createHash("sha256").update(traceText).digest("hex") !== manifest.traceSha256) throw new Error("Pinned V2 trace checksum mismatch; no fallback.");
  return { manifest, traces: Traces.parse(JSON.parse(traceText)) };
}
export function loadReplay(directory = V2_REPLAY_DIRECTORY) {
  return parseReplay(readFileSync(join(directory, "manifest.json"), "utf8"), readFileSync(join(directory, "comparisons.json"), "utf8"));
}

function metrics(calls: z.infer<typeof Call>[]) {
  const known = calls.filter((c) => c.usageKnown), sorted = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const inputTokens = known.reduce((n, c) => n + c.inputTokens, 0), outputTokens = known.reduce((n, c) => n + c.outputTokens, 0);
  return { calls: calls.length, unknownUsageCalls: calls.length - known.length, inputTokens, outputTokens,
    conservativeReportedTokenDollars: (inputTokens * 0.25 + outputTokens) / 1_000_000,
    capturedCallLatencyMs: { p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, sum: sorted.reduce((a, b) => a + b, 0) },
    byRole: Object.fromEntries(Role.options.map((role) => [role, calls.filter((c) => c.role === role).length])),
    toolRequests: calls.flatMap((c) => c.tools).reduce<Record<string, number>>((counts, tool) => { counts[tool] = (counts[tool] ?? 0) + 1; return counts; }, Object.create(null)),
  };
}

export function replayEvidence(input: ReturnType<typeof parseReplay>) {
  const { manifest, traces } = input;
  if (new Set(traces.comparisons.map((c) => c.role)).size !== 2) throw new Error("Replay requires both declared role contexts.");
  const allCalls = [...traces.comparisons.flatMap((c) => c.calls), ...traces.rejected.calls];
  if (new Set(allCalls.map((c) => c.id)).size !== allCalls.length) throw new Error("Duplicate model-call ID in pinned traces.");
  const comparisons = traces.comparisons.map((comparison) => {
    const { evaluation, role } = comparison;
    if (evaluation.model !== manifest.model || evaluation.provenance !== "live" || evaluation.baseCandidateId !== null || comparison.proposal.focus !== "invoice_clarity" || unsafeLesson(comparison.proposal)) throw new Error("Unsupported pinned model, baseline, focus or instruction.");
    if (evaluation.calls !== comparison.calls.length || evaluation.rows.reduce((n, r) => n + r.baselineCalls + r.candidateCalls, 0) !== evaluation.calls) throw new Error("Comparison call accounting mismatch.");
    const categories = { "target-a": "target", "target-b": "target", regression: "regression", safety: "safety" } as const;
    if (evaluation.rows.length !== 4 || new Set(evaluation.rows.map((r) => r.id)).size !== 4) throw new Error("Incomplete pinned comparison.");
    const rows = evaluation.rows.map((row) => {
      if (!(row.id in categories) || categories[row.id as keyof typeof categories] !== row.category || row.error) throw new Error("Unknown or incomplete comparison case.");
      const score = (value: unknown) => role === "reviewer" ? Review.parse(value).accepted === (row.id === "regression") : scoreLearningResult({ id: row.id, category: row.category, invoiceId: "VAL-204", now: evaluation.at }, Result.parse(value), comparison.proposal.focus);
      return { ...row, baselinePassed: score(row.baseline), candidatePassed: score(row.candidate) };
    });
    const decision = assessEvaluation(rows);
    const recordedScoresMatch = rows.every((r, i) => r.baselinePassed === evaluation.rows[i].baselinePassed && r.candidatePassed === evaluation.rows[i].candidatePassed);
    const recordedDecisionMatches = decision.eligible === evaluation.eligible;
    const outcomes = role === "customer" ? rows.flatMap((r) => [r.baseline, r.candidate]).map((r) => Result.parse(r)) : [];
    return { candidateId: comparison.candidateId, role, businessId: comparison.businessId, lessonScope: "business-wide", capturedAt: evaluation.at,
      baseline: { passed: rows.filter((r) => r.baselinePassed).length, total: rows.length }, candidate: { passed: rows.filter((r) => r.candidatePassed).length, total: rows.length },
      ...decision, recordedScoresMatch, recordedDecisionMatches, metrics: metrics(comparison.calls), rows,
      observedOutputs: role === "customer" ? { denominator: outcomes.length, businessWaiting: outcomes.filter((r) => r.verification?.outcome === "awaiting_business").length, operatorEscalations: outcomes.filter((r) => r.draft.needsOperator || r.resolution?.needsOperator).length,
        delegationRequests: outcomes.flatMap((r) => r.activity).filter((a) => a.action === "delegated").length, rejectedReviewEvents: outcomes.flatMap((r) => r.activity).filter((a) => a.role === "reviewer" && a.action === "rejected").length } : null,
    };
  });
  const unsafeReason = unsafeLesson(traces.rejected.proposal);
  const passed = comparisons.every((c) => c.recordedScoresMatch && c.recordedDecisionMatches) && !!unsafeReason;
  return { format: "v2-replay-report-1", dataset: manifest.dataset, provenance: "Saved-output replay of live model results on synthetic cases", model: manifest.model, roleVersion: manifest.roleVersion, suiteVersion: manifest.suiteVersion,
    replayPassed: passed, newApiCalls: 0, databaseUsed: false, capturedMetrics: metrics(allCalls), comparisons,
    rejectedSuggestion: { candidateId: traces.rejected.candidateId, recordedStatus: traces.rejected.recordedStatus, replayStatus: unsafeReason ? "rejected" : "not rejected", reason: unsafeReason },
    limits: ["Replay verifies saved outputs and accounting, not a new model run or exact SDK/provider-request reproduction.", "Eight comparison rows in two role contexts, plus one rejected suggestion; selected development evidence, not a holdout or all twelve client journeys.", "Scoring uses declared VAL-204 fixture and the captured comparison completion date; exact original provider inputs were not recorded.", "Call latencies are captured provider-call observations, not end-to-end user wait times. Unknown usage stays separate; cost is conservative reported-token accounting, not billing or current pricing.", "No financial ledger outcomes are captured in this set; replies do not establish receipts, settlement or collections lift."] };
}

export function renderReplayReport(report: ReturnType<typeof replayEvidence>) {
  const m = report.capturedMetrics;
  const totals = report.comparisons.map((c) => `| ${c.role} | ${c.baseline.passed}/${c.baseline.total} | ${c.candidate.passed}/${c.candidate.total} | ${c.eligible ? "yes" : "no"} | ${c.recordedScoresMatch && c.recordedDecisionMatches ? "yes" : "no"} |`).join("\n");
  const details = report.comparisons.map((c) => {
    const o = c.observedOutputs;
    const observations = o ? `Observed final customer outputs: ${o.denominator}; operator escalations ${o.operatorEscalations}; business waiting ${o.businessWaiting}; delegation events ${o.delegationRequests}; intermediate rejected Reviewer events ${o.rejectedReviewEvents}.`
      : "Controlled Reviewer decisions; customer dialogue and ledger outcomes were not captured for this comparison.";
    return `## ${c.role}

${c.reason} ${c.metrics.calls} captured calls. ${observations}

| Case | Baseline | Candidate |
| --- | --- | --- |
${c.rows.map((r) => `| ${r.id} (${r.category}) | ${r.baselinePassed ? "pass" : "fail"} | ${r.candidatePassed ? "pass" : "fail"} |`).join("\n")}`;
  }).join("\n\n");
  return `# V2 saved-output replay

Replay integrity/scoring gate: **${report.replayPassed ? "PASS" : "FAIL"}**. Candidate eligibility is reported separately.

${report.provenance}. Dataset \`${report.dataset}\`, suite \`${report.suiteVersion}\`, role version \`${report.roleVersion}\`, model \`${report.model}\`. New API calls: **0**; no database.

| Role | Baseline | Candidate | Eligible | Scores/decision reproduced |
| --- | --- | --- | --- | --- |
${totals}

Unsafe suggestion: **${report.rejectedSuggestion.replayStatus}**.

Selected captures: ${m.calls} unique calls, ${m.inputTokens} reported input / ${m.outputTokens} output tokens; ${m.unknownUsageCalls} calls with unknown usage. Conservative accounting: $${m.conservativeReportedTokenDollars.toFixed(6)}. Captured call latency p50 ${m.capturedCallLatencyMs.p50}ms / p95 ${m.capturedCallLatencyMs.p95}ms. These cover only this selection, not the whole Phase 3/4 batch.

${details}

## Limits

${report.limits.map((s) => `- ${s}`).join("\n")}

Raw captured outputs, per-call tokens/latencies/tools and pinned instructions are in the checked-in fixture; generated JSON retains rescored row evidence. This report does not activate lessons.
`;
}
