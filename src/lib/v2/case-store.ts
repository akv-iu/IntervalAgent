// Server-side storage only. Pool and verified principals are supplied by the caller; no credentials are read here.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { slug } from "../artifact";
import { isStop } from "../patterns";
import { Records, sameAccount } from "./records";
import { CaseEvent, CaseRecord, Principal, assertCaseAccess, transitionCase } from "./state";

const CaseKey = CaseRecord.pick({ businessId: true, workspaceId: true, caseId: true });
type CaseKey = z.infer<typeof CaseKey>;
const Identity = CaseKey.extend({ accountId: slug });
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Submission = z.strictObject({ text: z.string().trim().min(1).max(500), idempotencyKey: slug, expectedRevision: revision });
const Change = CaseEvent.omit({ actor: true }).extend({ expectedRevision: revision });
const Page = z.strictObject({ afterRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), limit: z.number().int().min(1).max(100).default(50) });
const where = "business_id=$1 and workspace_id=$2 and case_id=$3";
const args = (k: CaseKey) => [k.businessId, k.workspaceId, k.caseId];
interface CaseRow { business_id: string; workspace_id: string; case_id: string; account_id: string; state: string; revision: string; contact_suppressed: boolean; facts: unknown }
interface MessageRow { revision: string; role: "customer" | "agent"; body: string; idempotency_key: string; created_at: Date }
interface EventRow { revision: string; kind: string; actor: string; actor_id: string; reason: string; created_at: Date }
const recordOf = (r: CaseRow) => CaseRecord.parse({ businessId: r.business_id, workspaceId: r.workspace_id, caseId: r.case_id, accountId: r.account_id, state: r.state, revision: Number(r.revision), contactSuppressed: r.contact_suppressed });
const messageOf = (r: MessageRow) => ({ revision: Number(r.revision), role: r.role, text: r.body, idempotencyKey: r.idempotency_key, createdAt: r.created_at.toISOString() });
function actorOf(raw: unknown) {
  const principal = Principal.parse(raw);
  return principal.kind === "visitor" ? { kind: "customer" as const, id: principal.sessionId } : { kind: "operator" as const, id: principal.operatorId };
}

async function transaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  let broken = false;
  try {
    await c.query("begin");
    await c.query("set local lock_timeout='5s'; set local statement_timeout='10s'");
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (error) {
    try { await c.query("rollback"); } catch { broken = true; }
    throw error;
  } finally { c.release(broken); }
}

