import type { Pool } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Principal } from "./state";
import { transaction } from "./transaction";
import { HttpError } from "./visitor-http";

export const VisitorBusiness = z.enum(["northside", "subscriptions"]);
const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
interface SessionRow { session_id: string; business_id: string; workspace_id: string; expires_at: Date }
const sessionOf = (row: SessionRow) => ({ principal: Principal.options[0].parse({ kind: "visitor", sessionId: row.session_id, businessId: row.business_id, workspaceId: row.workspace_id }), expiresAt: row.expires_at });

export function visitorStore(pool: Pool) {
  // shortcut: expired sessions are retained; add explicit retention/cleanup before scaled public use.
  return {
    async start(rawBusiness: unknown) {
      const businessId = VisitorBusiness.parse(rawBusiness), token = randomBytes(32).toString("base64url");
      return transaction(pool, async (c) => {
        const quota = await c.query(`insert into v2_session_limit (singleton,day,count) values (true,(now() at time zone 'UTC')::date,1)
          on conflict (singleton) do update set day=excluded.day,count=case when v2_session_limit.day<>excluded.day then 1 else v2_session_limit.count+1 end
          where v2_session_limit.day<>excluded.day or v2_session_limit.count<200 returning count`);
        if (quota.rowCount !== 1) throw new HttpError(429, "Daily demo workspace limit reached.");
        const row = (await c.query<SessionRow>(`insert into v2_visitor_sessions (session_id,token_hash,business_id,workspace_id) values ($1,$2,$3,$4) returning *`, [`visitor-${randomUUID()}`, hash(token), businessId, `ws-${randomUUID()}`])).rows[0];
        return { ...sessionOf(row), token };
      });
    },
    async read(rawToken: unknown) {
      const token = Token.safeParse(rawToken);
      if (!token.success) return null;
      const row = (await pool.query<SessionRow>(`select session_id,business_id,workspace_id,expires_at from v2_visitor_sessions where token_hash=$1 and expires_at>clock_timestamp() and revoked_at is null`, [hash(token.data)])).rows[0];
      return row ? sessionOf(row) : null;
    },
    async take(sessionId: string) {
      const r = await pool.query(`update v2_visitor_sessions set request_count=case when request_window<=clock_timestamp()-interval '1 minute' then 1 else request_count+1 end,
        request_window=case when request_window<=clock_timestamp()-interval '1 minute' then clock_timestamp() else request_window end
        where session_id=$1 and expires_at>clock_timestamp() and revoked_at is null and (request_count<120 or request_window<=clock_timestamp()-interval '1 minute') returning session_id`, [sessionId]);
      if (r.rowCount !== 1) {
        const active = await pool.query("select session_id from v2_visitor_sessions where session_id=$1 and expires_at>clock_timestamp() and revoked_at is null", [sessionId]);
        if (!active.rows[0]) throw new HttpError(401, "Visitor session required.");
        throw new HttpError(429, "Request limit reached. Try again later.");
      }
    },
    async revoke(rawToken: unknown) {
      const token = Token.safeParse(rawToken);
      if (token.success) await pool.query("update v2_visitor_sessions set revoked_at=clock_timestamp() where token_hash=$1 and revoked_at is null", [hash(token.data)]);
    },
  };
}
