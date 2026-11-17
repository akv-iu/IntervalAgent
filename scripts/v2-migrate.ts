import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { closeV2Pool, initializeV2 } from "../src/lib/v2/store";

async function main() {
  const path = "results/v2-phase1/spend.json";
  const imported: { reservedCents: number } = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { reservedCents: 0 };
  await initializeV2(imported.reservedCents);
  mkdirSync("results/v2-phase1", { recursive: true });
  writeFileSync("results/v2-phase1/db-budget-required", "Checkpoint and app calls share the database usage ledger. Do not fall back to the file ledger.\n");
  console.log("V2 schema ready in the dedicated loopback database. Usage history retained; local dollar ceiling removed. Model calls are billed to the configured API account.");
}
main().catch(() => { console.error("V2 initialization failed; no V1 database fallback."); process.exitCode = 1; }).finally(closeV2Pool);
