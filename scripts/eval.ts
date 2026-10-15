// npm run eval -- [--provider mock|mock-bad|openai|replay] [--set <id>] [--record] [--limit N] [--version baseline|guarded] [--gate]
import { existsSync, readdirSync } from "node:fs";
import { gate, summaryTable } from "../src/lib/checks";
import { loadEnv, parseArgs, parseLimit } from "../src/lib/env";
import { createBudget } from "../src/lib/llm/budget";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";
import { openaiProvider } from "../src/lib/llm/openai";
import { RECORDINGS_DIR, recordingProvider, replayProvider } from "../src/lib/llm/recording";
import type { LlmProvider } from "../src/lib/llm/types";
import { runEval } from "../src/lib/sim/eval";
import { SCENARIOS } from "../src/lib/sim/scenarios";
import { newRunId, writeArtifact } from "./artifact-file";
import { projectEnv } from "./project-env";

function nextLiveSetId(now: Date): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const taken = existsSync(RECORDINGS_DIR) ? readdirSync(RECORDINGS_DIR) : [];
  for (let n = 1; ; n++) if (!taken.includes(`live-${day}-${n}`)) return `live-${day}-${n}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = projectEnv();
  const providerName = String(args.provider ?? fileEnv.LLM_PROVIDER ?? "mock");
  if (args.version !== undefined && args.version !== "baseline" && args.version !== "guarded") {
    throw new Error("--version must be baseline or guarded");
  }
  const versions = args.version ? [args.version as "baseline" | "guarded"] : (["baseline", "guarded"] as const).slice();
  const limit = parseLimit(args.limit, 12);
  const record = args.record === true || fileEnv.RECORD === "true";
  const now = new Date();

  let provider: LlmProvider;
  let budget: ReturnType<typeof createBudget> | undefined;
  if (providerName === "mock") provider = mockProvider();
  else if (providerName === "mock-bad") provider = mockBadProvider();
  else if (providerName === "replay") {
    const setId = String(args.set ?? fileEnv.RECORDING_SET ?? "");
    if (!setId) throw new Error("--provider replay needs --set <recording-set-id>");
    provider = replayProvider(setId, { requireLive: args["allow-mock-set"] !== true });
  } else if (providerName === "openai") {
    const env = loadEnv(["live"], fileEnv); // key and model come from .env only, never the shell
    budget = createBudget(env.MAX_ESTIMATED_TOKENS_PER_RUN!);
    provider = openaiProvider({ apiKey: env.OPENAI_API_KEY!, model: env.OPENAI_AGENT_MODEL!, budget });
    console.log(`LIVE run: model ${provider.model}, token budget ${env.MAX_ESTIMATED_TOKENS_PER_RUN}`);
  } else throw new Error(`unknown --provider ${providerName}; use mock, mock-bad, openai, or replay`);

  if (record && providerName !== "openai") throw new Error("--record is only for live runs");
  const recorder = record ? recordingProvider(provider, nextLiveSetId(now)) : undefined;
  const artifact = await runEval({ runId: newRunId("eval", now), createdAt: now.toISOString(), provider: recorder ?? provider, versions, limit });
  if (budget) artifact.metadata.tokens = { reservedEstimate: budget.used(), actualReported: budget.actual() };

  const scenarioIds = SCENARIOS.slice(0, limit ?? SCENARIOS.length).map((s) => s.id);
  if (recorder) {
    if (artifact.status === "complete") recorder.finish(scenarioIds, versions);
    console.log(`recording set ${recorder.recordingSetId}: ${artifact.status === "complete" ? "complete" : "left INCOMPLETE (run failed), cannot be replayed"}`);
  }

  const path = writeArtifact(artifact);
  console.log(summaryTable(artifact));
  console.log(`\nwrote ${path} (${artifact.status}, provider ${provider.name}${provider.name === "mock-bad" ? ", TEST FIXTURE" : ""})`);
  if (budget) console.log(`tokens: ${budget.actual()} reported by the API, ${budget.used()} reserved by estimate`);

  const g = gate(artifact);
  const label = "release gate (guarded hard checks + full coverage)";
  console.log(g.ok ? `${label}: PASS` : `${label}: FAIL\n- ${g.problems.slice(0, 20).join("\n- ")}`);
  if (artifact.sourceMode !== "live" && artifact.sourceMode !== "replay") console.log("note: mock run, for development only, not release evidence");
  if (args.gate && !g.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
