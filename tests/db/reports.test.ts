import type { BulkArtifact, Conversation } from "../../src/lib/artifact";
import { allAccounts, importArtifact, seed } from "../../src/lib/db-admin";
import { mockProvider } from "../../src/lib/llm/mock";
import { runPicker, summarize } from "../../src/lib/picker";
import { aging, conversations, evalGrid, latestRun, messages, overview, pickerSummary } from "../../src/lib/reports";
import { runEval } from "../../src/lib/sim/eval";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
const bal = (key: string) => allAccounts().find((a) => a.accountKey === key)!.balanceCents;
const bucket = (key: string) => allAccounts().find((a) => a.accountKey === key)!.agingBucket;

function conv(accountKey: string, p: Partial<Conversation>): Conversation {
  return {
    accountKey,
    scenarioId: null,
    version: "guarded",
    channel: "sms",
    tone: "friendly",
    startedAt: "2026-03-10T16:00:00.000Z",
    outcome: "no_response",
    agreedAt: null,
    paidAt: null,
    recoveredCents: 0,
    handedToHuman: false,
    messages: [{ seq: 1, role: "agent", text: "Hi", sentAt: "2026-03-10T16:00:00.000Z", guardFlags: [], checks: [] }],
    scenarioChecks: [],
    ...p,
  };
}
function bulk(runId: string, createdAt: string, convs: Conversation[]): BulkArtifact {
  return {
    schemaVersion: 1,
    runId,
    kind: "bulk",
    createdAt,
    status: "complete",
    sourceMode: "mock",
    scenarioVersion: 1,
    reportAsOf: "2026-03-17T00:00:00.000Z",
    metadata: {},
    conversations: convs,
  };
}
const paid = (key: string, paidAt: string) =>
  conv(key, { outcome: "agreed_to_pay", agreedAt: "2026-03-10T16:10:00.000Z", paidAt, recoveredCents: bal(key) });

beforeAll(async () => {
  db = await testSchema();
  await seed(db.pool);
  // Run A: one receipt inside the cutoff (2 days 10 minutes after outreach), one after it, a plan, a promise, a handoff.
  await importArtifact(
    db.pool,
    bulk("bulk-a", "2026-10-16T10:00:00.000Z", [
      paid("demo-001", "2026-03-12T16:10:00.000Z"),
      paid("demo-002", "2026-03-20T00:00:00.000Z"),
      conv("demo-003", { outcome: "payment_plan", agreedAt: "2026-03-10T16:10:00.000Z" }),
      conv("demo-004", { outcome: "promise_to_pay", agreedAt: "2026-03-10T16:10:00.000Z" }),
      conv("demo-005", { outcome: "disputed", handedToHuman: true }),
    ]),
  );
  // Run B: another run that must not leak into A.
  await importArtifact(db.pool, bulk("bulk-b", "2026-10-16T09:00:00.000Z", [paid("demo-001", "2026-03-11T16:10:00.000Z")]));
  // Run C: zero payments, newest.
  await importArtifact(db.pool, bulk("bulk-c", "2026-10-16T11:00:00.000Z", [conv("demo-006", {})]));
  // An eval run on eval accounts in the same database.
  await importArtifact(db.pool, await runEval({ runId: "eval-r", createdAt: "2026-10-16T12:00:00.000Z", provider: mockProvider(), versions: ["baseline", "guarded"] }));
  await importArtifact(db.pool, runPicker({ runId: "picker-r", createdAt: "2026-10-16T12:00:00.000Z", trainSeed: 11, testSeed: 22, exploreSeed: 33 }));
});
afterAll(async () => db?.drop());

test("overview matches hand-computed numbers and ignores other runs and eval accounts", async () => {
  const contacted = ["demo-001", "demo-002", "demo-003", "demo-004", "demo-005"].reduce((n, k) => n + bal(k), 0);
  const o = await overview("bulk-a", db.pool);
  expect(o.recoveredCents).toBe(bal("demo-001")); // demo-002 paid after the cutoff
  expect(o.contactedBalanceCents).toBe(contacted);
  expect(o.recoveryRatePct).toBe(Math.round((1000 * bal("demo-001")) / contacted) / 10);
  expect(o.daysFromOutreachToPayment).toBe(2.0); // 2 days 10 minutes, rounded to 0.1
  expect(o).toMatchObject({ plans: 1, promises: 1, handoffs: 1 });
});

