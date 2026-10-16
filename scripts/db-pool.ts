import { Pool } from "pg";
import { loadEnv, redact } from "../src/lib/env";
import { projectEnv } from "../src/lib/project-env";

// Scripts use the owner credential from .env (never deployed).
export function ownerPool(): Pool {
  const env = loadEnv(["db"], projectEnv());
  return new Pool({ connectionString: env.DATABASE_URL, max: 2 });
}

export function fail(e: unknown): never {
  console.error(redact(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
