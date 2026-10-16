// npm run db:import -- results/<run-id>.json
import { readFileSync } from "node:fs";
import { importArtifact } from "../src/lib/db-admin";
import { fail, ownerPool } from "./db-pool";

async function main() {
  const file = process.argv[2];
  if (!file || !file.endsWith(".json")) throw new Error("usage: npm run db:import -- results/<run-id>.json");
  const pool = ownerPool();
  try {
    const r = await importArtifact(pool, JSON.parse(readFileSync(file, "utf8")));
    console.log(`imported ${r.runId}: ${r.conversations} conversations, ${r.trials} picker trials`);
  } finally {
    await pool.end();
  }
}
main().catch(fail);
