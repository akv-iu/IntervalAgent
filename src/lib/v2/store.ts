import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { projectEnv } from "../project-env";
import { isGlobalStop } from "./contact";
import { findThreats } from "../patterns";
import { localDate, localToInstant } from "../time";
import { openingMessage, startingCases } from "./fixtures";
import { CaseCommand, ROLE_VERSION, validateUpdates, validateVerification, type Activity, type CaseUpdate, type Investigation, type InvestigationResult } from "./contracts";
import type { ModelCall } from "./model";
import type { RunFailure } from "./failures";

export class V2Error extends Error { constructor(public status: number, message: string) { super(message); } }
export type PlannedEvent = { id: string; sourceMessageId: string; channel: "call" | "email"; date: string; window: string; timezone: string; state: "planned" | "superseded" | "blocked"; beyondExpiry: boolean };
export type RunStep = { id: string; role: string; state: "started" | "completed"; at: string; tools?: string[] };
export type FinishedRun = { id: string; startedAt: string; finishedAt: string; durationMs: number; calls: number; steps: RunStep[]; outcome: "completed" | "blocked" | "failed" | "interrupted"; failure?: RunFailure };
export type OperatorCorrection = NonNullable<Investigation["operatorFeedback"]> & { at: string; revision: number; runId?: string; outcome?: FinishedRun["outcome"]; result?: InvestigationResult };
export type CaseState = Investigation & {
  revision: number; turns: number; businessReplies: number; stopped: boolean; takeover: boolean;
  reviewHold?: boolean;
  status: "ready" | "processing" | "awaiting_business" | "needs_review" | "run_failed" | "stopped" | "taken_over";
  requestId: string | null; run: { id: string; revision: number; startedAt: string; calls?: number; lastCompletedRole?: string; activeCallId?: string; activeRole?: string; steps?: RunStep[] } | null;
  lastRun?: FinishedRun;
  corrections?: OperatorCorrection[];
  updates: CaseUpdate[]; events: PlannedEvent[]; activity: Activity[];
  preferredChannel: "call" | "email" | null;
  commands: { id: string; fingerprint: string }[]; retries: number;
  audit: { id: string; at: string; before: CaseUpdate[]; after: CaseUpdate[]; balanceBeforeCents?: number; balanceAfterCents?: number; review: InvestigationResult["review"]; roleVersion: string; sourceVersion: string; sourceMessageIds: string[]; replyId: string | null; runtime?: FinishedRun; correctionId?: string }[];
  lastReview: InvestigationResult | null;
};
type Workspace = { cases: Record<string, CaseState>; resets: number };
export type WorkspaceView = Workspace & { expiresAt: string };
export type Job = { id: string; revision: number; caseId: string; input: Investigation };
export type Command = CaseCommand;
let pool: Pool | undefined;

export function v2Config() {
  const env = projectEnv(".env.v2");
  if (env.V2_ENABLED !== "true" || !env.V2_DATABASE_URL) throw new V2Error(503, "V2 is disabled. Configure the isolated local demo first.");
  const url = new URL(env.V2_DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "55442" || url.pathname !== "/intervalagent_v2") throw new V2Error(503, "Phase 1 requires its dedicated loopback database; V1 connections are refused.");
  return { databaseUrl: env.V2_DATABASE_URL, apiKey: env.V2_OPENAI_API_KEY || process.env.OPENAI_API_KEY };
}

