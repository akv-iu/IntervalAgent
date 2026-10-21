import { z } from "zod";
import { slug } from "../artifact";
import { AgentRole, EvidenceRef, Proposal, ToolName } from "./contracts";
import { CaseRecord } from "./state";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = count.min(1);
export const ActivityRef = EvidenceRef.pick({ recordType: true, recordId: true, version: true });
const refs = z.array(ActivityRef);
export const ActivityMessage = z.strictObject({
  ordinal: revision.max(18), parentOrdinal: revision.max(18).nullable(),
  sender: AgentRole, recipient: AgentRole,
  kind: z.enum(["task_request", "finding", "clarification_request", "proposal", "review_result", "escalation"]),
  summary: z.string().min(1).max(2000), decision: z.enum(["approve", "revise", "escalate"]).nullable(),
  evidenceRefs: refs.max(24), createdAt: z.iso.datetime(),
});
export const ActivityTool = z.strictObject({
  ordinal: revision.max(28), name: ToolName, status: z.enum(["pending", "found", "not_found", "unavailable"]),
  evidenceRefs: refs.max(200), createdAt: z.iso.datetime(), settledAt: z.iso.datetime().nullable(),
});
export const ActivitySnapshot = z.strictObject({
  case: CaseRecord,
  execution: z.strictObject({
    caseRevision: revision, state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    attempts: count.max(3), leaseActive: z.boolean(), availableAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
    mode: z.enum(["mock", "model_test", "unavailable"]), version: slug.nullable(), policyVersion: revision.nullable(),
    guardDecision: z.enum(["approve", "revise", "escalate"]).nullable(),
    usage: z.strictObject({
      modelRequests: count.max(12), toolCalls: count.max(16), observedInputTokens: count, observedOutputTokens: count,
      unknownModelAttempts: count.max(12), heldTokens: count, chargedTokens: count,
    }).nullable(),
  }).nullable(),
  messages: z.array(ActivityMessage).max(18), tools: z.array(ActivityTool).max(28),
  evidence: z.array(z.strictObject({
    ...ActivityRef.shape, status: z.enum(["available", "missing"]),
    fields: z.array(z.strictObject({ label: z.string().min(1).max(80), value: z.string().max(2000) })).max(12),
  })).max(200),
  evidenceTruncated: z.boolean(),
  proposal: z.strictObject({
    proposalId: slug, sourceCaseRevision: revision, currency: z.literal("USD"), status: z.literal("pending_human"),
    policyVersion: revision, actions: Proposal.shape.actions, projectedBalanceCents: count,
  }).nullable(),
}).refine((snapshot) => {
  if (!snapshot.proposal) return true;
  const run = snapshot.execution;
  return !!run && run.state === "succeeded" && snapshot.case.state === "awaiting_human" && !snapshot.case.contactSuppressed
    && snapshot.case.revision === run.caseRevision + 1 && snapshot.proposal.sourceCaseRevision === run.caseRevision
    && snapshot.proposal.policyVersion === run.policyVersion && (run.mode !== "model_test" || run.guardDecision === "approve");
}, "pending proposal must match the completed current investigation");
export type ActivitySnapshot = z.infer<typeof ActivitySnapshot>;