test("zero receipts give 0% recovered and n/a days", async () => {
  const o = await overview("bulk-c", db.pool);
  expect(o).toMatchObject({ recoveredCents: 0, recoveryRatePct: 0, daysFromOutreachToPayment: null, contactedBalanceCents: bal("demo-006") });
});

test("overview of an eval run is empty, not mixed in", async () => {
  const o = await overview("eval-r", db.pool);
  expect(o.contactedBalanceCents).toBe(0);
  expect(o.recoveryRatePct).toBeNull();
});

test("aging covers only the contacted cohort of the run", async () => {
  const rows = await aging("bulk-a", db.pool);
  expect(rows.reduce((n, r) => n + r.accounts, 0)).toBe(5);
  const b1 = rows.find((r) => r.bucket === bucket("demo-001"))!;
  expect(b1.recoveredCents).toBeGreaterThanOrEqual(bal("demo-001"));
  expect(rows.map((r) => r.bucket)).toEqual([...rows.map((r) => r.bucket)].sort((x, y) => parseInt(x) - parseInt(y)));
});

test("latest completed run by kind, newest first", async () => {
  expect((await latestRun("bulk", {}, db.pool))?.id).toBe("bulk-c");
  expect((await latestRun("picker", {}, db.pool))?.id).toBe("picker-r");
  expect(await latestRun("eval", { recordingSetId: "nope" }, db.pool)).toBeNull();
});

test("conversation list and message detail", async () => {
  const list = await conversations("bulk-a", db.pool);
  expect(list).toHaveLength(5);
  expect(list.find((c) => c.accountKey === "demo-005")!.handedToHuman).toBe(true);
  const msgs = await messages(list[0].id, db.pool);
  expect(msgs[0]).toMatchObject({ seq: 1, role: "agent", body: "Hi" });
});

test("eval grid has every scenario check for both versions", async () => {
  const grid = await evalGrid("eval-r", db.pool);
  expect(grid).toHaveLength(24 * 7);
  expect(new Set(grid.map((g) => g.scenarioId)).size).toBe(12);
});

test("picker summary from SQL equals the in-memory summary (test rows only)", async () => {
  const p = runPicker({ runId: "x", createdAt: "2026-10-16T12:00:00.000Z", trainSeed: 11, testSeed: 22, exploreSeed: 33 });
  const expected = summarize(p.trials);
  const rows = await pickerSummary("picker-r", db.pool);
  for (const e of expected) {
    const f = rows.find((r) => r.segment === e.segment && r.strategy === "fixed")!;
    const l = rows.find((r) => r.segment === e.segment && r.strategy === "learned")!;
    expect(f.n).toBe(e.n);
    expect(f.payRate).toBeCloseTo(e.fixed.pay, 10);
    expect(l.payRate).toBeCloseTo(e.learned.pay, 10);
    expect(l.respondRate).toBeCloseTo(e.learned.respond, 10);
  }
});

test("eval selection uses the pinned live recording set, never a newer mock run", async () => {
  const { replayProvider } = await import("../../src/lib/llm/recording");
  const setId = JSON.parse((await import("node:fs")).readFileSync("fixtures/replay-set.json", "utf8")).setId;
  const replayed = await runEval({ runId: "eval-pinned", createdAt: "2026-10-16T08:00:00.000Z", provider: replayProvider(setId, { requireLive: true }), versions: ["baseline", "guarded"] });
  await importArtifact(db.pool, replayed);
  // eval-r (mock, created later at 12:00) must not win.
  expect((await latestRun("eval", { recordingSetId: setId }, db.pool))?.id).toBe("eval-pinned");
  await expect(latestRun("eval", {}, db.pool)).rejects.toThrow(/recording set/);
});
