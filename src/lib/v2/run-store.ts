import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { slug } from "../artifact";
import { AgentRole, ToolRequest } from "./contracts";
import { JobLease } from "./case-store";
import { Records, activePolicy, sameAccount } from "./records";
import { ToolResult, toolResultInScope } from "./tools";
import { transaction } from "./transaction";
import { AgentMessage } from "./contracts";
import { MessageStep, MockWorkflow, makeAgentMessage } from "./mock-agents";
import { billingRecipe, billingInstructions } from "./billing";
import { ModelStepSpec, ModelRequests, ModelUsage, modelInputCapacity } from "./model-contracts";
import { parseRoleInput, roleInstruction, rolePrompts, RolePrompts, validateRoleOutput } from "./role-tasks";

const limits = { modelRequests: 12, toolCalls: 16, tokens: 24000, outputTokens: 600, seconds: 180 } as const;
const DAILY_TOKENS = 24000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const Snapshot = z.strictObject({
  mode: z.enum(["mock","model_test"]), version: z.enum(["mock-investigation-2", "mock-workflow-1", "mock-billing-1", "model-billing-test-1"]), recordsHash: digest, policyVersion: z.number().int().positive(),
  model: ModelStepSpec.shape.model.optional(), rolePrompts: RolePrompts.optional(),
  instruction: z.string().min(1).max(2000), summary: z.string().min(1).max(1000),
  limits: z.strictObject({ modelRequests: z.literal(12), toolCalls: z.literal(16), tokens: z.literal(24000), outputTokens: z.literal(600), seconds: z.literal(180) }),
  steps: z.array(z.strictObject({ operationKey: slug, request: ToolRequest })).min(2).max(5),
  workflow: MockWorkflow.optional(),
}).refine((s) => s.version==="mock-investigation-2" ? !s.workflow && s.steps.length===2 : s.version==="mock-workflow-1" ? !!s.workflow && !s.workflow.billing && s.steps.length===2 : !!s.workflow?.billing && s.steps.length>=4, "workflow version mismatch")
  .refine(s=>s.mode==="model_test" ? s.version==="model-billing-test-1" && !!s.model && !!s.rolePrompts : s.version!=="model-billing-test-1" && !s.model && !s.rolePrompts,"run execution profile mismatch");
const Model = z.strictObject({ operationKey: slug, role: AgentRole, inputTokens: z.number().int().min(1).max(limits.tokens-limits.outputTokens), requestHash: digest });
const Tool = z.strictObject({ operationKey: slug, request: ToolRequest });
const Usage = z.strictObject({ input: z.number().int().min(0).max(1000000), output: z.number().int().min(0).max(1000000) }).nullable();
type Lease = z.infer<typeof JobLease>;
type Reason = "model_requests" | "tool_calls" | "tokens" | "daily_tokens" | "deadline" | "operation_attempts" | "reservation_overrun" | "agent_messages";
export class RunLimit extends Error { constructor(public reason: Reason) { super(`Run limit: ${reason}`); } }
const where = "business_id=$1 and workspace_id=$2 and case_id=$3 and case_revision=$4";
const args = (l: Lease) => [l.businessId, l.workspaceId, l.caseId, l.caseRevision];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, part: unknown) => {
  if (part && typeof part==="object" && !Array.isArray(part)) return Object.fromEntries(Object.entries(part).sort(([a],[b]) => a<b ? -1 : a>b ? 1 : 0));
  return part;
})).digest("hex");
interface RunRow { run_id: string; snapshot: unknown; started_at: Date; model_calls: number; tool_calls: number; charged_tokens: number; blocked_reason: Reason | null; within_deadline: boolean }
interface AttemptRow { attempt_id: string; kind: "model" | "tool"; role: string; request: unknown; lease_token: string; status: string; capacity: number; day: string | Date; actual_input: number | null; actual_output: number | null; result: unknown }
type Context = { lease: Lease; run: RunRow; snapshot: z.infer<typeof Snapshot>; records: Records; accountId: string };
type Reservation = { blocked: Reason } | { attemptId: string; attemptNumber: number; result: z.infer<typeof ToolResult> | null };

