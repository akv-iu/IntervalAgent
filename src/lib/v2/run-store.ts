import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { slug } from "../artifact";
import { AgentRole, ToolRequest } from "./contracts";
import { JobLease } from "./case-store";
import { Records, activePolicy, sameAccount } from "./records";
import { ToolResult } from "./tools";
import { transaction } from "./transaction";

const limits = { modelRequests: 12, toolCalls: 16, tokens: 24000, outputTokens: 600, seconds: 180 } as const;
const DAILY_TOKENS = 24000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const Snapshot = z.strictObject({
  mode: z.literal("mock"), version: z.literal("mock-investigation-2"), recordsHash: digest, policyVersion: z.number().int().positive(),
  instruction: z.string().min(1).max(2000), summary: z.string().min(1).max(1000),
  limits: z.strictObject({ modelRequests: z.literal(12), toolCalls: z.literal(16), tokens: z.literal(24000), outputTokens: z.literal(600), seconds: z.literal(180) }),
  steps: z.array(z.strictObject({ operationKey: slug, request: ToolRequest })).length(2),
});
const Model = z.strictObject({ operationKey: slug, role: AgentRole, inputTokens: z.number().int().min(1).max(limits.tokens-limits.outputTokens), requestHash: digest });
const Tool = z.strictObject({ operationKey: slug, request: ToolRequest });
const Usage = z.strictObject({ input: z.number().int().min(0).max(1000000), output: z.number().int().min(0).max(1000000) }).nullable();
type Lease = z.infer<typeof JobLease>;
type Reason = "model_requests" | "tool_calls" | "tokens" | "daily_tokens" | "deadline" | "operation_attempts" | "reservation_overrun";
export class RunLimit extends Error { constructor(public reason: Reason) { super(`Run limit: ${reason}`); } }
const where = "business_id=$1 and workspace_id=$2 and case_id=$3 and case_revision=$4";
const args = (l: Lease) => [l.businessId, l.workspaceId, l.caseId, l.caseRevision];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, part: unknown) => {
  if (part && typeof part==="object" && !Array.isArray(part)) return Object.fromEntries(Object.entries(part).sort(([a],[b]) => a<b ? -1 : a>b ? 1 : 0));
  return part;
})).digest("hex");
interface RunRow { run_id: string; snapshot: unknown; model_calls: number; tool_calls: number; charged_tokens: number; blocked_reason: Reason | null; within_deadline: boolean }
interface AttemptRow { attempt_id: string; kind: "model" | "tool"; role: string; request: unknown; lease_token: string; status: string; capacity: number; day: string | Date; actual_input: number | null; actual_output: number | null; result: unknown }
type Context = { lease: Lease; run: RunRow; snapshot: z.infer<typeof Snapshot>; records: Records; accountId: string };
type Reservation = { blocked: Reason } | { attemptId: string; result: z.infer<typeof ToolResult> | null };

