import type { BulkArtifact, Conversation } from "../../src/lib/artifact";
import { allAccounts, importArtifact, migrate, seed } from "../../src/lib/db-admin";
import { mockProvider } from "../../src/lib/llm/mock";
import { runPicker } from "../../src/lib/picker";
import { runBulk } from "../../src/lib/sim/bulk";
import { runEval } from "../../src/lib/sim/eval";
import { count, testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => {
  db = await testSchema();
  await seed(db.pool);
});
afterAll(async () => db?.drop());

const meta = (runId: string) => ({ runId, createdAt: "2026-10-16T12:00:00.000Z" });

describe("migrate", () => {
  test("second run applies nothing", async () => {
    expect(await migrate(db.pool)).toEqual([]);
    expect(await count(db.pool, "schema_migrations")).toBeGreaterThanOrEqual(1);
  });
});

describe("seed", () => {
  test("112 accounts, and a repeat seed changes nothing", async () => {
    expect(await count(db.pool, "accounts")).toBe(112);
    const r = await seed(db.pool);
    expect(r).toEqual({ inserted: 0, updated: 0, unchanged: 112 });
    expect(await count(db.pool, "accounts", "dataset = 'eval'")).toBe(12);
  });

  test("changing an account already used by a run fails and changes nothing", async () => {
    await importArtifact(db.pool, await runBulk({ ...meta("bulk-seedref"), limit: 1 }));
    const changed = allAccounts().map((a) => (a.accountKey === "demo-001" ? { ...a, balanceCents: a.balanceCents + 1 } : a));
    await expect(seed(db.pool, changed)).rejects.toThrow(/demo-001/);
    const r = await db.pool.query("select balance_cents from accounts where account_key = 'demo-001'");
    expect(r.rows[0].balance_cents).toBe(allAccounts()[0].balanceCents);
  });
});

