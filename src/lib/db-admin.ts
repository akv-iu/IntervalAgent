// Write-side database work for scripts and tests: migrations, seed, transactional import.
// Never imported by the web app (the app is read-only and uses src/lib/reports.ts).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { Artifact, type Conversation } from "./artifact";
import { HARD, SOFT } from "./checks";
import { type Account, demoAccounts } from "./sim/accounts";
import { SCENARIOS } from "./sim/scenarios";

export const MIGRATIONS_DIR = join("db", "migrations");

async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// Numbered .sql files, one transaction each, recorded in schema_migrations. Returns what was applied.
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await pool.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const f of files.filter((x) => !done.has(x))) {
    await inTransaction(pool, async (c) => {
      await c.query(readFileSync(join(dir, f), "utf8"));
      await c.query("insert into schema_migrations (name) values ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}

export function allAccounts(): Account[] {
  return [...demoAccounts(), ...SCENARIOS.map((s) => s.account)];
}

const ACCOUNT_COLS = ["dataset", "business", "first_name", "persona", "balance_cents", "due_date", "days_past_due", "aging_bucket", "timezone"] as const;
const accountRow = (a: Account) => [a.dataset, a.business, a.firstName, a.persona, a.balanceCents, a.dueDate, a.daysPastDue, a.agingBucket, a.timezone];

// Upsert by stable key. Identical rows are a no-op; a changed account already used by a run is an error.
export async function seed(pool: Pool, accounts: Account[] = allAccounts()) {
  return inTransaction(pool, async (c) => {
    const existing = new Map(
      (await c.query(`select account_key, ${ACCOUNT_COLS.join(", ")}, to_char(due_date, 'YYYY-MM-DD') as due from accounts`)).rows.map((r) => [
        r.account_key as string,
        [r.dataset, r.business, r.first_name, r.persona, r.balance_cents, r.due, r.days_past_due, r.aging_bucket, r.timezone],
      ]),
    );
    const used = new Set((await c.query<{ account_key: string }>("select distinct account_key from conversations")).rows.map((r) => r.account_key));
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (const a of accounts) {
      const row = accountRow(a);
      const old = existing.get(a.accountKey);
      if (!old) {
        await c.query(`insert into accounts (account_key, ${ACCOUNT_COLS.join(", ")}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [a.accountKey, ...row]);
        counts.inserted++;
      } else if (JSON.stringify(old) === JSON.stringify(row)) {
        counts.unchanged++;
      } else if (used.has(a.accountKey)) {
        throw new Error(`account ${a.accountKey} changed but is already used by an imported run; version the fixture instead of rewriting history`);
      } else {
        await c.query(`update accounts set ${ACCOUNT_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} where account_key = $1`, [a.accountKey, ...row]);
        counts.updated++;
      }
    }
    return counts;
  });
}

// Rules that must hold before anything is written. Returns problems; empty means importable.
function invariantProblems(a: Artifact, accounts: Map<string, { dataset: string; balance: number }>): string[] {
  const p: string[] = [];
  if (a.status !== "complete") p.push("run status is failed; only complete runs can be imported");
  if (a.kind === "picker") return p;
  for (const c of a.conversations) {
    const acct = accounts.get(c.accountKey);
    const who = `${c.accountKey}${c.scenarioId ? ` ${c.scenarioId}` : ""} ${c.version}`;
    if (!acct) {
      p.push(`${who}: unknown account`);
      continue;
    }
    if (c.recoveredCents > acct.balance) p.push(`${who}: receipt larger than the balance`);
    if (c.paidAt && (!c.agreedAt || Date.parse(c.paidAt) < Date.parse(c.agreedAt))) p.push(`${who}: paid before agreeing`);
    if (c.paidAt && c.outcome !== "agreed_to_pay") p.push(`${who}: receipt on a ${c.outcome}`);
    if (!c.paidAt && c.recoveredCents > 0) p.push(`${who}: recovered money without a receipt`);
  }
  if (a.kind === "bulk") {
    const bad = a.conversations.filter((c) => accounts.get(c.accountKey)?.dataset !== "demo" || c.scenarioId !== null || c.version !== "guarded");
    if (bad.length) p.push(`bulk runs may only contain guarded conversations with demo accounts (bad: ${bad.map((c) => c.accountKey).join(", ")})`);
    const keys = a.conversations.map((c) => c.accountKey);
    if (new Set(keys).size !== keys.length) p.push("bulk run has more than one conversation for an account");
  }
  if (a.kind === "eval") {
    const notEval = a.conversations.filter((c) => accounts.get(c.accountKey)?.dataset !== "eval");
    if (notEval.length) p.push(`eval runs may only use eval accounts (bad: ${[...new Set(notEval.map((c) => c.accountKey))].join(", ")})`);
    const names = [...HARD, ...SOFT];
    for (const s of SCENARIOS) {
      for (const v of ["baseline", "guarded"] as const) {
        const found = a.conversations.filter((c) => c.scenarioId === s.id && c.version === v);
        if (found.length !== 1) p.push(`eval runs must contain all 12 scenarios in both versions: ${s.id} ${v} found ${found.length}`);
        else if (found[0].accountKey !== s.account.accountKey) p.push(`${s.id} ${v}: account ${found[0].accountKey} does not match ${s.account.accountKey}`);
        else if (!names.every((n) => found[0].scenarioChecks.some((x) => x.name === n))) p.push(`${s.id} ${v}: missing expected checks`);
      }
    }
    if (a.conversations.length !== 24) p.push(`eval run has ${a.conversations.length} conversations, expected 24`);
  }
  return p;
}

async function insertConversation(c: PoolClient, runId: string, conv: Conversation): Promise<number> {
  const r = await c.query<{ id: string }>(
    `insert into conversations (run_id, account_key, scenario_id, version, channel, tone, started_at, agreed_at, paid_at, outcome, recovered_cents, handed_to_human)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [runId, conv.accountKey, conv.scenarioId, conv.version, conv.channel, conv.tone, conv.startedAt, conv.agreedAt, conv.paidAt, conv.outcome, conv.recoveredCents, conv.handedToHuman],
  );
  const id = Number(r.rows[0].id);
  const m = conv.messages;
  await c.query(
    `insert into messages (conversation_id, seq, role, body, sent_at, guard_flags, persona_state, checks)
     select $1, seq, role, body, sent_at, array(select jsonb_array_elements_text(flags::jsonb)), nullif(state, 'null')::jsonb, checks::jsonb
     from unnest($2::int[], $3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::text[], $8::text[]) as t(seq, role, body, sent_at, flags, state, checks)`,
    [
      id,
      m.map((x) => x.seq),
      m.map((x) => x.role),
      m.map((x) => x.text),
      m.map((x) => x.sentAt),
      m.map((x) => JSON.stringify(x.guardFlags)), // JSON keeps every flag exactly
      m.map((x) => JSON.stringify(x.personaState ?? null)),
      m.map((x) => JSON.stringify(x.checks)),
    ],
  );
  return id;
}

// Validate, check rules, then write the whole run in one transaction. Any failure leaves nothing behind.
export async function importArtifact(pool: Pool, input: unknown): Promise<{ runId: string; conversations: number; trials: number }> {
  const a = Artifact.parse(input);
  return inTransaction(pool, async (c) => {
    if ((await c.query("select 1 from runs where id = $1", [a.runId])).rowCount) throw new Error(`run ${a.runId} was already imported; runs are never merged`);
    const accounts = new Map(
      (await c.query<{ account_key: string; dataset: string; balance_cents: number }>("select account_key, dataset, balance_cents from accounts")).rows.map((r) => [
        r.account_key,
        { dataset: r.dataset, balance: r.balance_cents },
      ]),
    );
    const problems = invariantProblems(a, accounts);
    if (problems.length) throw new Error(`cannot import ${a.runId}:\n- ${problems.slice(0, 20).join("\n- ")}`);

    const metadata =
      a.kind === "picker"
        ? { ...a.metadata, trainSeed: a.trainSeed, testSeed: a.testSeed, exploreSeed: a.exploreSeed, counts: a.counts, reward: a.reward, selected: a.selected }
        : a.metadata;
    await c.query(
      `insert into runs (id, kind, source_mode, created_at, status, schema_version, scenario_version, recording_set_id, model, report_as_of, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [a.runId, a.kind, a.sourceMode, a.createdAt, a.status, a.schemaVersion, a.scenarioVersion, a.recordingSetId ?? null, a.model ?? null, a.kind === "bulk" ? a.reportAsOf : null, metadata],
    );

    if (a.kind === "picker") {
      const t = a.trials;
      await c.query(
        `insert into picker_trials (run_id, phase, segment, case_id, strategy, channel, "window", tone, responded, paid)
         select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bool[], $10::bool[])`,
        [a.runId, t.map((x) => x.phase), t.map((x) => x.segment), t.map((x) => x.caseId), t.map((x) => x.strategy), t.map((x) => x.arm.channel), t.map((x) => x.arm.window), t.map((x) => x.arm.tone), t.map((x) => x.responded), t.map((x) => x.paid)],
      );
      return { runId: a.runId, conversations: 0, trials: t.length };
    }

    for (const conv of a.conversations) {
      const id = await insertConversation(c, a.runId, conv);
      if (a.kind === "eval") {
        const s = conv.scenarioChecks;
        await c.query(
          `insert into eval_results (run_id, conversation_id, version, scenario_id, check_name, passed, detail)
           select $1, $2, $3, $4, * from unnest($5::text[], $6::bool[], $7::text[])`,
          [a.runId, id, conv.version, conv.scenarioId, s.map((x) => x.name), s.map((x) => x.passed), s.map((x) => x.detail)],
        );
      }
    }
    return { runId: a.runId, conversations: a.conversations.length, trials: 0 };
  });
}
