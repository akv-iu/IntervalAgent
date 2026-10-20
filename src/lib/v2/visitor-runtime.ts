// Server request entry only; disabled by default and never uses V1 owner/reader credentials.
import { Pool } from "pg";
import { connection } from "next/server";
import { visitorConfig } from "./visitor-config";
import { createVisitorApi, type VisitorOperation } from "./visitor-api";
import { visitorResponse } from "./visitor-http";

let pool: Pool | undefined;
export async function serveVisitorRequest(request: Request, operation: VisitorOperation, caseId?: string) {
  await connection();
  try {
    const config = visitorConfig();
    if (!config) return visitorResponse({ error: "Not found." }, 404);
    if (!pool) {
      pool = new Pool({ connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10_000 });
      pool.on("error", () => console.error("V2 database connection interrupted."));
    }
    return await createVisitorApi(pool, config).handle(request, operation, caseId);
  } catch { return visitorResponse({ error: "V2 is unavailable. Check its configuration." }, 503); }
}