export function v2Pool() {
  if (!pool) {
    pool = new Pool({ connectionString: v2Config().databaseUrl, max: 4, connectionTimeoutMillis: 3000 });
    pool.on("error", () => console.warn("V2 database connection dropped"));
  }
  return pool;
}
export async function closeV2Pool() { await pool?.end(); pool = undefined; }
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await v2Pool().connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function initializeV2(importedReservedCents: number) {
  if (!Number.isSafeInteger(importedReservedCents) || importedReservedCents < 0 || !Number.isSafeInteger(importedReservedCents * 10_000)) throw new Error("Invalid imported checkpoint reservation");
  await transaction(async (client) => {
    await client.query(`CREATE SCHEMA IF NOT EXISTS rebuild_v2;
      CREATE TABLE IF NOT EXISTS rebuild_v2.workspaces (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS rebuild_v2.admission (day date PRIMARY KEY, count integer NOT NULL);
      CREATE TABLE IF NOT EXISTS rebuild_v2.budget (id integer PRIMARY KEY CHECK(id=1), used_micros integer NOT NULL CHECK(used_micros>=0));
      ALTER TABLE rebuild_v2.budget DROP CONSTRAINT IF EXISTS budget_used_micros_check;
      ALTER TABLE rebuild_v2.budget ADD CONSTRAINT budget_used_micros_check CHECK(used_micros>=0);
      CREATE TABLE IF NOT EXISTS rebuild_v2.reservations (id uuid PRIMARY KEY, cost_micros integer NOT NULL, input_tokens integer, output_tokens integer);
      ALTER TABLE rebuild_v2.reservations ADD COLUMN IF NOT EXISTS role text;
      ALTER TABLE rebuild_v2.reservations ADD COLUMN IF NOT EXISTS latency_ms integer;
      ALTER TABLE rebuild_v2.reservations ADD COLUMN IF NOT EXISTS tools jsonb;
    `);
    await client.query("INSERT INTO rebuild_v2.budget(id,used_micros) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET used_micros=GREATEST(rebuild_v2.budget.used_micros,EXCLUDED.used_micros)", [importedReservedCents * 10_000]);
  });
}

function freshWorkspace(at: Date): Workspace {
  return { resets: 0, cases: Object.fromEntries(startingCases(at).map((facts) => [facts.id, {
    facts, messages: [openingMessage(facts, at)], now: at.toISOString(), verification: null, revision: 0, turns: 0, businessReplies: 0,
    stopped: false, takeover: false, status: "ready", requestId: null, run: null, updates: [], events: [], activity: [], preferredChannel: null, commands: [], retries: 0, audit: [], lastReview: null,
  } satisfies CaseState])) };
}

export async function createWorkspace() {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
  const data = freshWorkspace(now);
  await transaction(async (client) => {
    const admitted = await client.query("INSERT INTO rebuild_v2.admission(day,count) VALUES(CURRENT_DATE,1) ON CONFLICT(day) DO UPDATE SET count=rebuild_v2.admission.count+1 WHERE rebuild_v2.admission.count<20 RETURNING count");
    if (!admitted.rowCount) throw new V2Error(429, "Today's workspace admission limit is reached.");
    await client.query("DELETE FROM rebuild_v2.workspaces WHERE token_hash IN (SELECT token_hash FROM rebuild_v2.workspaces WHERE expires_at<=NOW() LIMIT 10)");
    await client.query("INSERT INTO rebuild_v2.workspaces(token_hash,expires_at,data) VALUES($1,$2,$3)", [tokenHash(token), expiresAt, data]);
  });
  return { token, view: { ...data, expiresAt } satisfies WorkspaceView };
}

