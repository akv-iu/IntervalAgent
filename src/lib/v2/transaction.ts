import type { Pool, PoolClient } from "pg";

export async function transaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  let broken = false;
  try {
    await c.query("begin");
    await c.query("set local lock_timeout='5s'; set local statement_timeout='10s'");
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (error) {
    try { await c.query("rollback"); } catch { broken = true; }
    throw error;
  } finally { c.release(broken); }
}
