import { mkdirSync, writeFileSync } from "node:fs";
import { loadReplay, renderReplayReport, replayEvidence } from "../src/lib/v2/eval-replay";

function saveReport(report: unknown, markdown: string) {
  mkdirSync("results/v2-replay", { recursive: true });
  writeFileSync("results/v2-replay/report.json", JSON.stringify(report, null, 2));
  writeFileSync("results/v2-replay/report.md", markdown);
}

try {
  if (process.argv.length > 2) throw new Error("This command only replays pinned saved outputs; no live or fallback mode exists.");
  const report = replayEvidence(loadReplay());
  saveReport(report, renderReplayReport(report));
  console.log(`${report.replayPassed ? "PASS" : "FAIL"}: V2 saved-output replay; zero new API calls, no database.`);
  for (const c of report.comparisons) console.log(`${c.role}: baseline ${c.baseline.passed}/${c.baseline.total}; candidate ${c.candidate.passed}/${c.candidate.total}; eligible=${c.eligible}`);
  console.log("Wrote results/v2-replay/report.md and report.json. Captured metrics are historical; replay PASS does not mean every candidate passed.");
  if (!report.replayPassed) process.exitCode = 1;
} catch (error) {
  console.error("V2 replay failed closed; no model or database fallback.", error instanceof Error ? error.message : "Invalid evidence");
  try {
    saveReport({ format: "v2-replay-report-1", replayPassed: false, newApiCalls: 0, databaseUsed: false, error: "Evidence replay did not complete; no current comparison results are available." }, "# V2 saved-output replay\n\n**FAIL**: replay did not complete. No current comparison results are available. Inspect the command error and pinned evidence; no model/database fallback was used.\n");
  } catch { console.error("Could not save the failure report; any existing report is stale and must not be treated as this run's result."); }
  process.exitCode = 1;
}
