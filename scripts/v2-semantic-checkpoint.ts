import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { investigate, ROLE_VERSION } from "../src/lib/v2/agents";
import { MODEL, boundedModel, type ModelCall } from "../src/lib/v2/model";
import { projectEnv } from "../src/lib/project-env";
import { describeFailure } from "../src/lib/v2/failures";
import type { InvestigationResult } from "../src/lib/v2/contracts";
import { reserveTestCall } from "./v2-test-budget";
import { semanticSuite, semanticInput, semanticChecks } from "./v2-semantic-evaluation";

const directory = "results/v2-semantic-20261026-1", budgetPath = `${directory}/budget.json`;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
type Attempt = { id: string; role?: string; result: ModelCall | null };
type Row = { caseId: string; variant: string; sourceRevision: string; roleVersion: string; startedAt: string; elapsedMs: number; calls: Attempt[]; result: InvestigationResult | null; failures: string[]; error?: ReturnType<typeof describeFailure> };

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--live" && !/^--run=[a-z0-9-]{1,50}$/.test(a) && !/^--case=[a-z0-9,-]+$/.test(a) && a !== "--candidate-only")) throw new Error("Unsupported argument");
  const selected = args.find((a) => a.startsWith("--case="))?.slice(7).split(",");
  if (selected?.some((id) => !semanticSuite.cases.some((c) => c.id === id))) throw new Error("Unknown evaluation case");
  if (!args.includes("--live")) { console.log("Offline preparation only; zero API calls.", semanticSuite.version, semanticSuite.cases.map((c) => c.id).join(", ")); return; }
  const run = args.find((a) => a.startsWith("--run="))?.slice(6);
  if (!run) throw new Error("Use a unique --run=name; evidence is never overwritten");
  const env = projectEnv(".env.v2"), apiKey = env.V2_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Configure the existing local V2 API key; do not print it");
  if (git("diff", "--name-only", "HEAD", "--", "src/lib/v2").length) throw new Error("Commit application changes before comparison so the tested revision is reproducible");
  mkdirSync(directory, { recursive: true });
  const reportPath = `${directory}/${run}.json`, claim = openSync(`${directory}/${run}.started`, "wx"); closeSync(claim);
  if (existsSync(reportPath)) throw new Error("Report already exists");
  const baselineDirectory = resolve(directory, "baseline");
  mkdirSync(baselineDirectory, { recursive: true });
  const archive = execFileSync("git", ["archive", "--format=tar", semanticSuite.baselineRevision, "src/lib"]);
  const archivePath = resolve(directory, "baseline.tar"); writeFileSync(archivePath, archive);
  execFileSync("tar", ["-xf", archivePath, "-C", baselineDirectory]);
  const baseline: typeof import("../src/lib/v2/agents") = await import(pathToFileURL(join(baselineDirectory, "src/lib/v2/agents.ts")).href);
  const candidateRevision = git("rev-parse", "HEAD");
  const report = { version: semanticSuite.version, at: new Date().toISOString(), model: MODEL, agentsSdk: "0.21.0", baselineRevision: semanticSuite.baselineRevision, candidateRevision, suiteHash: hash(readFileSync("fixtures/v2/semantic-20261026-1/cases.json")), baselineArchiveHash: hash(archive), transport: "existing boundedModel; default service tier; 1400 output tokens; no automatic retries", budget: { capDollars: 2, reservationDollarsPerAttempt: 0.02, path: budgetPath }, inputs: semanticSuite.cases.filter((c) => !selected || selected.includes(c.id)).map((c) => ({ id: c.id, input: semanticInput(c) })), rows: [] as Row[] };
  const save = () => { writeFileSync(`${reportPath}.tmp`, JSON.stringify(report, null, 2)); renameSync(`${reportPath}.tmp`, reportPath); };
  save();
  for (const sample of semanticSuite.cases.filter((c) => !selected || selected.includes(c.id))) {
    const variants = args.includes("--candidate-only") ? ["candidate"] : report.rows.length % 4 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    for (const variant of variants) {
      const row: Row = { caseId: sample.id, variant, sourceRevision: variant === "baseline" ? semanticSuite.baselineRevision : candidateRevision, roleVersion: variant === "baseline" ? baseline.ROLE_VERSION : ROLE_VERSION, startedAt: new Date().toISOString(), elapsedMs: 0, calls: [], result: null, failures: [] };
      report.rows.push(row); save();
      const signal = AbortSignal.timeout(90_000), start = Date.now();
      const model = boundedModel({ apiKey, signal,
        reserve: async (id) => { reserveTestCall(budgetPath); row.calls.push({ id, result: null }); save(); },
        start: async ({ id, role }) => { row.calls.find((c) => c.id === id)!.role = role; save(); },
        record: async (call) => { row.calls.find((c) => c.id === call.id)!.result = call; save(); },
      });
      try {
        row.result = await (variant === "baseline" ? baseline.investigate : investigate)(structuredClone(semanticInput(sample)), model, signal);
        row.failures = semanticChecks(sample, row.result, variant !== "baseline");
      } catch (error) {
        row.error = error instanceof Error && /^Approved \$[12] test budget/.test(error.message) ? { kind: "test_budget", message: "The approved test reservation cap stopped the run before another provider call." } : describeFailure(error);
        row.failures = ["Run incomplete; no fallback or automatic retry"];
      }
      row.elapsedMs = Date.now() - start; save();
      console.log(sample.id, variant, row.failures.length ? "FAIL" : "STRUCTURED CHECKS PASS", `${row.calls.length} calls`, `${row.elapsedMs}ms`);
      if (row.error) { console.log("Stopped on run failure; inspect saved evidence before retry."); process.exitCode = 1; return; }
    }
  }
  console.log("Saved", reportPath, "Human semantic/wording assessment still required. Budget ledger retained across reruns.");
  if (report.rows.some((r) => r.failures.length)) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error("Comparison stopped before completion.", error instanceof Error && !/sk-/.test(error.message) ? error.message : "Inspect local configuration."); process.exitCode = 1; });
