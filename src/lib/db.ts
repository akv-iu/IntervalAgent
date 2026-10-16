// Read connection for the web app. Public mode uses only the read-only credential.
import { Pool } from "pg";
import { loadEnv } from "./env";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const env = loadEnv([]);
    const key = env.APP_MODE === "public" ? "DATABASE_URL_READONLY" : "DATABASE_URL";
    const url = env[key];
    if (!url) throw new Error(`Missing required env vars: ${key}`);
    pool = new Pool({ connectionString: url, max: 3 });
  }
  return pool;
}
