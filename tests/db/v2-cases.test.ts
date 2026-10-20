import { readFileSync } from "node:fs";
import { caseStore } from "../../src/lib/v2/case-store";
import { demoRecords } from "../../src/lib/v2/demo-records";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => {
  db = await testSchema();
  await db.pool.query("insert into v2_visitor_sessions (session_id,token_hash,business_id,workspace_id) values ('session-1',$1,'northside','demo')", ["a".repeat(64)]);
});
afterAll(async () => db?.drop());
const visitor = { kind: "visitor", sessionId: "session-1", businessId: "northside", workspaceId: "demo" };
const operator = { kind: "operator", operatorId: "operator-1", businessIds: ["northside"] };
const keyFor = (caseId: string) => ({ businessId: "northside", workspaceId: "demo", caseId });
async function opened(caseId: string) {
  const store = caseStore(db.pool), key = keyFor(caseId);
  await store.create(visitor, { ...key, accountId: "account-1" }, demoRecords());
  return { store, key };
}
const message = (text: string, idempotencyKey: string, expectedRevision = 1) => ({ text, idempotencyKey, expectedRevision });

test("case facts and history persist across store instances and exclude other accounts/businesses", async () => {
  const { store, key } = await opened("persist");
  const saved = await store.append(visitor, key, message("I already paid $50.", "message-1"));
  expect(saved.record).toMatchObject({ revision: 2, state: "investigating" });
  const fresh = caseStore(db.pool);
  expect(await fresh.get(visitor, key)).toEqual(saved.record);
  const facts = await fresh.facts(visitor, key);
  expect(facts.accounts).toHaveLength(1);
  expect(facts.accounts[0].accountId).toBe("account-1");
  expect(facts.businesses.map((b) => b.businessId)).toEqual(["northside"]);
  const history = await fresh.history(visitor, key);
  expect(history.events.map((e) => e.kind)).toEqual(["created", "customer_message"]);
  expect(history.messages.map((m) => m.text)).toEqual(["I already paid $50."]);
});

test("repeated case creation is idempotent and refuses changed facts", async () => {
  const { store, key } = await opened("create-retry");
  await store.create(visitor, { ...key, accountId: "account-1" }, demoRecords());
  expect((await store.history(visitor, key)).events).toHaveLength(1);
  await expect(store.create(visitor, { ...key, accountId: "account-1" }, demoRecords(43))).rejects.toThrow(/conflict/);
  expect((await store.get(visitor, key)).revision).toBe(1);
});

test("retries return one accepted message while changed content under the same key conflicts", async () => {
  const { store, key } = await opened("retry");
  const first = await store.append(visitor, key, message("Payment question", "same-key"));
  const retry = await store.append(visitor, key, message("Payment question", "same-key"));
  expect(first.duplicate).toBe(false);
  expect(retry.duplicate).toBe(true);
  expect(retry.message).toEqual(first.message);
  await expect(store.append(visitor, key, message("Different content", "same-key"))).rejects.toThrow(/conflict/);
  expect((await store.history(visitor, key)).messages).toHaveLength(1);
});

test("concurrent identical submissions commit once", async () => {
  const { store, key } = await opened("concurrent-retry");
  const results = await Promise.all([store.append(visitor, key, message("Hello", "once")), store.append(visitor, key, message("Hello", "once"))]);
  expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
  expect((await store.get(visitor, key)).revision).toBe(2);
  expect((await store.history(visitor, key)).messages).toHaveLength(1);
});

