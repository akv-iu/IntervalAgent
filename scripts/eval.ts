// npm run eval -- [--provider mock|mock-bad] [--limit N] [--version baseline|guarded] [--gate]
import { gate, summaryTable } from "../src/lib/checks";
import { parseArgs, parseLimit } from "../src/lib/env";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";
import { runEval } from "../src/lib/sim/eval";
import { newRunId, writeArtifact } from "./artifact-file";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providerName = String(args.provider ?? "mock");
  const provider = providerName === "mock" ? mockProvider() : providerName === "mock-bad" ? mockBadProvider() : null;
  if (!provider) throw new Error(`--provider ${providerName} is not available yet; use mock or mock-bad`);
  if (args.version !== undefined && args.version !== "baseline" && args.version !== "guarded") {
    throw new Error("--version must be baseline or guarded");
  }
  const versions = args.version ? [args.version as "baseline" | "guarded"] : (["baseline", "guarded"] as const).slice();
  const limit = parseLimit(args.limit, 12);

  const now = new Date();
  const artifact = await runEval({ runId: newRunId("eval", now), createdAt: now.toISOString(), provider, versions, limit });
  const path = writeArtifact(artifact);
  console.log(summaryTable(artifact));
  console.log(`\nwrote ${path} (${artifact.status}, provider ${provider.name}${provider.name === "mock-bad" ? ", TEST FIXTURE" : ""})`);

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
