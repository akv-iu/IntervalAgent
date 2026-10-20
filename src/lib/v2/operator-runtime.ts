import { Pool } from "pg";
import { connection } from "next/server";
import { operatorConfig } from "./operator-config";
import { createOperatorAuth } from "./operator-auth";
import { createOperatorApi, type OperatorOperation } from "./operator-api";
import { visitorResponse } from "./visitor-http";

let api: ReturnType<typeof createOperatorApi> | undefined;
export async function serveOperatorRequest(request: Request, operation: OperatorOperation, key?: unknown) {
  await connection();
  try {
    const config = operatorConfig();
    if (!config) return visitorResponse({ error: "Not found." }, 404);
    if (!api) {
      const pool = new Pool({ connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10_000 });
      pool.on("error", () => console.error("V2 operator database connection interrupted."));
      api = createOperatorApi(pool, config, createOperatorAuth(pool, config));
    }
    return await api.handle(request, operation, key);
  } catch { return visitorResponse({ error: "Operator access is unavailable. Check its configuration." }, 503); }
}