// Trusted worker storage only; HTTP clients and model outputs never supply this pool or lease.
export function runStore(pool: Pool) {
  async function withRun<T>(rawLease: unknown, fn: (c: PoolClient, context: Context) => Promise<T>): Promise<T> {
    const lease = JobLease.parse(rawLease);
    return transaction(pool, async (c) => {
      const current = (await c.query(`select account_id,facts,state,revision,contact_suppressed from v2_cases where business_id=$1 and workspace_id=$2 and case_id=$3 for update`, args(lease).slice(0,3))).rows[0];
      const job = (await c.query(`select lease_token from v2_case_jobs where ${where} and state='running' and worker_id=$5 and lease_token=$6 and lease_until>clock_timestamp() for update`, [...args(lease), lease.workerId, lease.token])).rows[0];
      if (!current || !job || Number(current.revision)!==lease.caseRevision || current.state!=="investigating" || current.contact_suppressed) throw new Error("worker lease invalid");
      const records = Records.parse(current.facts), accountId = slug.parse(current.account_id);
      let run = (await c.query<RunRow>(`select *,deadline_at>clock_timestamp() within_deadline from v2_case_runs where ${where} for update`, args(lease))).rows[0];
      if (!run) {
        const policy = activePolicy(records, { ...lease, accountId });
        if (!policy) throw new Error("run policy missing");
        const snapshot = Snapshot.parse({ mode: "mock", version: "mock-investigation-2", recordsHash: hash(records), policyVersion: policy.version, limits,
          instruction: "Read scoped account history and effective policy. Pause for human review without publishing or applying changes.",
          summary: "Mock account and policy lookup complete; human review required.",
          steps: [{ operationKey: "account-history", request: { name: "account_history", accountId } }, { operationKey: "policy-lookup", request: { name: "policy_lookup", accountId } }],
        });
        run = (await c.query<RunRow>(`insert into v2_case_runs(business_id,workspace_id,case_id,case_revision,snapshot) values($1,$2,$3,$4,$5) returning *,true within_deadline`, [...args(lease), JSON.stringify(snapshot)])).rows[0];
      }
      const snapshot = Snapshot.parse(run.snapshot);
      if (snapshot.recordsHash!==hash(records)) throw new Error("run records changed");
      return fn(c, { lease, run, snapshot, records, accountId });
    });
  }
  async function block(c: PoolClient, context: Context, reason: Reason): Promise<{ blocked: Reason }> {
    await c.query(`update v2_case_runs set blocked_reason=coalesce(blocked_reason,$5) where ${where}`, [...args(context.lease), reason]);
    return { blocked: reason };
  }
  async function reserve(rawLease: unknown, operationKey: string, kind: "tool" | "model", role: string, request: unknown, capacity: number): Promise<Reservation> {
    return withRun(rawLease, async (c, context) => {
      const { lease, run, snapshot } = context;
      if (kind==="tool" && ToolRequest.parse(request).accountId!==context.accountId) throw new Error("tool account mismatch");
      const prior = (await c.query<AttemptRow>(`select * from v2_run_attempts where ${where} and operation_key=$5 order by ordinal desc`, [...args(lease), operationKey])).rows;
      const latest = prior[0];
      if (latest && (latest.kind!==kind || latest.role!==role || hash(latest.request)!==hash(request))) throw new Error("operation identity conflict");
      if (run.blocked_reason) return { blocked: run.blocked_reason };
      if (!run.within_deadline) return block(c, context, "deadline");
      if (latest?.status==="succeeded") {
        if (kind==="tool") return { attemptId: latest.attempt_id, result: ToolResult.parse(latest.result) };
        throw new Error("model operation already completed");
      }
      if (latest?.status==="reserved" && latest.lease_token===lease.token) throw new Error("operation already reserved");
      if (prior.length>=2) return block(c, context, "operation_attempts");
      if (kind==="model" && run.model_calls>=snapshot.limits.modelRequests) return block(c, context, "model_requests");
      if (kind==="tool" && run.tool_calls>=snapshot.limits.toolCalls) return block(c, context, "tool_calls");
      if (run.charged_tokens+capacity>snapshot.limits.tokens) return block(c, context, "tokens");
      let fundedDay: string | Date | null = null;
      if (capacity) {
        const daily = await c.query(`insert into v2_run_daily_usage(day,charged_tokens) values((clock_timestamp() at time zone 'UTC')::date,$1)
          on conflict(day) do update set charged_tokens=v2_run_daily_usage.charged_tokens+excluded.charged_tokens
          where v2_run_daily_usage.charged_tokens+excluded.charged_tokens<=$2 returning day`, [capacity, DAILY_TOKENS]);
        if (!daily.rows.length) return block(c, context, "daily_tokens");
        fundedDay = daily.rows[0].day;
      }
      const attemptId = randomUUID();
      await c.query(`insert into v2_run_attempts(business_id,workspace_id,case_id,case_revision,run_id,attempt_id,operation_key,ordinal,lease_token,role,kind,request,capacity,day)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14::date,(clock_timestamp() at time zone 'UTC')::date))`,
      [...args(lease), run.run_id, attemptId, operationKey, run.model_calls+run.tool_calls+1, lease.token, role, kind, JSON.stringify(request), capacity, fundedDay]);
      await c.query(`update v2_case_runs set charged_tokens=charged_tokens+$5,model_calls=model_calls+$6,tool_calls=tool_calls+$7 where ${where}`, [...args(lease), capacity, kind==="model" ? 1 : 0, kind==="tool" ? 1 : 0]);
      return { attemptId, result: null };
    });
  }
  async function attempt(c: PoolClient, context: Context, id: string, kind: string) {
    const a = (await c.query<AttemptRow>(`select * from v2_run_attempts where ${where} and attempt_id=$5 and kind=$6 for update`, [...args(context.lease), id, kind])).rows[0];
    if (!a || a.lease_token!==context.lease.token) throw new Error("attempt lease mismatch");
    return a;
  }
  return {
    async open(lease: unknown) { return withRun(lease, async (_c, context) => ({ runId: context.run.run_id, snapshot: context.snapshot })); },
    async reserveModel(lease: unknown, raw: unknown) {
      const input = Model.parse(raw), slot = await reserve(lease, input.operationKey, "model", input.role, input, input.inputTokens+limits.outputTokens);
      if ("blocked" in slot) throw new RunLimit(slot.blocked);
      return { attemptId: slot.attemptId, outputLimit: limits.outputTokens };
    },
    async reserveTool(lease: unknown, raw: unknown) {
      const input = Tool.parse(raw), slot = await reserve(lease, input.operationKey, "tool", "investigator", input.request, 0);
      if ("blocked" in slot) throw new RunLimit(slot.blocked);
      return slot.result ? { kind: "cached" as const, result: slot.result } : { kind: "dispatch" as const, attemptId: slot.attemptId };
    },
    async settleModel(lease: unknown, rawId: unknown, rawUsage: unknown) {
      const id = z.uuid().parse(rawId), usage = Usage.parse(rawUsage);
      return withRun(lease, async (c, context) => {
        const a = await attempt(c, context, id, "model");
        if (a.status!=="reserved") {
          if ((usage===null && a.status==="unknown") || (usage!==null && a.status==="succeeded" && a.actual_input===usage.input && a.actual_output===usage.output)) return;
          throw new Error("usage settlement conflict");
        }
        const delta = usage ? usage.input+usage.output-a.capacity : 0;
        const funding = await c.query(`update v2_run_daily_usage set charged_tokens=charged_tokens+$2 where day=$1`, [a.day, delta]);
        if (funding.rowCount!==1) throw new Error("reservation funding missing");
        await c.query(`update v2_case_runs set charged_tokens=charged_tokens+$5,blocked_reason=case when $6 then 'reservation_overrun' else blocked_reason end where ${where}`, [...args(context.lease), delta, usage!==null && (delta>0 || usage.output>limits.outputTokens)]);
        await c.query(`update v2_run_attempts set status=$2,actual_input=$3,actual_output=$4,settled_at=clock_timestamp() where attempt_id=$1`, [id, usage ? "succeeded" : "unknown", usage?.input ?? null, usage?.output ?? null]);
      });
    },
    async settleTool(lease: unknown, rawId: unknown, rawResult: unknown) {
      const id = z.uuid().parse(rawId), result = ToolResult.parse(rawResult);
      const outcome = await withRun(lease, async (c, context) => {
        const a = await attempt(c, context, id, "tool"), request = ToolRequest.parse(a.request);
        if (request.accountId!==context.accountId || result.name!==request.name) throw new Error("tool checkpoint identity mismatch");
        const scoped = result.status!=="found" ? []
          : result.name==="account_history" ? [result.data.account]
          : result.name==="policy_lookup" ? [result.data]
          : result.name==="invoice_details" ? [result.data.invoice, ...result.data.allocations, ...result.data.credits]
          : result.name==="payment_search" ? [...result.data.payments, ...result.data.allocations]
          : [...result.data.cancellations, ...result.data.credits];
        if (scoped.some((r) => r.businessId!==context.lease.businessId || r.workspaceId!==context.lease.workspaceId || ("accountId" in r && r.accountId!==context.accountId))) throw new Error("checkpoint data scope mismatch");
        const tables = { account: context.records.accounts, invoice: context.records.invoices, payment: context.records.payments, allocation: context.records.allocations, cancellation: context.records.cancellations, credit: context.records.credits, policy: context.records.policies };
        for (const ref of result.evidenceRefs) {
          if (!sameAccount(ref, { ...context.lease, accountId: context.accountId }) || ref.recordType==="tool_result" || !tables[ref.recordType].some((r) => r.businessId===ref.businessId && r.workspaceId===ref.workspaceId && r.id===ref.recordId && r.version===ref.version)) throw new Error("unverifiable checkpoint evidence");
        }
        if (a.status!=="reserved") { if (hash(a.result)===hash(result)) return; throw new Error("tool settlement conflict"); }
        if (context.run.blocked_reason) return { blocked: context.run.blocked_reason };
        if (!context.run.within_deadline) return block(c, context, "deadline");
        await c.query(`update v2_run_attempts set status=$2,result=$3,settled_at=clock_timestamp() where attempt_id=$1`, [id, result.status==="unavailable" ? "failed" : "succeeded", JSON.stringify(result)]);
      });
      if (outcome) throw new RunLimit(outcome.blocked);
    },
  };
}
