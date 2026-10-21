import type { Pool } from "pg";
import { z } from "zod";
import { slug } from "../artifact";
import { isStop } from "../patterns";
import { activityStore } from "./activity-store";
import { CaseSubmission, caseStore } from "./case-store";
import { workspaceRecords } from "./demo-records";
import type { VisitorConfig } from "./visitor-config";
import { HttpError, readVisitorJson, visitorResponse } from "./visitor-http";
import { VisitorBusiness, visitorStore } from "./visitor-store";

export type VisitorOperation = "session" | "cases" | "case" | "messages" | "activity";
const Start = z.strictObject({ businessId: VisitorBusiness });
const Create = z.strictObject({ caseId: slug, accountId: z.enum(["account-1", "account-2", "account-3"]) });
const Page = z.strictObject({ afterRevision: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });
const publicMessage = (m: { revision: number; role: string; text: string; createdAt: string }) => ({ revision: m.revision, role: m.role, text: m.text, createdAt: m.createdAt });
function input<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new HttpError(400, "Invalid request.");
  return result.data;
}

export function createVisitorApi(pool: Pool, config: VisitorConfig) {
  const sessions = visitorStore(pool), cases = caseStore(pool);
  const name = config.mode === "public" ? "__Host-recovery-v2" : "recovery-v2-local";
  const cookie = (token: string, age: number) => `${name}=${token}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Lax${config.mode === "public" || config.origin.startsWith("https:") ? "; Secure" : ""}`;
  function tokenOf(request: Request) {
    const values = (request.headers.get("cookie") ?? "").split(";").map((s) => s.trim()).filter((s) => s.startsWith(`${name}=`));
    return values.length === 1 ? values[0].slice(name.length + 1) : null;
  }
  async function authenticate(request: Request, limited = true) {
    const session = await sessions.read(tokenOf(request));
    if (!session) throw new HttpError(401, "Visitor session required.");
    if (limited) await sessions.take(session.principal.sessionId);
    return session;
  }
  const publicSession = (s: Awaited<ReturnType<typeof authenticate>>) => ({ businessId: s.principal.businessId, workspaceId: s.principal.workspaceId, expiresAt: s.expiresAt.toISOString() });
  return {
    async handle(request: Request, operation: VisitorOperation, rawCaseId?: string): Promise<Response> {
      try {
        // Next may normalize the internal URL to localhost; validate the incoming Host, never forwarded-host.
        const host = request.headers.get("host") ?? new URL(request.url).host;
        if (host.toLowerCase() !== new URL(config.origin).host) throw new HttpError(403, "Request origin denied.");
        if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== config.origin) throw new HttpError(403, "Request origin denied.");
        if (operation === "session") {
          if (request.method === "DELETE") { await sessions.revoke(tokenOf(request)); return visitorResponse(null, 204, { "Set-Cookie": cookie("", 0) }); }
          if (request.method === "GET") return visitorResponse(publicSession(await authenticate(request)));
          if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
          const start = input(Start, await readVisitorJson(request));
          const existing = await sessions.read(tokenOf(request));
          if (existing) {
            await sessions.take(existing.principal.sessionId);
            if (existing.principal.businessId !== start.businessId) throw new HttpError(409, "End the current session before choosing another business.");
            return visitorResponse(publicSession(existing));
          }
          const started = await sessions.start(start.businessId);
          return visitorResponse(publicSession(started), 201, { "Set-Cookie": cookie(started.token, 86400) });
        }
        const postingMessage = operation === "messages" && request.method === "POST";
        const { principal } = await authenticate(request, !postingMessage);
        const scope = { businessId: principal.businessId, workspaceId: principal.workspaceId };
        if (operation === "cases" && request.method === "POST") {
          const creation = input(Create, await readVisitorJson(request));
          const record = await cases.create(principal, { ...scope, ...creation }, workspaceRecords(scope));
          return visitorResponse({ case: record }, 201);
        }
        const key = { ...scope, caseId: input(slug, rawCaseId) };
        if (operation === "activity" && request.method === "GET") {
          if (new URL(request.url).search) throw new HttpError(400, "Activity does not accept query parameters.");
          return visitorResponse(await activityStore(pool).read(principal, key));
        }
        if (operation === "case" && request.method === "GET") {
          const params = new URL(request.url).searchParams;
          for (const key of params.keys()) if (params.getAll(key).length > 1) throw new HttpError(400, "Duplicate query parameter.");
          const page = input(Page, Object.fromEntries(params));
          const record = await cases.get(principal, key), history = await cases.history(principal, key, page);
          return visitorResponse({ case: record, messages: history.messages.map(publicMessage), nextRevision: history.nextRevision });
        }
        if (operation === "messages" && request.method === "POST") {
          const submission = input(CaseSubmission, await readVisitorJson(request));
          // A valid STOP must not be blocked by the ordinary request budget.
          if (!isStop(submission.text)) await sessions.take(principal.sessionId);
          const result = await cases.append(principal, key, submission);
          return visitorResponse({ case: result.record, message: publicMessage(result.message), duplicate: result.duplicate }, result.duplicate ? 200 : 201);
        }
        throw new HttpError(405, "Method not allowed.");
      } catch (error) {
        if (error instanceof HttpError) return visitorResponse({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
        if (error instanceof Error && error.message === "visitor session invalid") return visitorResponse({ error: "Visitor session required." }, 401);
        if (error instanceof Error && error.message === "case not found") return visitorResponse({ error: "Case not found." }, 404);
        if (error instanceof Error && (/conflict$/.test(error.message) || error.message.startsWith("illegal case transition:"))) return visitorResponse({ error: "Case changed or cannot accept this request. Refresh and retry." }, 409);
        return visitorResponse({ error: "V2 is unavailable. Try again later." }, 503);
      }
    },
  };
}
