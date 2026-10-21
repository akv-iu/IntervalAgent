import type { Pool } from "pg";
import { z } from "zod";
import { formatCents } from "../money";
import { ActivitySnapshot, type ActivityRef } from "./activity";
import { EvidenceRef, Proposal } from "./contracts";
import { Records, previewProposal, sameAccount } from "./records";
import { CaseRecord, Principal, assertCaseAccess } from "./state";
import { transaction } from "./transaction";

const Key = CaseRecord.pick({ businessId: true, workspaceId: true, caseId: true });
const where = "business_id=$1 and workspace_id=$2 and case_id=$3";
const refKey = (r: z.infer<typeof ActivityRef>) => `${r.recordType}/${r.recordId}/${r.version}`;

function evidence(data: Records, record: CaseRecord, ref: z.infer<typeof EvidenceRef>) {
  const tables = { account: data.accounts, invoice: data.invoices, payment: data.payments, allocation: data.allocations, cancellation: data.cancellations, credit: data.credits, policy: data.policies, tool_result: [] };
  const source = tables[ref.recordType].find((r) => r.id === ref.recordId && r.version === ref.version
    && r.businessId === record.businessId && r.workspaceId === record.workspaceId && (!("accountId" in r) || r.accountId === record.accountId));
  const fields: { label: string; value: string }[] = [];
  const add = (label: string, value: string | number) => fields.push({ label, value: String(value) });
  if (source) {
    if ("firstName" in source) { add("Account", source.firstName); add("Currency", source.currency); }
    if ("lines" in source) {
      add("Invoice total", formatCents(source.lines.reduce((total, line) => total + line.amountCents, 0))); add("Due date", source.dueDate);
      for (const line of source.lines.slice(0, 8)) add(`Line ${line.id}`, `${formatCents(line.amountCents)}: ${line.description}. Service: ${line.serviceAt}`);
      if (source.lines.length > 8) add("Line coverage", `First 8 of ${source.lines.length} invoice lines. Additional lines are not shown.`);
    }
    if ("amountCents" in source) add("Amount", formatCents(source.amountCents));
    if ("status" in source) { add("Payment status", source.status); add("Payment reference", source.reference); add("Received", source.receivedAt); }
    if ("invoiceId" in source) add("Invoice", source.invoiceId);
    if ("paymentId" in source) add("Payment", source.paymentId);
    if ("cancellationId" in source) add("Cancellation", source.cancellationId);
    if ("requestedAt" in source) { add("Requested", source.requestedAt); add("Line", source.lineId); }
    if ("cancellationWindowDays" in source) { add("Cancellation window (days)", source.cancellationWindowDays); add("Effective from", source.effectiveFrom); }
  }
  return { recordType: ref.recordType, recordId: ref.recordId, version: ref.version, status: source ? "available" as const : "missing" as const, fields };
}