async function workspaceAction<T>(token: string, fn: (data: Workspace, expiresAt: string, client: PoolClient) => Promise<T> | T) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new V2Error(401, "Start a private workspace.");
  return transaction(async (client) => {
    const result = await client.query<{ data: Workspace; expires_at: Date }>("SELECT data,expires_at FROM rebuild_v2.workspaces WHERE token_hash=$1 FOR UPDATE", [tokenHash(token)]);
    const row = result.rows[0];
    if (!row) throw new V2Error(401, "Workspace is unavailable. Start a new private workspace.");
    if (row.expires_at.getTime() <= Date.now()) throw new V2Error(410, "Workspace expired. Its state cannot be restored.");
    // Add new demo cases using the original workspace clock, without replacing saved cases or extending access.
    const additions = freshWorkspace(new Date(row.expires_at.getTime() - 86_400_000));
    for (const [id, state] of Object.entries(additions.cases)) if (!Object.hasOwn(row.data.cases, id)) row.data.cases[id] = state;
    for (const c of Object.values(row.data.cases)) {
      // Upgrade untouched legacy cases under the row lock; never rewrite a started or stopped conversation.
      if (!c.messages.length && c.turns === 0 && c.businessReplies === 0 && !c.commands.length && !c.audit.length && !c.run && c.status === "ready" && !c.stopped && !c.takeover && !c.reviewHold)
        c.messages.push(openingMessage(c.facts, new Date()));
    }
    const value = await fn(row.data, row.expires_at.toISOString(), client);
    await client.query("UPDATE rebuild_v2.workspaces SET data=$2 WHERE token_hash=$1", [tokenHash(token), row.data]);
    return value;
  });
}

function finishRun(c: CaseState, outcome: FinishedRun["outcome"]) {
  if (!c.run) return;
  const finishedAt = new Date();
  c.lastRun = { id: c.run.id, startedAt: c.run.startedAt, finishedAt: finishedAt.toISOString(), durationMs: Math.max(0, finishedAt.getTime() - Date.parse(c.run.startedAt)), calls: c.run.calls ?? 0, steps: c.run.steps ?? [], outcome };
  const correction = c.corrections?.find((item) => item.runId === c.run?.id);
  if (correction) correction.outcome = outcome;
  c.run = null;
}

export async function readWorkspace(token: string): Promise<WorkspaceView> {
  return workspaceAction(token, (data, expiresAt) => {
    for (const c of Object.values(data.cases)) if (c.status === "needs_review" && c.lastRun?.outcome === "failed" && !c.stopped && !c.takeover && !c.reviewHold) c.status = "run_failed";
    for (const c of Object.values(data.cases)) if (c.run && Date.now() - Date.parse(c.run.startedAt) > 95_000) {
      c.revision++; finishRun(c, "interrupted"); c.status = c.stopped ? "stopped" : c.takeover ? "taken_over" : "run_failed";
      c.activity.push({ role: "reviewer", action: "interrupted", summary: "Run interrupted. Read saved state before an explicit retry." });
    }
    return { ...data, expiresAt };
  });
}

export async function resetWorkspace(token: string) {
  return workspaceAction(token, (data, expiresAt) => {
    if (data.resets >= 3) throw new V2Error(429, "Workspace reset limit reached.");
    const fresh = freshWorkspace(new Date());
    // A new revision range fences any old run even if a case ID is reused.
    for (const [id, c] of Object.entries(fresh.cases)) c.revision = (data.cases[id]?.revision ?? 0) + 1;
    data.cases = fresh.cases; data.resets++;
    return { ...data, expiresAt };
  });
}

