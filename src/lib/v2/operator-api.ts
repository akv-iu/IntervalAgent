import type { Pool } from "pg";
import { z } from "zod";
import { slug } from "../artifact";
import { caseStore } from "./case-store";
import type { OperatorConfig } from "./operator-config";
import { operatorCookieName, type OperatorAuth } from "./operator-auth";
import { Principal } from "./state";
import { VisitorBusiness } from "./visitor-store";
import { HttpError, readVisitorJson, visitorResponse } from "./visitor-http";

export type OperatorOperation = "auth" | "session" | "case";
const Key = z.strictObject({ businessId: VisitorBusiness, workspaceId: slug, caseId: slug });
const Page = z.strictObject({ afterRevision: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });
function input<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new HttpError(400, "Invalid request.");
  return result.data;
}

export function createOperatorApi(pool: Pool, config: OperatorConfig, auth: OperatorAuth) {
  async function authenticate(request: Request) {
    const cookies = (request.headers.get("cookie") ?? "").split(";").map((s) => s.trim()).filter((s) => s.startsWith(`${operatorCookieName(config)}=`));
    if (cookies.length > 1) throw new HttpError(401, "Operator session required.");
    const verified = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    if (!verified) throw new HttpError(401, "Operator session required.");
    const result = await pool.query(`select o.operator_id,coalesce(array_agg(m.business_id order by m.business_id) filter(where m.business_id is not null),'{}') business_ids
      from v2_auth_session s left join v2_operators o on o.user_id=s."userId" and o.disabled_at is null
      left join v2_operator_memberships m on m.operator_id=o.operator_id and m.revoked_at is null
      where s.id=$1 and s."userId"=$2 and s."expiresAt">clock_timestamp() group by o.operator_id`, [verified.session.id, verified.user.id]);
    if (!result.rows[0]) throw new HttpError(401, "Operator session required.");
    if (!result.rows[0].operator_id || !result.rows[0].business_ids.length) throw new HttpError(403, "Operator business membership required.");
    const principal = Principal.options[1].parse({ kind: "operator", operatorId: result.rows[0].operator_id, businessIds: result.rows[0].business_ids });
    const limited = await pool.query(`update v2_operators set request_window=case when request_window<date_trunc('minute',clock_timestamp()) then date_trunc('minute',clock_timestamp()) else request_window end,
      request_count=case when request_window<date_trunc('minute',clock_timestamp()) then 1 else request_count+1 end
      where operator_id=$1 and disabled_at is null and (request_count<120 or request_window<date_trunc('minute',clock_timestamp())) returning operator_id`, [principal.operatorId]);
    if (!limited.rows.length) throw new HttpError(429, "Operator request limit reached.");
    return principal;
  }
  return {
    async handle(request: Request, operation: OperatorOperation, rawKey?: unknown): Promise<Response> {
      try {
        const host = request.headers.get("host") ?? new URL(request.url).host;
        if (host.toLowerCase() !== new URL(config.origin).host || (request.method !== "GET" && request.headers.get("origin") !== config.origin)) throw new HttpError(403, "Request origin denied.");
        const url = new URL(request.url);
        if (operation === "auth") {
          const path = url.pathname.slice("/api/v2/auth".length);
          const signIn = path === "/sign-in/social" && request.method === "POST";
          const callback = path === "/callback/github" && request.method === "GET";
          const signOut = path === "/sign-out" && request.method === "POST";
          if (!signIn && !callback && !signOut) throw new HttpError(404, "Not found.");
          if ((signIn || signOut) && url.search) throw new HttpError(400, "Invalid request.");
          if (url.search.length > 4096) throw new HttpError(413, "Request too large.");
          let body: string | undefined;
          if (signIn) {
            input(z.strictObject({ provider: z.literal("github") }), await readVisitorJson(request));
            body = JSON.stringify({ provider: "github", callbackURL: `${config.origin}/api/v2/operator/session` });
          } else if (signOut) {
            input(z.strictObject({}), await readVisitorJson(request)); body = "{}";
          }
          if (!signOut) {
            const taken = await pool.query(`insert into v2_auth_limit(singleton,window_start,count) values(true,date_trunc('minute',clock_timestamp()),1)
              on conflict(singleton) do update set window_start=excluded.window_start,count=case when v2_auth_limit.window_start<excluded.window_start then 1 else v2_auth_limit.count+1 end
              where v2_auth_limit.window_start<excluded.window_start or v2_auth_limit.count<60 returning count`);
            if (!taken.rows.length) throw new HttpError(429, "Authentication request limit reached.");
          }
          const headers = new Headers(request.headers);
          for (const key of [...headers.keys()]) if (key.startsWith("x-forwarded-") || key === "forwarded" || key === "content-length") headers.delete(key);
          headers.set("host", new URL(config.origin).host);
          const result = await auth.handler(new Request(`${config.origin}${url.pathname}${url.search}`, { method: request.method, headers, ...(body === undefined ? {} : { body }) }));
          if (result.status >= 400) return visitorResponse({ error: "Authentication request failed." }, result.status);
          if (callback && result.headers.get("location") !== `${config.origin}/api/v2/operator/session`) return visitorResponse({ error: "Authentication request failed." }, 400);
          const secured = new Response(result.body, result);
          secured.headers.set("Cache-Control", "private, no-store"); secured.headers.set("Vary", "Cookie"); secured.headers.set("X-Content-Type-Options", "nosniff");
          secured.headers.set("Referrer-Policy", "no-referrer");
          return secured;
        }
        if (request.method !== "GET") throw new HttpError(405, "Method not allowed.");
        for (const key of url.searchParams.keys()) if (url.searchParams.getAll(key).length > 1) throw new HttpError(400, "Duplicate query parameter.");
        if (operation === "session") input(z.strictObject({}), Object.fromEntries(url.searchParams));
        const page = operation === "case" ? input(Page, Object.fromEntries(url.searchParams)) : undefined;
        const principal = await authenticate(request);
        if (operation === "session") return visitorResponse({ operatorId: principal.operatorId, businessIds: principal.businessIds });
        const key = input(Key, rawKey);
        if (!principal.businessIds.includes(key.businessId)) throw new HttpError(403, "Operator business membership required.");
        const cases = caseStore(pool);
        return visitorResponse({ case: await cases.get(principal, key), facts: await cases.facts(principal, key), history: await cases.history(principal, key, page) });
      } catch (error) {
        if (error instanceof HttpError) return visitorResponse({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
        if (error instanceof Error && error.message === "case not found") return visitorResponse({ error: "Case not found." }, 404);
        return visitorResponse({ error: "Operator access is unavailable. Try again later." }, 503);
      }
    },
  };
}
