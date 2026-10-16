// Read-only reporting queries for the pages and the CSV export (SPEC 5). Every query is
// parameterized and scoped to one run. pg returns sums and rounded numerics as strings; convert here.
import type { Pool } from "pg";
import { getPool } from "./db";

type Db = Pick<Pool, "query">;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface RunRow {
  id: string;
  kind: "eval" | "bulk" | "picker";
  sourceMode: string;
  createdAt: Date;
  recordingSetId: string | null;
  model: string | null;
  reportAsOf: Date | null;
  metadata: Record<string, unknown>;
}

// Evals come only from the pinned live recording set (live or replayed), never a newer mock run (SPEC 5).
export async function latestRun(kind: RunRow["kind"], opts: { recordingSetId?: string } = {}, db: Db = getPool()): Promise<RunRow | null> {
  if (kind === "eval" && !opts.recordingSetId) throw new Error("eval runs must be selected by their pinned recording set");
  const r = await db.query(
    `select id, kind, source_mode, created_at, recording_set_id, model, report_as_of, metadata
     from runs
     where kind = $1 and status = 'complete'
       and ($2::text is null or (recording_set_id = $2 and source_mode in ('live', 'replay')))
     order by created_at desc, id desc
     limit 1`,
    [kind, opts.recordingSetId ?? null],
  );
  const x = r.rows[0];
  return x
    ? { id: x.id, kind: x.kind, sourceMode: x.source_mode, createdAt: x.created_at, recordingSetId: x.recording_set_id, model: x.model, reportAsOf: x.report_as_of, metadata: x.metadata }
    : null;
}

// Shared cohort for a completed bulk run: guarded demo conversations only.
const BULK_COHORT = `
  from conversations c
  join accounts a on a.account_key = c.account_key
  join runs r on r.id = c.run_id
  where c.run_id = $1 and r.kind = 'bulk' and r.status = 'complete'
    and a.dataset = 'demo' and c.scenario_id is null and c.version = 'guarded'`;

export interface OverviewRow {
  recoveredCents: number;
  contactedBalanceCents: number;
  recoveryRatePct: number | null;
  daysFromOutreachToPayment: number | null;
  plans: number;
  promises: number;
  handoffs: number;
}

export async function overview(runId: string, db: Db = getPool()): Promise<OverviewRow> {
  const r = await db.query(
    `select
       coalesce(sum(c.recovered_cents) filter (where c.paid_at <= r.report_as_of), 0) as recovered_cents,
       coalesce(sum(a.balance_cents), 0) as contacted_balance_cents,
       round(100.0 * coalesce(sum(c.recovered_cents) filter (where c.paid_at <= r.report_as_of), 0)
         / nullif(sum(a.balance_cents), 0), 1) as recovery_rate_pct,
       round(avg(extract(epoch from (c.paid_at - c.started_at)) / 86400)
         filter (where c.paid_at <= r.report_as_of), 1) as days_from_outreach_to_payment,
       count(*) filter (where c.outcome = 'payment_plan') as plans,
       count(*) filter (where c.outcome = 'promise_to_pay') as promises,
       count(*) filter (where c.handed_to_human) as handoffs
     ${BULK_COHORT}`,
    [runId],
  );
  const x = r.rows[0];
  return {
    recoveredCents: num(x.recovered_cents)!,
    contactedBalanceCents: num(x.contacted_balance_cents)!,
    recoveryRatePct: num(x.recovery_rate_pct),
    daysFromOutreachToPayment: num(x.days_from_outreach_to_payment),
    plans: num(x.plans)!,
    promises: num(x.promises)!,
    handoffs: num(x.handoffs)!,
  };
}

export interface AgingRow {
  bucket: string;
  accounts: number;
  startingBalanceCents: number;
  recoveredCents: number;
}

// Starting backlog of the run's contacted cohort, by days-past-due bucket.
export async function aging(runId: string, db: Db = getPool()): Promise<AgingRow[]> {
  const r = await db.query(
    `select a.aging_bucket as bucket,
       count(*) as accounts,
       sum(a.balance_cents) as starting_balance_cents,
       coalesce(sum(c.recovered_cents) filter (where c.paid_at <= r.report_as_of), 0) as recovered_cents
     ${BULK_COHORT}
     group by a.aging_bucket
     order by min(a.days_past_due)`,
    [runId],
  );
  return r.rows.map((x) => ({
    bucket: x.bucket,
    accounts: num(x.accounts)!,
    startingBalanceCents: num(x.starting_balance_cents)!,
    recoveredCents: num(x.recovered_cents)!,
  }));
}