export async function beginCommand(token: string, command: Command): Promise<Job | null> {
  if (!CaseCommand.safeParse(command).success) throw new V2Error(400, "Invalid case action or correction.");
  return workspaceAction(token, (data) => {
    const c = Object.hasOwn(data.cases, command.caseId) ? data.cases[command.caseId] : undefined;
    if (!c) throw new V2Error(404, "Case is outside this workspace.");
    const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const previous = c.commands.find((entry) => entry.id === command.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new V2Error(409, "Command ID was already used with different content.");
      return null;
    }
    const stop = command.action === "customer" && command.text && isGlobalStop(command.text);
    if (!stop && c.commands.length >= 60) throw new V2Error(429, "Case action limit reached. History and STOP remain available.");
    if (c.stopped && stop) return null;
    c.commands.push({ id: command.id, fingerprint });
    let operatorFeedback: Investigation["operatorFeedback"];
    if (command.action === "correct" || command.action === "retry_correction") {
      if (c.stopped) throw new V2Error(409, "Contact is stopped. A correction cannot resume contact.");
      if (c.run || command.revision !== c.revision) throw new V2Error(409, "Case changed or is running. Refresh before correcting it.");
      if (command.action === "correct") {
        if (!c.lastReview || c.audit.at(-1)?.id !== command.targetAuditId) throw new V2Error(409, "Correction must target this case's latest reviewed attempt.");
        if ((c.corrections?.length ?? 0) >= 6) throw new V2Error(429, "Case correction limit reached.");
        c.revision++;
        (c.corrections ??= []).push({ correctionId: command.id, targetAuditId: command.targetAuditId, targetRole: command.targetRole, text: command.text.trim(), original: structuredClone(c.lastReview), at: new Date().toISOString(), revision: c.revision });
        c.takeover = true; c.status = "taken_over";
        c.activity.push({ role: command.targetRole, action: "operator_correction_saved", summary: "Operator saved case-specific feedback. No model run or record change was performed." });
        return null;
      }
      const correction = c.corrections?.find((item) => item.correctionId === command.correctionId);
      if (!correction || correction.runId || correction.revision !== c.revision || correction.targetAuditId !== c.audit.at(-1)?.id) throw new V2Error(409, "Correction is stale or already attempted. Save fresh feedback against the current case.");
      if (c.retries >= 6) throw new V2Error(429, "Case retry limit reached.");
      c.retries++; correction.runId = command.id;
      operatorFeedback = { correctionId: correction.correctionId, targetAuditId: correction.targetAuditId, targetRole: correction.targetRole, text: correction.text, original: structuredClone(correction.original) };
      // This explicit operator action resumes replies; it does not grant financial or evidence authority.
      c.takeover = false; c.reviewHold = false;
    }
    if (command.action === "takeover" || command.action === "resume") {
      if (command.action === "resume") c.reviewHold = false;
      c.takeover = command.action === "takeover"; c.revision++; finishRun(c, "interrupted");
      c.status = c.stopped ? "stopped" : c.reviewHold ? "needs_review" : c.takeover ? "taken_over" : "ready";
      return null;
    }
    const text = command.action === "retry_correction" ? undefined : command.text?.trim();
    if (command.action === "customer" && text && isGlobalStop(text)) {
      if (!c.stopped) c.messages.push({ id: command.id, text, channel: "customer", speaker: "customer", at: new Date().toISOString() });
      c.stopped = true; c.status = "stopped"; c.revision++; finishRun(c, "interrupted");
      for (const e of c.events) if (e.state === "planned") e.state = "blocked";
      return null;
    }
    if (command.action === "business" && command.requestId && c.messages.some((m) => m.channel === "business" && m.speaker === "agent" && m.requestId === command.requestId) && (c.stopped || command.requestId !== c.requestId || !c.verification || !["awaiting_business", "needs_facts", "pending", "conflicting"].includes(c.verification.outcome))) {
      if (!text) throw new V2Error(400, "A business reply is required.");
      if (c.businessReplies >= 10) throw new V2Error(429, "Business reply limit reached.");
      c.businessReplies++; c.revision++; finishRun(c, "interrupted");
      c.messages.push({ id: command.id, text, channel: "business", speaker: "business", at: new Date().toISOString(), requestId: command.requestId, disposition: "late" });
      c.activity.push({ role: "business_verification", action: "late_reply_retained", summary: "Late business evidence retained for operator attention. No conclusion, reply or balance was changed." });
      c.status = c.stopped ? "stopped" : c.takeover ? "taken_over" : "needs_review";
      return null;
    }
    if (c.stopped) throw new V2Error(409, "Contact is stopped. History remains available.");
    if (command.action === "customer") {
      if (c.turns >= 10) throw new V2Error(429, "Customer turn limit reached. History and STOP remain available.");
      if (!text) throw new V2Error(400, "A customer message is required.");
      c.turns++;
    } else if (command.action === "business") {
      if (!c.requestId || command.requestId !== c.requestId) throw new V2Error(409, "Reply must match the current verification request.");
      if (!c.verification || !["awaiting_business", "needs_facts", "pending", "conflicting"].includes(c.verification.outcome)) throw new V2Error(409, "This request is no longer awaiting a reply.");
      if (c.businessReplies >= 10) throw new V2Error(429, "Business reply limit reached.");
      if (!text) throw new V2Error(400, "A business reply is required.");
      c.businessReplies++;
    } else if (command.action !== "retry_correction") {
      if (!c.messages.some((m) => m.speaker !== "agent")) throw new V2Error(409, "There is no message to retry.");
      if (c.retries >= 6) throw new V2Error(429, "Case retry limit reached.");
      c.retries++;
    }
    if (text && command.action !== "retry") c.messages.push({ id: command.id, text, channel: command.action === "business" ? "business" : "customer", speaker: command.action === "business" ? "business" : "customer", at: new Date().toISOString(), ...(command.action === "business" ? { requestId: c.requestId! } : {}) });
    finishRun(c, "interrupted");
    c.revision++; c.now = new Date().toISOString();
    if (c.takeover || c.reviewHold) { c.status = c.reviewHold ? "needs_review" : "taken_over"; c.run = null; return null; }
    c.status = "processing";
    delete c.lastRun;
    c.run = { id: command.id, revision: c.revision, startedAt: c.now };
    return { id: command.id, revision: c.revision, caseId: command.caseId, input: structuredClone({ facts: c.facts, messages: c.messages, now: c.now, verification: c.verification, requestId: c.requestId, caseUpdates: c.updates, ...(operatorFeedback ? { operatorFeedback } : {}) }) };
  });
}

