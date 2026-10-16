import { migrate } from "../src/lib/db-admin";
import { fail, ownerPool } from "./db-pool";

async function main() {
  const pool = ownerPool();
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date, nothing applied");
  } finally {
    await pool.end();
  }
}
main().catch(fail);
