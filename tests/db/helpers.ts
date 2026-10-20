import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "../../src/lib/db-admin";

// Each test file gets its own schema in the throwaway database and drops only that schema.
export async function testSchema() {
  const schema = `test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3, options: `-c search_path=${schema}` });
  try { await migrate(pool); }
  catch (error) {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
    throw error;
  }
  return {
    pool,
    schema,
    async drop() {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    },
  };
}

export async function count(pool: Pool, table: string, where = "true"): Promise<number> {
  const r = await pool.query(`select count(*)::int n from ${table} where ${where}`);
  return r.rows[0].n;
}
