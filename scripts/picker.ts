// npm run picker: train, freeze, then compare learned vs fixed on new cases. No LLM, no database.
import { runPicker, summarize } from "../src/lib/picker";
import { newRunId, writeArtifact } from "./artifact-file";

// Seeds were fixed before the first run and are never changed to improve the result.
const SEEDS = { trainSeed: 11, testSeed: 22, exploreSeed: 33 };

function main() {
  const now = new Date();
  const artifact = runPicker({ runId: newRunId("picker", now), createdAt: now.toISOString(), ...SEEDS });
  const path = writeArtifact(artifact);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
  const pts = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} pts`.padStart(10);
  const arm = (a: { channel: string; window: string; tone: string }) => `${a.channel}/${a.window}/${a.tone}`;

  console.log("Frozen choice per segment (after training):");
  for (const [segment, a] of Object.entries(artifact.selected)) console.log(`  ${segment.padEnd(7)} ${arm(a)}`);
  console.log("\nHeld-out test (new cases, same customers for both strategies). Reward = payment.");
  console.log("segment    n   fixed pay  learned pay   difference   fixed reply  learned reply  difference");
  for (const r of summarize(artifact.trials)) {
    console.log(
      `${r.segment.padEnd(7)} ${String(r.n).padStart(4)}   ${pct(r.fixed.pay)}     ${pct(r.learned.pay)}   ${pts(r.payDiffPts)}     ${pct(r.fixed.respond)}       ${pct(r.learned.respond)}   ${pts(r.respondDiffPts)}`,
    );
  }
  console.log(`\nwrote ${path}`);
  console.log("note: synthetic customers with made-up probabilities; one split, not statistical significance or real-world lift");
}

main();