export interface ConversationRow {
  id: number;
  accountKey: string;
  firstName: string;
  agingBucket: string;
  balanceCents: number;
  timezone: string;
  scenarioId: string | null;
  version: string;
  channel: string;
  tone: string;
  outcome: string;
  recoveredCents: number;
  recoveredByCutoffCents: number; // 0 when the run has no cutoff or the payment landed after it
  handedToHuman: boolean;
  startedAt: Date;
  paidAt: Date | null;
}

export async function conversations(runId: string, db: Db = getPool()): Promise<ConversationRow[]> {
  const r = await db.query(
    `select c.id, c.account_key, a.first_name, a.aging_bucket, a.balance_cents, a.timezone, c.scenario_id, c.version, c.channel, c.tone,
            c.outcome, c.recovered_cents, c.handed_to_human, c.started_at, c.paid_at,
            case when c.paid_at <= r.report_as_of then c.recovered_cents else 0 end as recovered_by_cutoff_cents
     from conversations c join accounts a on a.account_key = c.account_key join runs r on r.id = c.run_id
     where c.run_id = $1
     order by c.scenario_id nulls first, c.account_key, c.version`,
    [runId],
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    accountKey: x.account_key,
    firstName: x.first_name,
    agingBucket: x.aging_bucket,
    balanceCents: x.balance_cents,
    timezone: x.timezone,
    scenarioId: x.scenario_id,
    version: x.version,
    channel: x.channel,
    tone: x.tone,
    outcome: x.outcome,
    recoveredCents: x.recovered_cents,
    recoveredByCutoffCents: x.recovered_by_cutoff_cents,
    handedToHuman: x.handed_to_human,
    startedAt: x.started_at,
    paidAt: x.paid_at,
  }));
}

export interface MessageRow {
  seq: number;
  role: "agent" | "customer" | "system";
  body: string;
  sentAt: Date;
  guardFlags: string[];
  checks: { name: string; passed: boolean | null; detail: string }[];
}

export async function messages(conversationId: number, db: Db = getPool()): Promise<MessageRow[]> {
  const r = await db.query(
    `select seq, role, body, sent_at, guard_flags, checks from messages where conversation_id = $1 order by seq`,
    [conversationId],
  );
  return r.rows.map((x) => ({ seq: x.seq, role: x.role, body: x.body, sentAt: x.sent_at, guardFlags: x.guard_flags, checks: x.checks }));
}

// Every message of a run in one round trip, so pages can switch conversations without reloading.
export async function messagesForRun(runId: string, db: Db = getPool()): Promise<Record<number, MessageRow[]>> {
  const r = await db.query(
    `select m.conversation_id, m.seq, m.role, m.body, m.sent_at, m.guard_flags, m.checks
     from messages m join conversations c on c.id = m.conversation_id
     where c.run_id = $1
     order by m.conversation_id, m.seq`,
    [runId],
  );
  const out: Record<number, MessageRow[]> = {};
  for (const x of r.rows) {
    (out[Number(x.conversation_id)] ??= []).push({ seq: x.seq, role: x.role, body: x.body, sentAt: x.sent_at, guardFlags: x.guard_flags, checks: x.checks });
  }
  return out;
}

export interface EvalResultRow {
  conversationId: number;
  version: string;
  scenarioId: string;
  checkName: string;
  passed: boolean | null;
  detail: string;
}

export async function evalGrid(runId: string, db: Db = getPool()): Promise<EvalResultRow[]> {
  const r = await db.query(
    `select conversation_id, version, scenario_id, check_name, passed, detail
     from eval_results where run_id = $1 order by scenario_id, version, check_name`,
    [runId],
  );
  return r.rows.map((x) => ({
    conversationId: Number(x.conversation_id),
    version: x.version,
    scenarioId: x.scenario_id,
    checkName: x.check_name,
    passed: x.passed,
    detail: x.detail,
  }));
}

export interface PickerSummaryRow {
  segment: string; // a bucket, or "all"
  strategy: "fixed" | "learned";
  n: number;
  respondRate: number;
  payRate: number;
}

// Held-out test rows only. Training rows never enter these numbers.
export async function pickerSummary(runId: string, db: Db = getPool()): Promise<PickerSummaryRow[]> {
  const r = await db.query(
    `select coalesce(segment, 'all') as segment, strategy, count(*) as n,
            avg(responded::int) as respond_rate, avg(paid::int) as pay_rate
     from picker_trials
     where run_id = $1 and phase = 'test'
     group by grouping sets ((segment, strategy), (strategy))
     order by segment nulls last, strategy`,
    [runId],
  );
  return r.rows.map((x) => ({ segment: x.segment, strategy: x.strategy, n: num(x.n)!, respondRate: num(x.respond_rate)!, payRate: num(x.pay_rate)! }));
}
