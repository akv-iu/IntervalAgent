import { checkFixtures } from "./v2-eval/fixtures";

try {
  const result = checkFixtures();
  console.log(`${result.setId}: ${result.counts.development} development, ${result.counts.validation} validation, ${result.counts.holdout} holdout cases; hashes and public input schemas verified.`);
  console.log("Holdout answers were not evaluated. No model or database calls were made.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "fixture integrity check failed");
  process.exitCode = 1;
}