describe("import", () => {
  test("eval artifact imports with message checks and scenario results", async () => {
    const a = await runEval({ ...meta("eval-imp"), provider: mockProvider(), versions: ["baseline", "guarded"] });
    await importArtifact(db.pool, a);
    expect(await count(db.pool, "conversations", "run_id = 'eval-imp'")).toBe(24);
    expect(await count(db.pool, "eval_results", "run_id = 'eval-imp'")).toBe(24 * 7);
    const m = await db.pool.query(
      "select m.checks from messages m join conversations c on c.id = m.conversation_id where c.run_id = 'eval-imp' and m.role = 'agent' limit 1",
    );
    expect(m.rows[0].checks.length).toBeGreaterThan(0);
  });

  test("a duplicate run id is rejected and nothing changes", async () => {
    const before = await count(db.pool, "conversations");
    const a = await runEval({ ...meta("eval-imp"), provider: mockProvider(), versions: ["baseline", "guarded"] });
    await expect(importArtifact(db.pool, a)).rejects.toThrow(/already imported/);
    expect(await count(db.pool, "conversations")).toBe(before);
  });

  test("a partial eval run is rejected", async () => {
    const a = await runEval({ ...meta("eval-partial"), provider: mockProvider(), versions: ["guarded"], limit: 2 });
    await expect(importArtifact(db.pool, a)).rejects.toThrow(/S03|all 12/);
    expect(await count(db.pool, "runs", "id = 'eval-partial'")).toBe(0);
  });

  test("bulk with an eval account is rejected with no partial rows", async () => {
    const a = await runBulk({ ...meta("bulk-bad-acct"), limit: 3 });
    a.conversations[2] = { ...a.conversations[2], accountKey: "eval-S01" };
    await expect(importArtifact(db.pool, a)).rejects.toThrow(/demo accounts/);
    expect(await count(db.pool, "runs", "id = 'bulk-bad-acct'")).toBe(0);
    expect(await count(db.pool, "conversations", "run_id = 'bulk-bad-acct'")).toBe(0);
  });

  test("a failure inside the transaction leaves no partial run", async () => {
    const a = await runBulk({ ...meta("bulk-midfail"), limit: 3 });
    a.conversations[2] = { ...a.conversations[2], accountKey: "demo-999" }; // passes schema, unknown account
    await expect(importArtifact(db.pool, a)).rejects.toThrow();
    expect(await count(db.pool, "runs", "id = 'bulk-midfail'")).toBe(0);
    expect(await count(db.pool, "conversations", "run_id = 'bulk-midfail'")).toBe(0);
  });

  const withConv = async (runId: string, patch: Partial<Conversation>): Promise<BulkArtifact> => {
    const a = await runBulk({ ...meta(runId), limit: 1 });
    a.conversations[0] = { ...a.conversations[0], ...patch };
    return a;
  };

  test("paid before agreed is rejected", async () => {
    const a = await withConv("bulk-paidfirst", { outcome: "agreed_to_pay", agreedAt: "2026-03-12T00:00:00.000Z", paidAt: "2026-03-11T00:00:00.000Z", recoveredCents: 100 });
    await expect(importArtifact(db.pool, a)).rejects.toThrow(/before/);
  });

  test("a receipt on a payment plan is rejected", async () => {
    const a = await withConv("bulk-planpaid", { outcome: "payment_plan", agreedAt: "2026-03-10T17:00:00.000Z", paidAt: "2026-03-12T00:00:00.000Z", recoveredCents: 100 });
    await expect(importArtifact(db.pool, a)).rejects.toThrow(/receipt/);
  });

  test("a receipt larger than the balance is rejected", async () => {
    const a = await withConv("bulk-overpaid", { recoveredCents: 999999 });
    await expect(importArtifact(db.pool, a)).rejects.toThrow(/balance/);
  });

  test("a failed run is rejected", async () => {
    const a = await runBulk({ ...meta("bulk-failed"), limit: 1 });
    await expect(importArtifact(db.pool, { ...a, status: "failed" })).rejects.toThrow(/failed/);
  });

  test("picker artifact imports all trials and keeps its frozen choices", async () => {
    const p = runPicker({ ...meta("picker-imp"), trainSeed: 11, testSeed: 22, exploreSeed: 33 });
    await importArtifact(db.pool, p);
    expect(await count(db.pool, "picker_trials", "run_id = 'picker-imp'")).toBe(p.trials.length);
    const r = await db.pool.query("select metadata from runs where id = 'picker-imp'");
    expect(r.rows[0].metadata.selected).toEqual(p.selected);
  });
});

describe("review round 1 regressions", () => {
  test("an eval run whose account is not an eval account in the database is rejected", async () => {
    await db.pool.query("update accounts set dataset = 'demo' where account_key = 'eval-S12'");
    try {
      const a = await runEval({ ...meta("eval-wrongds"), provider: mockProvider(), versions: ["baseline", "guarded"] });
      await expect(importArtifact(db.pool, a)).rejects.toThrow(/eval accounts/);
      expect(await count(db.pool, "runs", "id = 'eval-wrongds'")).toBe(0);
    } finally {
      await db.pool.query("update accounts set dataset = 'eval' where account_key = 'eval-S12'");
    }
  });

  test("timestamps are compared as instants, not text", async () => {
    const a = await runBulk({ ...meta("bulk-precision"), limit: 1 });
    a.conversations[0] = { ...a.conversations[0], agreedAt: "2026-03-10T16:10:00Z", paidAt: "2026-03-10T16:10:00.001Z" };
    await expect(importArtifact(db.pool, a)).resolves.toMatchObject({ runId: "bulk-precision" });
  });

  test("guard flags are stored exactly, including unusual characters", async () => {
    const a = await runBulk({ ...meta("bulk-flags"), limit: 1 });
    a.conversations[0].messages[0] = { ...a.conversations[0].messages[0], guardFlags: ["a|b", "", "fallback"] };
    await importArtifact(db.pool, a);
    const r = await db.pool.query(
      "select m.guard_flags from messages m join conversations c on c.id = m.conversation_id where c.run_id = 'bulk-flags' and m.seq = 1",
    );
    expect(r.rows[0].guard_flags).toEqual(["a|b", "", "fallback"]);
  });
});
