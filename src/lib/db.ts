// Database connections for the web app. Pages read with the read-only credential in public mode; only the Try page writes.
import { Pool } from "pg";
import { loadEnv } from "./env";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const env = loadEnv([]);
    const key = env.APP_MODE === "public" ? "DATABASE_URL_READONLY" : "DATABASE_URL";
    const url = env[key];
    if (!url) throw new Error(`Missing required env vars: ${key}`);
    pool = new Pool({ connectionString: url, max: 5 }); // pages run up to 4 queries in parallel
    // Neon drops idle connections (ECONNRESET). The pool discards that client by itself; without a listener the
    // error is unhandled. Logged without the error object, which carries the connection details.
    pool.on("error", dropped);
  }
  return pool;
}

const dropped = (e: NodeJS.ErrnoException) => console.warn(`database: idle connection dropped (${e.code ?? "error"})`);

let lessonsPool: Pool | undefined;

// Write connection for the Try page. Locally the owner login; on the public site the lessons-only login
// (db/ops/try_writer_role.sql), which can add lessons, count their uses, and record daily token use, nothing else.
export function getLessonsPool(): Pool {
  const env = loadEnv([]);
  if (env.APP_MODE !== "public") return getPool();
  if (!lessonsPool) {
    if (!env.DATABASE_URL_LESSONS) throw new Error("Missing required env vars: DATABASE_URL_LESSONS");
    lessonsPool = new Pool({ connectionString: env.DATABASE_URL_LESSONS, max: 2 });
    lessonsPool.on("error", dropped);
  }
  return lessonsPool;
}