export async function commitResult(token: string, job: Job, result: InvestigationResult) {
  return workspaceAction(token, (data, expiresAt) => {
    const c = data.cases[job.caseId];
    if (!c || c.revision !== job.revision || c.run?.id !== job.id || c.stopped || c.takeover) throw new V2Error(409, "Newer input, STOP, reset or takeover superseded this run.");
    c.lastReview = result; c.activity.push(...result.activity, { role: "customer", action: "run_complete", summary: `${c.run.calls ?? 0} model calls completed in ${((Date.now() - Date.parse(c.run.startedAt)) / 1000).toFixed(1)}s.` }); c.activity = c.activity.slice(-150); finishRun(c, result.review.accepted ? "completed" : "blocked");
    const audit: CaseState["audit"][number] = { id: job.id, at: new Date().toISOString(), before: [...c.updates], after: [...c.updates], balanceBeforeCents: c.facts.balanceCents, balanceAfterCents: c.facts.balanceCents, review: result.review, roleVersion: ROLE_VERSION, sourceVersion: job.input.facts.sourceVersion, sourceMessageIds: job.input.messages.filter((m) => m.speaker !== "agent").map((m) => m.id), replyId: result.review.accepted ? `${job.id}-reply` : null };
    c.audit.push(audit);
    audit.runtime = c.lastRun;
    if (job.input.operatorFeedback) {
      const correction = c.corrections?.find((item) => item.runId === job.id);
      if (!correction || correction.correctionId !== job.input.operatorFeedback.correctionId) throw new V2Error(409, "Correction run is no longer linked to this case.");
      correction.result = structuredClone(result); audit.correctionId = correction.correctionId;
    }
    if (!result.review.accepted) { c.status = "needs_review"; return; }
    if ([result.draft.reply, result.verification?.businessMessage ?? ""].some((text) => findThreats(text).length > 0)) throw new V2Error(409, "Communication failed the preserved threat/false-claim guard.");
    if (result.verification) validateVerification(result.verification, job.input);
    const updates = validateUpdates(result.resolution?.updates ?? [], { ...job.input, facts: c.facts, now: c.now, verification: result.verification });
    if (job.input.operatorFeedback && updates.some((u) => u.kind === "payment_recognized")) throw new V2Error(409, "A correction retry cannot record or replay a payment. Use the normal evidence workflow.");
    if (updates.some((u) => u.kind === "payment_recognized") && (result.draft.needsOperator || result.resolution?.needsOperator)) throw new V2Error(409, "Operator approval is required before this payment can be recognized.");
    for (const update of updates) {
      if ("date" in update && update.kind !== "payment_recognized" && update.date < localDate(new Date(c.now), c.facts.timezone)) throw new V2Error(409, "Past dates need clarification before recording a new promise/request.");
      if (update.kind === "payment_recognized" && update.date > localDate(new Date(c.now), c.facts.timezone)) throw new V2Error(409, "Future payments cannot be recognized.");
      if (c.updates.some((u) => JSON.stringify(u) === JSON.stringify(update))) continue;
      c.updates.push(update);
      if (update.kind === "payment_recognized") {
        c.facts.payments.push({ id: `business-${c.requestId}`, invoiceId: update.invoiceId, amountCents: update.amountCents, date: update.date, status: "settled", includedInBalance: true, provenance: "business_confirmation", businessMessageId: update.businessMessageId, requestId: c.requestId!, reference: update.reference });
        c.facts.balanceCents -= update.amountCents;
        c.facts.balanceAsOf = new Date().toISOString();
        c.facts.sourceVersion = `${c.facts.sourceVersion}:recognized:${c.requestId}`;
      }
      if (update.kind === "contact_preference" || update.kind === "contact_requested") {
        c.preferredChannel = update.channel;
        for (const e of c.events) if (e.state === "planned" && e.channel !== update.channel) e.state = "superseded";
      }
      if (update.kind === "contact_requested") {
        for (const e of c.events) if (e.state === "planned") e.state = "superseded";
        const endHour = { morning: 12, afternoon: 17, evening: 21, unspecified: 24 }[update.window];
        c.events.push({ ...update, id: randomUUID(), timezone: c.facts.timezone, state: "planned", beyondExpiry: localToInstant(update.date, endHour, 0, c.facts.timezone).getTime() > Date.parse(expiresAt) });
      }
    }
    audit.after = [...c.updates];
    audit.balanceAfterCents = c.facts.balanceCents;
    if (result.verification?.claimMessageId !== c.verification?.claimMessageId) c.requestId = null;
    c.verification = result.verification;
    if (result.verification?.businessMessage) {
      c.requestId ??= randomUUID();
      if (c.messages.filter((m) => m.channel === "business" && m.speaker === "agent").at(-1)?.text !== result.verification.businessMessage)
        c.messages.push({ id: `${job.id}-business`, channel: "business", speaker: "agent", text: result.verification.businessMessage, at: new Date().toISOString(), requestId: c.requestId });
    }
    c.messages.push({ id: `${job.id}-reply`, channel: "customer", speaker: "agent", text: result.draft.reply, at: new Date().toISOString(), ...(job.input.operatorFeedback ? { origin: "operator_revision" as const } : {}) });
    c.reviewHold = result.draft.needsOperator || result.resolution?.needsOperator || false;
    c.status = c.reviewHold ? "needs_review" : c.verification && ["awaiting_business", "needs_facts", "pending", "conflicting"].includes(c.verification.outcome) ? "awaiting_business" : "ready";
  });
}

