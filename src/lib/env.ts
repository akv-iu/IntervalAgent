import { z } from "zod";

export type Need = "db" | "dbReadonly" | "testDb" | "live";

const REQUIRED: Record<Need, string[]> = {
  db: ["DATABASE_URL"],
  dbReadonly: ["DATABASE_URL_READONLY"],
  testDb: ["TEST_DATABASE_URL"],
  live: ["OPENAI_API_KEY", "OPENAI_AGENT_MODEL"],
};

const Base = z.object({
  DATABASE_URL: z.string().optional(),
  TEST_DATABASE_URL: z.string().optional(),
  DATABASE_URL_READONLY: z.string().optional(),
  DATABASE_URL_LESSONS: z.string().optional(),
  APP_MODE: z.enum(["local", "public"]).default("local"),
  LLM_PROVIDER: z.enum(["mock", "mock-bad", "openai", "replay"]).default("mock"),
});
const Live = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_AGENT_MODEL: z.string().optional(),
  RECORD: z.enum(["true", "false"]).default("false"),
  RECORDING_SET: z.string().optional(),
  MAX_ESTIMATED_TOKENS_PER_RUN: z.coerce.number().int().positive().default(100000),
});
// Live settings are only validated (and returned) when a command needs them.
export type Env = z.infer<typeof Base> & Partial<z.infer<typeof Live>>;

// Validates only what the command needs. Errors name variables, never values.
export function loadEnv(needs: Need[], source: Record<string, string | undefined> = process.env): Env {
  const missing = needs.flatMap((n) => REQUIRED[n]).filter((k) => !source[k]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  const schema = needs.includes("live") ? Base.extend(Live.shape) : Base;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid env vars: ${bad}`);
  }
  return parsed.data;
}

export function redact(s: string): string {
  return s
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-[redacted]");
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

// A --limit flag must carry a whole number from 1 to max. A bare flag is an error, not 1.
export function parseLimit(v: string | boolean | undefined, max: number): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!(n >= 1 && n <= max)) throw new Error(`--limit must be a whole number from 1 to ${max}`);
  return n;
}
