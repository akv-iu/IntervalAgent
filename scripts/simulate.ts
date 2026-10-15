import { parseArgs } from "../src/lib/env";
import { runBulk } from "../src/lib/sim/bulk";
import { newRunId, writeArtifact } from "./artifact-file";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 100)) {
    console.error("--limit must be an integer from 1 to 100");
    process.exit(1);
  }
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