// Trusted worker storage only; HTTP clients and model outputs never supply this pool or lease.
export function runStore(pool: Pool) {
  async function withRun<T>(rawLease: unknown, fn: (c: PoolClient, context: Context) => Promise<T>, model?: string): Promise<T> {
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
        const source = (await c.query(`select body from v2_case_messages where business_id=$1 and workspace_id=$2 and case_id=$3 and revision=$4`, args(lease))).rows[0];
        if (!source) throw new Error("run source message missing");
        const recipe = billingRecipe(records,{ businessId: lease.businessId, workspaceId: lease.workspaceId, accountId });
        const snapshot = Snapshot.parse({ mode: model ? "model_test" : "mock", version: model ? "model-billing-test-1" : "mock-billing-1", ...(model ? { model,rolePrompts: rolePrompts() } : {}), recordsHash: hash(records), policyVersion: policy.version, limits,
          workflow: { sourceText: source.body, lessonVersion: "none", instructions: billingInstructions, billing: recipe.context },
          instruction: "Read scoped account history and effective policy. Pause for human review without publishing or applying changes.",
          summary: "Mock account and policy lookup complete; human review required.",
          steps: recipe.steps,
        });
        run = (await c.query<RunRow>(`insert into v2_case_runs(business_id,workspace_id,case_id,case_revision,snapshot) values($1,$2,$3,$4,$5) returning *,true within_deadline`, [...args(lease), JSON.stringify(snapshot)])).rows[0];
      }
      const snapshot = Snapshot.parse(run.snapshot);
      if (model && (snapshot.mode!=="model_test" || snapshot.model!==model)) throw new Error("run execution profile conflict");
      if (snapshot.recordsHash!==hash(records)) throw new Error("run records changed");
      return fn(c, { lease, run, snapshot, records, accountId });
    });
  }
  async function block(c: PoolClient, context: Context, reason: Reason): Promise<{ blocked: Reason }> {
    await c.query(`update v2_case_runs set blocked_reason=coalesce(blocked_reason,$5) where ${where}`, [...args(context.lease), reason]);
    return { blocked: reason };
  }
  async function reserve(rawLease: unknown, operationKey: string, kind: "tool" | "model", role: string, request: unknown, capacity: number, modelStep = false): Promise<Reservation> {
    return withRun(rawLease, async (c, context) => {
      const { lease, run, snapshot } = context;
      if (kind==="tool" && ToolRequest.parse(request).accountId!==context.accountId) throw new Error("tool account mismatch");
      if (modelStep) {
        const pin = await readModelStep(c,context,operationKey);
        if (pin.completed_message_id) throw new Error("model operation already completed");
        if (hash(request)!==hash({ operationKey,role: pin.step.sender,inputTokens: modelInputCapacity(pin.requests),requestHash: pin.request_hash })) throw new Error("model request identity conflict");
      }
      const prior = (await c.query<AttemptRow>(`select * from v2_run_attempts where ${where} and operation_key=$5 order by ordinal desc`, [...args(lease), operationKey])).rows;
      const latest = prior[0];
      if (latest && (latest.kind!==kind || latest.role!==role || hash(latest.request)!==hash(request))) throw new Error("operation identity conflict");
      if (run.blocked_reason) return { blocked: run.blocked_reason };
      if (!run.within_deadline) return block(c, context, "deadline");
      if (latest?.status==="succeeded") {
        if (kind==="tool") return { attemptId: latest.attempt_id, attemptNumber: prior.length, result: ToolResult.parse(latest.result) };
        if (!modelStep) throw new Error("model operation already completed");
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
      return { attemptId, attemptNumber: prior.length+1, result: null };
    });
  }
  async function attempt(c: PoolClient, context: Context, id: string, kind: string) {
    const a = (await c.query<AttemptRow>(`select * from v2_run_attempts where ${where} and attempt_id=$5 and kind=$6 for update`, [...args(context.lease), id, kind])).rows[0];
    if (!a || a.lease_token!==context.lease.token) throw new Error("attempt lease mismatch");
    return a;
  }
  async function writeMessage(c: PoolClient, context: Context, step: z.infer<typeof MessageStep>, generate: () => unknown) {
    const { lease, run, snapshot } = context;
    if (!snapshot.workflow) throw new Error("run has no role workflow");
    if (run.blocked_reason) return { blocked: run.blocked_reason };
    if (!run.within_deadline) return block(c, context, "deadline");
    const messageContext = { businessId: lease.businessId, workspaceId: lease.workspaceId, caseId: lease.caseId, accountId: context.accountId, runId: run.run_id, createdAt: new Date().toISOString() };
    const prior = (await c.query(`select message from v2_agent_messages where ${where} and operation_key=$5`, [...args(lease), step.operationKey])).rows[0];
    if (prior) {
      const saved = AgentMessage.parse(prior.message);
      const expected = makeAgentMessage({ ...messageContext, createdAt: saved.createdAt }, step, { kind: saved.kind, payload: saved.payload, evidenceRefs: saved.evidenceRefs });
      if (hash(saved)!==hash(expected)) throw new Error("agent message context conflict");
      return { message: saved };
    }
    const count = (await c.query(`select count(*)::int n from v2_agent_messages where ${where}`, args(lease))).rows[0].n as number;
    if (count>=18) return block(c, context, "agent_messages");
    if (step.parentMessageId) {
      const parent = (await c.query(`select message from v2_agent_messages where ${where} and message_id=$5`, [...args(lease), step.parentMessageId])).rows[0];
      if (!parent) throw new Error("agent message parent missing");
      if (AgentMessage.parse(parent.message).recipient!==step.sender) throw new Error("agent message parent recipient mismatch");
    }
    const message = makeAgentMessage(messageContext, step, generate());
    const observed = (await c.query(`select result from v2_run_attempts where ${where} and kind='tool' and status='succeeded'`, args(lease))).rows.flatMap((r) => ToolResult.parse(r.result).evidenceRefs);
    const observedKeys = new Set(observed.map(hash));
    const refs = [...message.evidenceRefs, ...(message.kind === "proposal" && message.payload.resolution ? message.payload.resolution.evidenceRefs : [])];
    if (refs.some((ref) => !observedKeys.has(hash(ref)))) throw new Error("agent message evidence was not observed");
    const inserted = await c.query(`insert into v2_agent_messages(business_id,workspace_id,case_id,case_revision,run_id,operation_key,message_id,parent_message_id,ordinal,message)
      select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 from v2_case_runs where ${where} and deadline_at>clock_timestamp()
      and exists(select 1 from v2_case_jobs where ${where} and lease_token=$11 and lease_until>clock_timestamp()) returning message_id`,
    [...args(lease), run.run_id, step.operationKey, message.messageId, message.parentMessageId, count+1, JSON.stringify(message), lease.token]);
    if (!inserted.rowCount) {
      const valid = (await c.query(`select lease_until>clock_timestamp() valid from v2_case_jobs where ${where} and lease_token=$5`, [...args(lease),lease.token])).rows[0]?.valid;
      if (!valid) throw new Error("worker lease invalid");
      return block(c, context, "deadline");
    }
    return { message };
  }
  async function settleUsage(c: PoolClient, context: Context, id: string, usage: z.infer<typeof Usage>) {
    const a = await attempt(c, context, id, "model");
    if (a.status!=="reserved") {
      if ((usage===null && a.status==="unknown") || (usage!==null && a.status==="succeeded" && a.actual_input===usage.input && a.actual_output===usage.output)) return;
      throw new Error("usage settlement conflict");
    }
    const delta = usage ? usage.input+usage.output-a.capacity : 0;
    const funding = await c.query(`update v2_run_daily_usage set charged_tokens=charged_tokens+$2 where day=$1`, [a.day, delta]);
    if (funding.rowCount!==1) throw new Error("reservation funding missing");
    await c.query(`update v2_case_runs set charged_tokens=charged_tokens+$5,blocked_reason=case when $6 then 'reservation_overrun' else blocked_reason end where ${where}`, [...args(context.lease), delta, usage!==null && (delta>0 || usage.output>limits.outputTokens)]);
    if (usage!==null && (delta>0 || usage.output>limits.outputTokens)) context.run.blocked_reason="reservation_overrun";
    await c.query(`update v2_run_attempts set status=$2,actual_input=$3,actual_output=$4,settled_at=clock_timestamp() where attempt_id=$1`, [id, usage ? "succeeded" : "unknown", usage?.input ?? null, usage?.output ?? null]);
  }
  async function readModelStep(c: PoolClient, context: Context, operationKey: string) {
    const pin = (await c.query(`select * from v2_model_steps where ${where} and operation_key=$5`, [...args(context.lease),operationKey])).rows[0];
    if (!pin || pin.run_id!==context.run.run_id) throw new Error("model step missing");
    const step = MessageStep.parse(pin.step), requests = ModelRequests.parse(pin.requests);
    if (pin.request_hash!==hash({ step,requests })) throw new Error("model pin changed");
    return { step,requests,request_hash: pin.request_hash as string,completed_message_id: pin.completed_message_id as string | null };
  }
  return {
    async open(lease: unknown) { return withRun(lease, async (_c, context) => ({ runId: context.run.run_id, snapshot: context.snapshot })); },
    async openModelTest(lease: unknown, rawModel: unknown) {
      const model=ModelStepSpec.shape.model.parse(rawModel);
      return withRun(lease,async(_c,context)=>({ runId: context.run.run_id,snapshot: context.snapshot }),model);
    },
    async agentMessage(rawLease: unknown, rawStep: unknown, generate: () => unknown): Promise<AgentMessage> {
      const step = MessageStep.parse(rawStep);
      const outcome = await withRun(rawLease, async (c, context) => {
        if (context.snapshot.mode!=="mock") throw new Error("model-test run cannot use mock messages");
        const model=(await c.query(`select 1 from v2_model_steps where ${where} and operation_key=$5`,[...args(context.lease),step.operationKey])).rows[0];
        if (model) throw new Error("model operation requires model checkpoint");
        return writeMessage(c,context,step,generate);
      });
      if ("blocked" in outcome) throw new RunLimit(outcome.blocked);
      return outcome.message;
    },
    async prepareModelStep(rawLease: unknown, rawSpec: unknown) {
      const spec = ModelStepSpec.parse(rawSpec);
      return withRun(rawLease, async (c,context) => {
        const { lease,run,snapshot }=context;
        if (!snapshot.workflow) throw new Error("run has no role workflow");
        if (spec.task ? snapshot.mode!=="model_test" || snapshot.model!==spec.model : snapshot.mode!=="mock") throw new Error("model task execution profile mismatch");
        const instruction=snapshot.workflow.instructions[spec.step.sender];
        if (spec.task) {
          const input=parseRoleInput(spec.task,spec.input);
          if (!sameAccount(input.scope,{ ...lease,accountId: context.accountId }) || input.sourceText!==snapshot.workflow.sourceText) throw new Error("role input context mismatch");
          const allowed=new Set(snapshot.steps.map((s)=>JSON.stringify(s.request)));
          if (input.allowedTools?.some((r)=>!allowed.has(JSON.stringify(r)))) throw new Error("role input tool allowlist mismatch");
        }
        if (spec.task) roleInstruction(spec.task,spec.step);
        const system=spec.task ? snapshot.rolePrompts![spec.task]
          : `${instruction.version}: ${instruction.text}\nLesson: ${snapshot.workflow.lessonVersion}. Return only a JSON object with kind, payload, evidenceRefs. Routing and identity are assigned by the worker.`;
        const request={ model: spec.model,system,input: spec.input,maxOutputTokens: 600 as const,...(spec.task ? { task: spec.task } : {}) };
        const requests=ModelRequests.parse([request,{ ...request,system: `${system}\nThe previous output was invalid. Correct its schema and use only observed evidence. Do not add identity or routing fields.` }]);
        modelInputCapacity(requests);
        const requestHash=hash({ step: spec.step,requests });
        const prior=(await c.query(`select request_hash from v2_model_steps where ${where} and operation_key=$5`,[...args(lease),spec.step.operationKey])).rows[0];
        if (prior && prior.request_hash!==requestHash) throw new Error("model step identity conflict");
        const first=(await c.query(`select requests->0->>'model' model from v2_model_steps where ${where} limit 1`,args(lease))).rows[0];
        if (first && first.model!==spec.model) throw new Error("run model changed");
        if (!prior) {
          const existing=(await c.query(`select 1 from v2_agent_messages where ${where} and operation_key=$5 union all select 1 from v2_run_attempts where ${where} and operation_key=$5`,[...args(lease),spec.step.operationKey])).rows[0];
          if (existing) throw new Error("model operation identity conflict");
          await c.query(`insert into v2_model_steps(business_id,workspace_id,case_id,case_revision,run_id,operation_key,step,requests,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[...args(lease),run.run_id,spec.step.operationKey,JSON.stringify(spec.step),JSON.stringify(requests),requestHash]);
        }
        const pin=await readModelStep(c,context,spec.step.operationKey);
        if (pin.completed_message_id) {
          const saved=(await c.query(`select message from v2_agent_messages where ${where} and message_id=$5`,[...args(lease),pin.completed_message_id])).rows[0];
          return { kind: "cached" as const,message: AgentMessage.parse(saved.message) };
        }
        return { kind: "dispatch" as const,requests: pin.requests };
      });
    },
    async reserveModelStep(lease: unknown, rawKey: unknown) {
      const operationKey=slug.parse(rawKey);
      const pin=await withRun(lease,(c,context)=>readModelStep(c,context,operationKey));
      const input={ operationKey,role: pin.step.sender,inputTokens: modelInputCapacity(pin.requests),requestHash: pin.request_hash };
      const slot=await reserve(lease,operationKey,"model",input.role,input,input.inputTokens+limits.outputTokens,true);
      if ("blocked" in slot) throw new RunLimit(slot.blocked);
      return { attemptId: slot.attemptId,attemptNumber: slot.attemptNumber };
    },
    async finishModelStep(rawLease: unknown, rawKey: unknown, rawId: unknown, rawUsage: unknown, body: unknown) {
      const operationKey=slug.parse(rawKey),id=z.uuid().parse(rawId),usage=ModelUsage.parse(rawUsage);
      const outcome=await withRun(rawLease,async (c,context)=>{
        const pin=await readModelStep(c,context,operationKey), a=await attempt(c,context,id,"model");
        const expected={ operationKey,role: pin.step.sender,inputTokens: modelInputCapacity(pin.requests),requestHash: pin.request_hash };
        if (hash(a.request)!==hash(expected) || a.role!==pin.step.sender) throw new Error("model attempt identity conflict");
        await settleUsage(c,context,id,usage);
        if (context.run.blocked_reason) return { blocked: context.run.blocked_reason };
        if (!context.run.within_deadline) return block(c,context,"deadline");
        if (pin.completed_message_id) {
          const saved=(await c.query(`select message from v2_agent_messages where ${where} and message_id=$5`,[...args(context.lease),pin.completed_message_id])).rows[0];
          return { message: AgentMessage.parse(saved.message) };
        }
        if (body===null) return { invalid: true as const };
        await c.query("savepoint model_output");
        let output;
        try { validateRoleOutput(pin.requests[0],body); output=await writeMessage(c,context,pin.step,()=>body); }
        catch (error) {
          // Only validation errors permit correction; database failures roll back the whole settlement.
          if (!(error instanceof z.ZodError) && !(error instanceof Error && /agent message (evidence was not observed|parent missing|parent recipient mismatch)/.test(error.message))) throw error;
          await c.query("rollback to savepoint model_output");
          return { invalid: true as const };
        }
        if ("blocked" in output) return output;
        await c.query(`update v2_model_steps set completed_attempt_id=$6,completed_message_id=$7,completed_at=clock_timestamp() where ${where} and operation_key=$5`,[...args(context.lease),operationKey,id,output.message.messageId]);
        return output;
      });
      if ("blocked" in outcome && outcome.blocked) throw new RunLimit(outcome.blocked);
      if ("message" in outcome && outcome.message) return { message: outcome.message };
      return { invalid: true as const };
    },
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
      return withRun(lease, (c, context) => settleUsage(c,context,id,usage));
    },
    async settleTool(lease: unknown, rawId: unknown, rawResult: unknown) {
      const id = z.uuid().parse(rawId), result = ToolResult.parse(rawResult);
      const outcome = await withRun(lease, async (c, context) => {
        const a = await attempt(c, context, id, "tool"), request = ToolRequest.parse(a.request);
        if (request.accountId!==context.accountId || result.name!==request.name) throw new Error("tool checkpoint identity mismatch");
        if (!toolResultInScope(result,{ ...context.lease,accountId: context.accountId })) throw new Error("checkpoint data scope mismatch");
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