export async function failRun(token: string, job: Job, failure?: RunFailure) {
  await workspaceAction(token, (data) => {
    const c = data.cases[job.caseId];
    if (c?.run?.id === job.id && c.revision === job.revision) {
      finishRun(c, "failed");
      if (c.lastRun && failure) c.lastRun.failure = failure;
      c.status = "run_failed";
      c.activity.push({ role: "customer", action: "run_failed", summary: failure?.message ?? "Run could not complete. No unreviewed reply or case update was published. Inspect saved evidence, then retry explicitly." });
    }
  });
}

export async function reserveLive(id: string, scope?: { token: string; job: Job }) {
  const reserve = async (client: PoolClient) => {
    const result = await client.query("UPDATE rebuild_v2.budget SET used_micros=used_micros+20000 WHERE id=1 RETURNING used_micros");
    if (!result.rowCount) throw new V2Error(503, "Initialize V2 usage accounting before making model calls.");
    await client.query("INSERT INTO rebuild_v2.reservations(id,cost_micros) VALUES($1,20000)", [id]);
  };
  if (!scope) return transaction(reserve);
  return workspaceAction(scope.token, async (data, _, client) => {
    const c = data.cases[scope.job.caseId];
    if (!c || c.revision !== scope.job.revision || c.run?.id !== scope.job.id || c.stopped || c.takeover) throw new V2Error(409, "Run is no longer current.");
    await reserve(client);
  });
}

