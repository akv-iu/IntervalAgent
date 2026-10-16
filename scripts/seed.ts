import { seed } from "../src/lib/db-admin";
import { fail, ownerPool } from "./db-pool";

async function main() {
  const pool = ownerPool();
  try {
    const r = await seed(pool);
    console.log(`accounts: ${r.inserted} inserted, ${r.updated} updated, ${r.unchanged} unchanged`);
  } finally {
    await pool.end();
  }
}
main().catch(fail);