export function activityStore(pool: Pool) {
  return {
    async read(rawPrincipal: unknown, rawKey: unknown): Promise<ActivitySnapshot> {
      const principal = Principal.parse(rawPrincipal), key = Key.parse(rawKey);
      assertCaseAccess(principal, key, "read_case");
      return transaction(pool, async (c) => {
        await c.query("set transaction isolation level repeatable read, read only");
        if (principal.kind === "visitor") {
          const session = await c.query(`select session_id from v2_visitor_sessions where session_id=$1 and business_id=$2 and workspace_id=$3 and revoked_at is null and expires_at>clock_timestamp()`, [principal.sessionId, key.businessId, key.workspaceId]);
          if (!session.rowCount) throw new Error("visitor session invalid");
        }
        const args = [key.businessId, key.workspaceId, key.caseId];
        const row = (await c.query(`select account_id,state,revision,contact_suppressed,facts from v2_cases where ${where}`, args)).rows[0];
        if (!row) throw new Error("case not found");
        const record = CaseRecord.parse({ ...key, accountId: row.account_id, state: row.state, revision: Number(row.revision), contactSuppressed: row.contact_suppressed });
        const data = Records.parse(row.facts);
        // shortcut: expose only the latest bounded run; add paged run history when operator history needs it.
        const job = (await c.query(`select * from v2_activity_jobs where ${where} order by case_revision desc limit 1`, args)).rows[0];
        if (!job) return ActivitySnapshot.parse({ case: record, execution: null, messages: [], tools: [], evidence: [], evidenceTruncated: false, proposal: null });
        const caseRevision = Number(job.case_revision);
        const allRefs = new Map<string, z.infer<typeof EvidenceRef>>();
        const publicRefs = (raw: unknown) => z.array(EvidenceRef).max(200).parse(raw).map((ref) => {
          if (!sameAccount(ref, record)) throw new Error("foreign activity evidence");
          allRefs.set(refKey(ref), ref);
          return { recordType: ref.recordType, recordId: ref.recordId, version: ref.version };
        });
        const messages = (await c.query(`select * from v2_activity_messages where ${where} and case_revision=$4 order by ordinal limit 18`, [...args, caseRevision])).rows.map((m) => {
          if (m.account_id !== record.accountId) throw new Error("foreign activity message");
          return { ordinal: m.ordinal, parentOrdinal: m.parent_ordinal, sender: m.sender, recipient: m.recipient, kind: m.kind, summary: m.summary, decision: m.decision, evidenceRefs: publicRefs(m.evidence_refs), createdAt: m.created_at.toISOString() };
        });
        const tools = (await c.query(`select * from v2_activity_tools where ${where} and case_revision=$4 order by ordinal limit 28`, [...args, caseRevision])).rows.map((t) => {
          if (t.account_id !== record.accountId) throw new Error("foreign activity tool");
          return { ordinal: t.ordinal, name: t.name, status: t.status, evidenceRefs: publicRefs(t.evidence_refs), createdAt: t.created_at.toISOString(), settledAt: t.settled_at?.toISOString() ?? null };
        });
        let proposal: ActivitySnapshot["proposal"] = null;
        if (job.state === "succeeded" && job.decision === "approve" && (job.mode !== "model_test" || job.guard_decision === "approve") && record.state === "awaiting_human" && !record.contactSuppressed && record.revision === caseRevision + 1 && job.pending_proposal) {
          const pending = Proposal.parse(job.pending_proposal);
          const preview = previewProposal(data, { businessId: record.businessId, workspaceId: record.workspaceId, accountId: record.accountId }, pending);
          if (typeof job.projected_balance !== "string" || !/^\d+$/.test(job.projected_balance) || preview.length !== 1 || preview[0].balanceCents !== Number(job.projected_balance)) throw new Error("invalid proposal preview");
          publicRefs(pending.evidenceRefs);
          proposal = { proposalId: pending.proposalId, sourceCaseRevision: caseRevision, currency: pending.currency, status: "pending_human", policyVersion: pending.policyVersion, actions: pending.actions, projectedBalanceCents: preview[0].balanceCents };
        }
        return ActivitySnapshot.parse({
          case: record,
          execution: {
            caseRevision, state: job.state, attempts: job.attempts, leaseActive: job.lease_active, availableAt: job.available_at.toISOString(), finishedAt: job.finished_at?.toISOString() ?? null,
            mode: job.mode ?? "unavailable", version: job.version, policyVersion: job.policy_version === null ? null : Number(job.policy_version), guardDecision: job.guard_decision,
            usage: job.mode === null ? null : { modelRequests: job.model_calls, toolCalls: job.tool_calls, observedInputTokens: Number(job.observed_input), observedOutputTokens: Number(job.observed_output), unknownModelAttempts: Number(job.unknown_model_attempts), heldTokens: Number(job.held_tokens), chargedTokens: job.charged_tokens },
          },
          messages, tools, evidence: [...allRefs.values()].slice(0, 200).map((ref) => evidence(data, record, ref)), evidenceTruncated: allRefs.size > 200, proposal,
        });
      });
    },
  };
}
