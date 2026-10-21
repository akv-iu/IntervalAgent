import { z } from "zod";
import { slug } from "../artifact";
import { CaseRecord } from "./state";

const Session = z.object({ businessId: z.enum(["northside", "subscriptions"]), workspaceId: slug, expiresAt: z.iso.datetime() });
export type VisitorSession = z.infer<typeof Session>;
const Message = z.object({ revision: z.number().int().positive(), role: z.enum(["customer", "agent"]), text: z.string().max(2000), createdAt: z.iso.datetime() });
export type VisitorMessage = z.infer<typeof Message>;
const Page = z.object({ case: CaseRecord, messages: z.array(Message).max(100), nextRevision: z.number().int().positive().nullable() });
const Sent = z.object({ case: CaseRecord, message: Message, duplicate: z.boolean() });

export class VisitorRequestError extends Error {
  constructor(public status: number, public retryAt = 0) {
    super(status === 401 ? "Your demo session has ended. Start a new workspace to continue."
      : status === 404 ? "This case or the V2 demo is unavailable."
      : status === 409 ? "The case changed. Refresh, review your message and send again."
      : status === 429 ? "The request limit was reached. Wait before trying again."
      : "The request could not be completed. Refresh access or try again.");
  }
}

async function request<T extends z.ZodType>(path: string, schema: T, method = "GET", body?: unknown, signal?: AbortSignal): Promise<z.output<T>> {
  try {
    const response = await fetch(`/api/v2/${path}`, {
      method, credentials: "same-origin", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const raw = response.headers.get("Retry-After");
      const delay = raw && /^\d+$/.test(raw) ? Date.now() + Number(raw) * 1000 : Date.parse(raw ?? "");
      throw new VisitorRequestError(response.status, response.status === 429 ? Math.max(Date.now() + 1000, Number.isFinite(delay) ? delay : Date.now() + 60_000) : 0);
    }
    return schema.parse(response.status === 204 ? null : await response.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error instanceof VisitorRequestError ? error : new VisitorRequestError(0);
  }
}

export const getVisitorSession = (signal?: AbortSignal) => request("session", Session, "GET", undefined, signal);
export const startVisitorSession = (businessId: VisitorSession["businessId"]) => request("session", Session, "POST", { businessId });
export const endVisitorSession = () => request("session", z.null(), "DELETE");
export const createVisitorCase = () => request("cases", z.object({ case: CaseRecord }), "POST", { caseId: "reference-case", accountId: "account-1" });

function scoped(record: CaseRecord, session: VisitorSession, caseId: string) {
  if (record.businessId !== session.businessId || record.workspaceId !== session.workspaceId || record.caseId !== caseId) throw new VisitorRequestError(0);
}

// shortcut: drain pages for small demo histories; add incremental history loading before long-running cases.
export async function loadVisitorCase(session: VisitorSession, caseId: string, afterRevision: number, signal?: AbortSignal) {
  slug.parse(caseId);
  let cursor = afterRevision;
  let record: CaseRecord | undefined;
  const messages: VisitorMessage[] = [];
  for (;;) {
    const page = await request(`cases/${caseId}?afterRevision=${cursor}&limit=100`, Page, "GET", undefined, signal);
    scoped(page.case, session, caseId);
    record = page.case;
    messages.push(...page.messages);
    if (page.nextRevision === null) return { case: record, messages, cursor: Math.max(cursor, record.revision, ...messages.map((m) => m.revision)) };
    if (page.nextRevision <= cursor) throw new VisitorRequestError(0);
    cursor = page.nextRevision;
  }
}

export async function postVisitorMessage(session: VisitorSession, record: CaseRecord, text: string, idempotencyKey: string) {
  const sent = await request(`cases/${record.caseId}/messages`, Sent, "POST", { text, idempotencyKey, expectedRevision: record.revision });
  scoped(sent.case, session, record.caseId);
  return sent;
}

export function mergeVisitorMessages(before: VisitorMessage[], incoming: VisitorMessage[]) {
  return [...new Map([...before, ...incoming].map((m) => [m.revision, m])).values()].sort((a, b) => a.revision - b.revision);
}
