import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Artifact, slug } from "../src/lib/artifact";

// Validates before writing so a bad artifact never lands in results/.
export function writeArtifact(a: unknown): string {
  const parsed = Artifact.parse(a);
  slug.parse(parsed.runId);
  mkdirSync("results", { recursive: true });
  const path = join("results", `${parsed.runId}.json`);
  writeFileSync(path, JSON.stringify(parsed, null, 2) + "\n", { flag: "wx" }); // never overwrite a run
  return path;
}

export function newRunId(kind: string, now = new Date()): string {
  return `${kind}-${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
}
