import { z } from "zod";
import { slug } from "../artifact";
import { Scope } from "./contracts";

export const CaseState = z.enum(["open", "investigating", "awaiting_customer", "awaiting_human", "resolved", "closed"]);
export const CaseRecord = z.strictObject({
  ...Scope.shape,
  caseId: slug,
  accountId: slug,
  state: CaseState,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  contactSuppressed: z.boolean(),
});
export type CaseRecord = z.infer<typeof CaseRecord>;

const CaseEvent = z.strictObject({
  type: z.enum(["investigate", "request_customer", "request_human", "resolve", "close", "new_evidence", "reopen", "stop_contact"]),
  actor: z.enum(["system", "customer", "operator"]),
  reason: z.string().trim().min(1).max(2000),
});
const destinations = {
  investigate: "investigating", request_customer: "awaiting_customer", request_human: "awaiting_human",
  resolve: "resolved", close: "closed", new_evidence: "investigating", reopen: "open", stop_contact: "closed",
} as const;

export function transitionCase(rawCase: unknown, rawEvent: unknown): CaseRecord {
  const current = CaseRecord.parse(rawCase);
  const event = CaseEvent.parse(rawEvent);
  const next = destinations[event.type];
  const active = current.state !== "closed" && current.state !== "resolved";
  const allowed = event.type === "stop_contact"
    || (event.type === "close" && current.state === "resolved")
    || (event.type === "reopen" && current.state === "closed" && event.actor === "operator")
    || (event.type === "new_evidence" && current.state !== "closed")
    || (active && next !== current.state && event.type !== "reopen" && event.type !== "new_evidence"
      && (event.actor !== "customer" || event.type === "close" || event.type === "request_human"));
  if (!allowed) throw new Error(`illegal case transition: ${current.state} / ${event.type}`);
  return CaseRecord.parse({ ...current, state: next, revision: current.revision + 1, contactSuppressed: current.contactSuppressed || event.type === "stop_contact" });
}

export const TaskState = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
const taskTransitions: Record<z.infer<typeof TaskState>, z.infer<typeof TaskState>[]> = {
  queued: ["running", "cancelled"], running: ["succeeded", "failed", "cancelled"],
  failed: ["queued", "cancelled"], succeeded: [], cancelled: [],
};
export function transitionTask(rawState: unknown, rawNext: unknown): z.infer<typeof TaskState> {
  const state = TaskState.parse(rawState);
  const next = TaskState.parse(rawNext);
  if (!taskTransitions[state].includes(next)) throw new Error(`illegal task transition: ${state} / ${next}`);
  return next;
}

const Principal = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("visitor"), ...Scope.shape, sessionId: slug }),
  z.strictObject({ kind: z.literal("operator"), operatorId: slug, businessIds: z.array(slug).max(100) }),
]);
const CaseAction = z.enum(["read_case", "post_message", "review_case", "manage_lessons", "reopen_case"]);

// Authorization only: callers must construct this principal from a verified server session.
export function assertCaseAccess(rawPrincipal: unknown, rawCase: unknown, rawAction: unknown): void {
  const principal = Principal.parse(rawPrincipal);
  const resource = CaseRecord.parse(rawCase);
  const action = CaseAction.parse(rawAction);
  const allowed = principal.kind === "operator"
    ? principal.businessIds.includes(resource.businessId)
    : principal.businessId === resource.businessId && principal.workspaceId === resource.workspaceId
      && (action === "read_case" || action === "post_message");
  if (!allowed) throw new Error("case access denied");
}