export async function startLive(call: Pick<ModelCall, "id" | "role">, scope: { token: string; job: Job }) {
  await workspaceAction(scope.token, (data) => {
    const c = data.cases[scope.job.caseId];
    if (!c || c.revision !== scope.job.revision || c.run?.id !== scope.job.id || c.stopped || c.takeover || c.reviewHold) throw new V2Error(409, "Run is no longer current.");
    c.run.activeCallId = call.id; c.run.activeRole = call.role ?? "unknown";
    c.run.steps = [...(c.run.steps ?? []), { id: call.id, role: c.run.activeRole, state: "started" as const, at: new Date().toISOString() }].slice(-40);
  });
}

export async function recordLive(call: ModelCall, scope?: { token: string; job: Job }) {
  await v2Pool().query("UPDATE rebuild_v2.reservations SET role=$2,latency_ms=$3,tools=$4 WHERE id=$1", [call.id, call.role ?? "unknown", call.latencyMs, JSON.stringify(call.tools)]);
  if (scope) await workspaceAction(scope.token, (data) => {
    const c = data.cases[scope.job.caseId];
    if (c?.run?.id !== scope.job.id || c.revision !== scope.job.revision || c.run.activeCallId !== call.id) return;
    c.run.calls = (c.run.calls ?? 0) + 1;
    c.run.lastCompletedRole = call.role;
    c.run.steps = [...(c.run.steps ?? []), { id: call.id, role: call.role ?? "unknown", state: "completed" as const, at: new Date().toISOString(), tools: call.tools }].slice(-40);
    delete c.run.activeCallId; delete c.run.activeRole;
  });
  if (!call.usageKnown) return;
  // Twice the published standard input/output rates; unknown/failed calls keep their full reservation.
  const cost = Math.max(1, Math.ceil(call.inputTokens * 0.25 + call.outputTokens));
  if (!Number.isSafeInteger(cost) || cost > 20_000) throw new Error("Model usage exceeded its reserved bound");
  await transaction(async (client) => {
    const row = await client.query("UPDATE rebuild_v2.reservations SET cost_micros=$2,input_tokens=$3,output_tokens=$4 WHERE id=$1 AND input_tokens IS NULL RETURNING id", [call.id, cost, call.inputTokens, call.outputTokens]);
    if (row.rowCount) await client.query("UPDATE rebuild_v2.budget SET used_micros=used_micros-20000+$1 WHERE id=1", [cost]);
  });
}

export async function budgetUsage() {
  const r = await v2Pool().query<{ used_micros: number }>("SELECT used_micros FROM rebuild_v2.budget WHERE id=1");
  if (!r.rows[0]) throw new V2Error(503, "V2 usage accounting is not initialized.");
  const usage = await v2Pool().query("SELECT COUNT(*)::int AS calls,COUNT(*) FILTER (WHERE input_tokens IS NULL)::int AS unknown_calls,COALESCE(SUM(input_tokens),0)::int AS input_tokens,COALESCE(SUM(output_tokens),0)::int AS output_tokens FROM rebuild_v2.reservations");
  return { capDollars: null, conservativeUsedDollars: r.rows[0].used_micros / 1_000_000, ...usage.rows[0] as { calls: number; unknown_calls: number; input_tokens: number; output_tokens: number } };
}