test("different submissions racing one revision cannot overwrite each other", async () => {
  const { store, key } = await opened("revision-race");
  const results = await Promise.allSettled([store.append(visitor, key, message("First", "first")), store.append(visitor, key, message("Second", "second"))]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect((await store.history(visitor, key)).messages).toHaveLength(1);
});

test("case transitions require operator access and reject stale revisions", async () => {
  const { store, key } = await opened("transition");
  await expect(store.transition(visitor, key, { type: "resolve", reason: "Paid", expectedRevision: 1 })).rejects.toThrow();
  const resolved = await store.transition(operator, key, { type: "resolve", reason: "Verified resolution", expectedRevision: 1 });
  expect(resolved.state).toBe("resolved");
  await expect(store.transition(operator, key, { type: "close", reason: "Close", expectedRevision: 1 })).rejects.toThrow(/revision/);
  const updated = await store.append(visitor, key, message("Here is new evidence", "new-evidence", 2));
  expect(updated.record).toMatchObject({ state: "investigating", revision: 3 });
});

test("STOP is persisted immediately, and operator reopening preserves contact suppression", async () => {
  const { store, key } = await opened("stop");
  const stopped = await store.append(visitor, key, message("STOP", "stop-1"));
  expect(stopped.record).toMatchObject({ state: "closed", contactSuppressed: true, revision: 2 });
  await expect(store.append(visitor, key, message("Normal message", "closed-message", 2))).rejects.toThrow();
  const reopened = await store.transition(operator, key, { type: "reopen", reason: "Internal review", expectedRevision: 2 });
  expect(reopened).toMatchObject({ state: "open", contactSuppressed: true, revision: 3 });
});

test("every read/write is business/workspace scoped", async () => {
  const { store, key } = await opened("scope");
  for (const principal of [{ ...visitor, workspaceId: "other" }, { ...visitor, businessId: "other" }, { ...operator, businessIds: ["other"] }]) {
    await expect(store.get(principal, key)).rejects.toThrow();
    await expect(store.facts(principal, key)).rejects.toThrow();
    await expect(store.history(principal, key)).rejects.toThrow();
    await expect(store.append(principal, key, message("Forged", "forged"))).rejects.toThrow();
  }
  expect((await store.get(visitor, key)).revision).toBe(1);
});

test("history pagination has a stable revision cursor and no duplicate/missing events", async () => {
  const { store, key } = await opened("pagination");
  await store.append(visitor, key, message("Message one", "m1"));
  await store.append(visitor, key, message("Message two", "m2", 2));
  const first = await store.history(visitor, key, { limit: 2 });
  expect(first.events.map((e) => e.revision)).toEqual([1, 2]);
  expect(first.nextRevision).toBe(2);
  const next = await store.history(visitor, key, { limit: 2, afterRevision: first.nextRevision });
  expect(next.events.map((e) => e.revision)).toEqual([3]);
  expect(next.messages.map((m) => m.text)).toEqual(["Message two"]);
  expect(next.nextRevision).toBeNull();
});

test("an audit-write failure rolls back the message and case revision together", async () => {
  const { store, key } = await opened("rollback");
  await db.pool.query("alter table v2_case_events add constraint reject_test_message check (case_id <> 'rollback' or kind <> 'customer_message')");
  try { await expect(store.append(visitor, key, message("Must roll back", "failed"))).rejects.toThrow(); }
  finally { await db.pool.query("alter table v2_case_events drop constraint reject_test_message"); }
  expect((await store.get(visitor, key)).revision).toBe(1);
  expect((await store.history(visitor, key)).messages).toHaveLength(0);
});

test("STOP wins over a stale revision after other work has committed", async () => {
  const { store, key } = await opened("stale-stop");
  await store.append(visitor, key, message("Investigate my payment", "first"));
  const stopped = await store.append(visitor, key, message("STOP", "urgent-stop", 1));
  expect(stopped.record).toMatchObject({ state: "closed", revision: 3, contactSuppressed: true });
});

test("audit events identify the real operator or visitor who performed the operation", async () => {
  const { store, key } = await opened("actor");
  await store.append(operator, key, message("Operator testing the customer flow", "operator-message"));
  await store.transition(operator, key, { type: "request_human", expectedRevision: 2, reason: "Review evidence" });
  const events = (await store.history(visitor, key)).events;
  expect(events[0]).toMatchObject({ actor: "customer", actorId: "session-1" });
  expect(events[1]).toMatchObject({ actor: "operator", actorId: "operator-1" });
  expect(events[2]).toMatchObject({ actor: "operator", actorId: "operator-1" });
});

test("facts reads enforce case scope even if stored valid records include another account", async () => {
  const { store, key } = await opened("facts-scope");
  await db.pool.query("update v2_cases set facts=$4 where business_id=$1 and workspace_id=$2 and case_id=$3", [key.businessId, key.workspaceId, key.caseId, JSON.stringify(demoRecords())]);
  const facts = await store.facts(visitor, key);
  expect(facts.accounts).toHaveLength(1);
  expect(facts.businesses).toHaveLength(1);
});

test("SQL constraints reject illegal states, unsafe revisions and orphan history", async () => {
  const { key } = await opened("constraints");
  const args = [key.businessId, key.workspaceId, key.caseId];
  await expect(db.pool.query("update v2_cases set state = 'paid' where business_id=$1 and workspace_id=$2 and case_id=$3", args)).rejects.toThrow();
  await expect(db.pool.query("update v2_cases set revision = 9007199254740992 where business_id=$1 and workspace_id=$2 and case_id=$3", args)).rejects.toThrow();
  await expect(db.pool.query("insert into v2_case_events (business_id,workspace_id,case_id,revision,kind,actor,actor_id,reason) values ('other','demo','missing',1,'created','system','worker-1','test')")).rejects.toMatchObject({ code: "23503" });
});

test("the V1 public reader does not gain access to V2 case facts or messages", async () => {
  const role = `vr_${db.schema.slice(5)}`;
  const sql = readFileSync("db/ops/readonly_role.sql", "utf8").split("\n").filter((line) => !line.startsWith("create role")).join("\n").replaceAll("recovery_reader", role).replace("schema public", `schema ${db.schema}`);
  const c = await db.pool.connect();
  try {
    await c.query(`create role ${role} nologin`);
    await c.query(`grant ${role} to current_user`);
    await c.query(sql);
    await c.query(`set role ${role}`);
    await expect(c.query("select * from v2_cases")).rejects.toThrow(/permission denied/);
    await expect(c.query("select * from v2_case_messages")).rejects.toThrow(/permission denied/);
    await expect(c.query("select * from v2_case_jobs")).rejects.toThrow(/permission denied/);
    await expect(c.query("select * from v2_visitor_sessions")).rejects.toThrow(/permission denied/);
    for (const table of ["v2_auth_user", "v2_auth_session", "v2_auth_account", "v2_auth_verification", "v2_operators", "v2_operator_memberships", "v2_case_runs", "v2_run_attempts", "v2_run_daily_usage", "v2_agent_messages", "v2_model_steps"]) {
      await expect(c.query(`select * from ${table}`)).rejects.toMatchObject({ code: "42501" });
    }
  } finally {
    await c.query("reset role"); await c.query(`drop owned by ${role}`); await c.query(`drop role ${role}`); c.release();
  }
});
