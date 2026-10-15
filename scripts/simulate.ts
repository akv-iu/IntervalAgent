import { parseArgs, parseLimit } from "../src/lib/env";
import { runBulk } from "../src/lib/sim/bulk";
import { newRunId, writeArtifact } from "./artifact-file";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = parseLimit(args.limit, 100);
  const now = new Date();
  const artifact = await runBulk({ runId: newRunId("bulk", now), createdAt: now.toISOString(), limit });
  const path = writeArtifact(artifact);
  const counts: Record<string, number> = {};
  for (const c of artifact.conversations) counts[c.outcome] = (counts[c.outcome] ?? 0) + 1;
  console.log(`wrote ${path} (${artifact.status}, ${artifact.conversations.length} conversations)`);
  console.log(counts);
  if (artifact.status !== "complete") process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
