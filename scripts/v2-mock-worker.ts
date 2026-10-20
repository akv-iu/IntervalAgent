import { Pool } from "pg";
import { slug } from "../src/lib/artifact";
import { runMockWorker, runMockWorkerOnce } from "../src/lib/v2/mock-worker";

async function main() {
  const connectionString = process.env.V2_WORKER_DATABASE_URL;
  if (!connectionString) throw new Error("V2_WORKER_DATABASE_URL is required (explicit worker credential; no owner fallback).");
  const workerId = slug.parse(process.env.V2_WORKER_ID ?? `mock-worker-${process.pid}`);
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10_000 });
  pool.on("error", () => console.error("Mock worker database connection interrupted."));
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    if (process.argv.includes("--once")) console.log(await runMockWorkerOnce(pool, workerId));
    else {
      console.log("V2 mock worker running; no model calls or customer replies.");
      await runMockWorker(pool, workerId, controller.signal);
    }
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await pool.end();
  }
}
main().catch(() => { console.error("V2 mock worker stopped. Check V2_WORKER_DATABASE_URL, V2_WORKER_ID and applied migrations."); process.exitCode = 1; });