async function event(c: PoolClient, key: CaseKey, rev: number, kind: string, actor: ReturnType<typeof actorOf>, reason: string) {
  await c.query(`insert into v2_case_events (business_id,workspace_id,case_id,revision,kind,actor,actor_id,reason) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [...args(key), rev, kind, actor.kind, actor.id, reason]);
}
async function locked(c: PoolClient, key: CaseKey): Promise<CaseRecord> {
  const r = await c.query<CaseRow>(`select * from v2_cases where ${where} for update`, args(key));
  if (!r.rows[0]) throw new Error("case not found");
  return recordOf(r.rows[0]);
}
async function save(c: PoolClient, previous: CaseRecord, next: CaseRecord) {
  const r = await c.query(`update v2_cases set state=$4,revision=$5,contact_suppressed=$6,updated_at=now() where ${where} and revision=$7`, [...args(previous), next.state, next.revision, next.contactSuppressed, previous.revision]);
  if (r.rowCount !== 1) throw new Error("case revision conflict");
}

// shortcut: facts are immutable snapshots; use ledger-backed current records when implementing approved actions.
function scopedFacts(raw: unknown, identity: z.infer<typeof Identity>): Records {
  const data = Records.parse(raw);
  const account = data.accounts.find((a) => sameAccount(a, identity));
  if (!account) throw new Error("case account not found in server records");
  return Records.parse({
    ...data,
    businesses: data.businesses.filter((b) => b.businessId === identity.businessId),
    accounts: [account], invoices: data.invoices.filter((r) => sameAccount(r, identity)),
    payments: data.payments.filter((r) => sameAccount(r, identity)), allocations: data.allocations.filter((r) => sameAccount(r, identity)),
    cancellations: data.cancellations.filter((r) => sameAccount(r, identity)), credits: data.credits.filter((r) => sameAccount(r, identity)),
    policies: data.policies.filter((r) => r.businessId === identity.businessId && r.workspaceId === identity.workspaceId),
  });
}

export function caseStore(pool: Pool) {
  async function read(principal: unknown, rawKey: unknown) {
    const key = CaseKey.parse(rawKey);
    assertCaseAccess(principal, key, "read_case");
    const r = await pool.query<CaseRow>(`select * from v2_cases where ${where}`, args(key));
    if (!r.rows[0]) throw new Error("case not found");
    return r.rows[0];
  }
  return {
    async create(principal: unknown, rawIdentity: unknown, serverRecords: unknown): Promise<CaseRecord> {
      const identity = Identity.parse(rawIdentity);
      assertCaseAccess(principal, identity, "post_message");
      const facts = scopedFacts(serverRecords, identity);
      const actor = actorOf(principal);
      return transaction(pool, async (c) => {
        const inserted = await c.query<CaseRow>(`insert into v2_cases (business_id,workspace_id,case_id,account_id,state,revision,contact_suppressed,facts)
          values ($1,$2,$3,$4,'open',1,false,$5) on conflict (business_id,workspace_id,case_id) do nothing returning *`, [...args(identity), identity.accountId, JSON.stringify(facts)]);
        if (inserted.rows[0]) {
          await event(c, identity, 1, "created", actor, "Case opened from scoped server records.");
          return recordOf(inserted.rows[0]);
        }
        const existing = (await c.query<CaseRow>(`select * from v2_cases where ${where} for update`, args(identity))).rows[0];
        if (!existing || existing.account_id !== identity.accountId || JSON.stringify(Records.parse(existing.facts)) !== JSON.stringify(facts)) throw new Error("case creation conflict");
        return recordOf(existing);
      });
    },
    async get(principal: unknown, rawKey: unknown): Promise<CaseRecord> { return recordOf(await read(principal, rawKey)); },
    async facts(principal: unknown, rawKey: unknown): Promise<Records> {
      const row = await read(principal, rawKey);
      return scopedFacts(row.facts, recordOf(row));
    },
    async append(principal: unknown, rawKey: unknown, rawSubmission: unknown) {
      const key = CaseKey.parse(rawKey), input = Submission.parse(rawSubmission);
      assertCaseAccess(principal, key, "post_message");
      const actor = actorOf(principal);
      return transaction(pool, async (c) => {
        const current = await locked(c, key);
        const prior = await c.query<MessageRow>(`select * from v2_case_messages where ${where} and idempotency_key=$4`, [...args(key), input.idempotencyKey]);
        if (prior.rows[0]) {
          if (prior.rows[0].body !== input.text || prior.rows[0].role !== "customer") throw new Error("message idempotency conflict");
          return { record: current, message: messageOf(prior.rows[0]), duplicate: true };
        }
        const stop = isStop(input.text);
        // STOP must suppress contact even when another writer has advanced the case.
        if (!stop && current.revision !== input.expectedRevision) throw new Error("case revision conflict");
        const reason = stop ? "Customer requested contact stop." : "Customer provided a message.";
        const next = transitionCase(current, { type: stop ? "stop_contact" : "new_evidence", actor: actor.kind, reason });
        await save(c, current, next);
        await event(c, key, next.revision, stop ? "stop_contact" : "customer_message", actor, reason);
        const inserted = await c.query<MessageRow>(`insert into v2_case_messages (business_id,workspace_id,case_id,idempotency_key,revision,role,body) values ($1,$2,$3,$4,$5,'customer',$6) returning *`, [...args(key), input.idempotencyKey, next.revision, input.text]);
        return { record: next, message: messageOf(inserted.rows[0]), duplicate: false };
      });
    },
    async transition(principal: unknown, rawKey: unknown, rawChange: unknown): Promise<CaseRecord> {
      const key = CaseKey.parse(rawKey), change = Change.parse(rawChange);
      assertCaseAccess(principal, key, change.type === "reopen" ? "reopen_case" : "review_case");
      const actor = actorOf(principal);
      return transaction(pool, async (c) => {
        const current = await locked(c, key);
        if (current.revision !== change.expectedRevision) throw new Error("case revision conflict");
        const next = transitionCase(current, { type: change.type, reason: change.reason, actor: "operator" });
        await save(c, current, next);
        await event(c, key, next.revision, change.type, actor, change.reason);
        return next;
      });
    },
    async history(principal: unknown, rawKey: unknown, rawPage: unknown = {}) {
      const key = CaseKey.parse(rawKey), page = Page.parse(rawPage);
      await read(principal, key);
      const rows = (await pool.query<EventRow>(`select * from v2_case_events where ${where} and revision>$4 order by revision limit $5`, [...args(key), page.afterRevision, page.limit + 1])).rows;
      const visible = rows.slice(0, page.limit);
      const revisions = visible.map((r) => Number(r.revision));
      const messages = revisions.length ? (await pool.query<MessageRow>(`select * from v2_case_messages where ${where} and revision=any($4::bigint[]) order by revision`, [...args(key), revisions])).rows.map(messageOf) : [];
      return {
        events: visible.map((r) => ({ revision: Number(r.revision), kind: r.kind, actor: r.actor, actorId: r.actor_id, reason: r.reason, createdAt: r.created_at.toISOString() })),
        messages, nextRevision: rows.length > page.limit ? revisions[revisions.length - 1] : null,
      };
    },
  };
}
