import { z } from "zod";
import { slug } from "../artifact";

export const AgentRole = z.enum(["customer", "coordinator", "investigator", "reviewer"]);
export const Scope = z.strictObject({ businessId: slug, workspaceId: slug });
const accountScope = { ...Scope.shape, accountId: slug };
const text = z.string().trim().min(1).max(2000);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const EvidenceRef = z.strictObject({
  ...accountScope,
  recordType: z.enum(["account", "invoice", "payment", "allocation", "cancellation", "credit", "policy", "tool_result"]),
  recordId: slug,
  version,
});

export const ToolName = z.enum(["invoice_details", "payment_search", "account_history", "adjustment_history", "policy_lookup"]);
export const ToolRequest = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("invoice_details"), accountId: slug, invoiceId: slug }),
  z.strictObject({ name: z.literal("payment_search"), accountId: slug }),
  z.strictObject({ name: z.literal("account_history"), accountId: slug }),
  z.strictObject({ name: z.literal("adjustment_history"), accountId: slug }),
  z.strictObject({ name: z.literal("policy_lookup"), accountId: slug }),
]);

const ProposalAction = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("allocate_payment"), paymentId: slug, invoiceId: slug, amountCents: cents }),
  z.strictObject({ type: z.literal("credit_invoice"), invoiceId: slug, cancellationId: slug, amountCents: cents }),
]);

export const Proposal = z.strictObject({
  proposalId: slug,
  accountId: slug,
  currency: z.literal("USD"),
  policyVersion: version,
  approvalRequired: z.literal(true),
  actions: z.array(ProposalAction).min(1).max(8),
  evidenceRefs: z.array(EvidenceRef).min(1).max(24),
}).superRefine((p, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  const first = p.evidenceRefs[0];
  if (p.evidenceRefs.some((e) => e.accountId !== p.accountId || e.businessId !== first?.businessId || e.workspaceId !== first?.workspaceId)) {
    invalid("proposal evidence must belong to one business, workspace and account");
  }
  const recordKeys = p.evidenceRefs.map((e) => `${e.recordType}:${e.recordId}`);
  if (new Set(recordKeys).size !== recordKeys.length) invalid("a record must have one expected version");
  const actionKeys = p.actions.map((a) => `${a.type}:${a.invoiceId}:${a.type === "allocate_payment" ? a.paymentId : a.cancellationId}`);
  if (new Set(actionKeys).size !== actionKeys.length) invalid("duplicate financial action");
  const hasRecord = (type: string, id: string) => p.evidenceRefs.some((e) => e.recordType === type && e.recordId === id);
  for (const a of p.actions) {
    if (!hasRecord("invoice", a.invoiceId)
      || (a.type === "allocate_payment" ? !hasRecord("payment", a.paymentId) : !hasRecord("cancellation", a.cancellationId))) {
      invalid("each financial action needs versioned evidence for its records");
    }
  }
  if (!p.evidenceRefs.some((e) => e.recordType === "policy" && e.version === p.policyVersion)) invalid("proposal needs its effective policy version");
});

export const BusinessConfig = z.strictObject({
  businessId: slug,
  displayName: z.string().trim().min(1).max(100),
  currency: z.literal("USD"),
  policyVersion: version,
  tools: z.array(ToolName).min(1).max(5),
});

const messageContext = {
  ...accountScope,
  caseId: slug,
  runId: slug,
  taskId: slug,
  sender: AgentRole,
  recipient: AgentRole,
  parentMessageId: slug.nullable(),
};
const MessageContext = z.strictObject(messageContext);
const envelope = {
  ...messageContext,
  schemaVersion: z.literal(2),
  messageId: slug,
  evidenceRefs: z.array(EvidenceRef).max(24),
  createdAt: z.iso.datetime(),
  idempotencyKey: slug,
};

const Review = z.strictObject({
  decision: z.enum(["approve", "revise", "escalate"]),
  summary: text,
  requiredChanges: z.array(text).max(8),
}).refine((r) => r.decision === "approve" ? r.requiredChanges.length === 0 : r.decision !== "revise" || r.requiredChanges.length > 0,
  "approval cannot require changes; revision must name a change");

const routes = {
  task_request: ["customer:coordinator", "coordinator:investigator", "coordinator:customer", "coordinator:reviewer"],
  finding: ["investigator:coordinator"],
  clarification_request: ["investigator:coordinator", "reviewer:coordinator", "coordinator:customer"],
  proposal: ["customer:reviewer"],
  review_result: ["reviewer:customer", "reviewer:coordinator"],
  escalation: ["customer:coordinator", "investigator:coordinator", "reviewer:coordinator", "coordinator:customer"],
};

// These envelopes are the four agents' output contracts, not executable instructions.
export const AgentMessage = z.discriminatedUnion("kind", [
  z.strictObject({ ...envelope, kind: z.literal("task_request"), payload: z.strictObject({ instruction: text, toolRequests: z.array(ToolRequest).max(8).optional() }) }),
  z.strictObject({ ...envelope, kind: z.literal("finding"), payload: z.strictObject({ summary: text, uncertainties: z.array(text).max(8) }) }),
  z.strictObject({ ...envelope, kind: z.literal("clarification_request"), payload: z.strictObject({ question: text }) }),
  z.strictObject({ ...envelope, kind: z.literal("proposal"), payload: z.strictObject({ message: text, resolution: Proposal.nullable() }) }),
  z.strictObject({ ...envelope, kind: z.literal("review_result"), payload: Review }),
  z.strictObject({ ...envelope, kind: z.literal("escalation"), payload: z.strictObject({ reason: text }) }),
]).superRefine((m, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!routes[m.kind].includes(`${m.sender}:${m.recipient}`)) invalid("unauthorized agent route");
  if (m.parentMessageId === m.messageId) invalid("a message cannot be its own parent");
  if (m.parentMessageId === null && !(m.kind === "task_request" && m.sender === "customer" && m.recipient === "coordinator")) {
    invalid("only an initial customer task request can have no parent");
  }
  const refs = [...m.evidenceRefs, ...(m.kind === "proposal" && m.payload.resolution ? m.payload.resolution.evidenceRefs : [])];
  if (refs.some((e) => e.businessId !== m.businessId || e.workspaceId !== m.workspaceId || e.accountId !== m.accountId)) {
    invalid("evidence must belong to the message's business, workspace and account");
  }
  const versions = new Map<string, number>();
  for (const ref of refs) {
    const key = `${ref.recordType}:${ref.recordId}`;
    if (versions.has(key) && versions.get(key) !== ref.version) invalid("conflicting evidence versions in message and proposal");
    versions.set(key, ref.version);
  }
  if (m.kind === "proposal" && m.payload.resolution && m.payload.resolution.accountId !== m.accountId) invalid("proposal account mismatch");
  if (m.kind === "task_request" && m.payload.toolRequests) {
    if (m.sender !== "coordinator" || m.recipient !== "investigator") invalid("only coordinator-to-investigator tasks can carry tool requests");
    if (m.payload.toolRequests.some((t) => t.accountId !== m.accountId)) invalid("tool account mismatch");
  }
});
export type AgentMessage = z.infer<typeof AgentMessage>;

// The runtime supplies context from its stored task, never from the model/client.
export function parseAgentMessage(raw: unknown, expected: unknown): AgentMessage {
  const context = MessageContext.parse(expected);
  const message = AgentMessage.parse(raw);
  for (const key of Object.keys(MessageContext.shape) as (keyof typeof context)[]) {
    if (message[key] !== context[key]) throw new Error(`agent message context mismatch: ${key}`);
  }
  return message;
}
