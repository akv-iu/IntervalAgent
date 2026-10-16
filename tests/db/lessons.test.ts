import { adjustTryTokens, deleteLesson, bumpUsed, insertLesson, lessonCount, reserveTryTokens, setActive } from "../../src/lib/lessons-store";
import { lessonsLog } from "../../src/lib/reports";
import { readFileSync } from "node:fs";
import { testSchema } from "./helpers";

let db: Awaited<ReturnType<typeof testSchema>>;
beforeAll(async () => {
  db = await testSchema();
});
afterAll(async () => db?.drop());

const base = {
  situation: "refusal" as const,
  reason: "gave_up" as const,
  instruction: "Do not give up.",
  hardRule: null,
  appliesTo: "situation" as const,
  scenarioId: "S01",
  moment: [{ role: "customer" as const, text: "I don't want to pay you", sentAt: "2026-03-10T16:10:00.000Z" }],
  beforeText: "Understood.",
  afterText: "I hear you.",
};

test("insert, read back, toggle, count use, delete", async () => {
  const id = await insertLesson(base, db.pool);
  let [l] = await lessonsLog(db.pool);
  expect(l).toMatchObject({ id, situation: "refusal", hardRule: null, active: true, timesUsed: 0, moment: base.moment });
  await setActive(id, false, db.pool);
  await bumpUsed([id], db.pool); // one reply
  await bumpUsed([id], db.pool); // another reply
  [l] = await lessonsLog(db.pool);
  expect(l).toMatchObject({ active: false, timesUsed: 2 });
  await deleteLesson(id, db.pool);
  expect(await lessonsLog(db.pool)).toEqual([]);
});

test("the database rejects an unknown situation or hard rule", async () => {
  await expect(insertLesson({ ...base, situation: "anything" as never }, db.pool)).rejects.toThrow();
  await expect(insertLesson({ ...base, hardRule: "delete_db" as never }, db.pool)).rejects.toThrow();
});

test("scope is stored, and the database refuses a hand-off rule on every reply", async () => {
  const id = await insertLesson({ ...base, situation: "plan_request", appliesTo: "all" }, db.pool);
  expect((await lessonsLog(db.pool)).find((l) => l.id === id)).toMatchObject({ situation: "plan_request", appliesTo: "all" });
  await expect(insertLesson({ ...base, hardRule: "handoff", appliesTo: "all" }, db.pool)).rejects.toThrow();
});

const tokensOn = async (day: string) => Number((await db.pool.query("select tokens from try_usage where day = $1", [day])).rows[0]?.tokens ?? 0);

test("reservations never go over the daily cap, even all at once", async () => {
  const ok = await Promise.all(Array.from({ length: 10 }, () => reserveTryTokens("2026-10-17", 300, 1000, db.pool)));
  expect(ok.filter(Boolean)).toHaveLength(3);
  expect(await tokensOn("2026-10-17")).toBe(900);
  expect(await reserveTryTokens("2026-10-18", 1001, 1000, db.pool)).toBe(false); // too big for an empty day
  expect(await tokensOn("2026-10-18")).toBe(0);
});

test("unused reservation is given back, never below zero", async () => {
  await reserveTryTokens("2026-10-19", 500, 1000, db.pool);
  await adjustTryTokens("2026-10-19", -200, db.pool);
  expect(await tokensOn("2026-10-19")).toBe(300);
  await adjustTryTokens("2026-10-19", -999, db.pool);
  expect(await tokensOn("2026-10-19")).toBe(0);
});

test("lessons are counted for the public cap", async () => {
  const before = await lessonCount(db.pool);
  await insertLesson(base, db.pool);
  expect(await lessonCount(db.pool)).toBe(before + 1);
});

// The grants in db/ops/try_writer_role.sql, applied to a throwaway role in this test schema.
test("the public lessons login can add lessons and count use, nothing else", async () => {
  const role = `tw_${db.schema.slice(5)}`;
  const grants = readFileSync("db/ops/try_writer_role.sql", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("create role")) // the test makes its own role, without a password
    .join("\n")
    .replaceAll("recovery_try_writer", role)
    .replace("schema public", `schema ${db.schema}`);
  const c = await db.pool.connect();
  try {
    await c.query(`create role ${role} nologin`);
    await c.query(`grant ${role} to current_user`);
    await c.query(grants);
    await c.query(`set role ${role}`);
    const id = await insertLesson(base, c);
    await bumpUsed([id], c);
    expect(await reserveTryTokens("2026-10-20", 10, 1000, c)).toBe(true);
    await adjustTryTokens("2026-10-20", -5, c);
    expect(await lessonCount(c)).toBeGreaterThan(0);
    await setActive(id, false, c); // visitors may turn lessons off and on
    for (const sql of [`delete from lessons where id = ${id}`, `update lessons set instruction = 'x' where id = ${id}`, "select * from runs", "delete from try_usage"]) {
      await expect(c.query(sql)).rejects.toThrow(/permission denied/);
    }
  } finally {
    await c.query("reset role");
    await c.query(`drop owned by ${role}`);
    await c.query(`drop role ${role}`);
    c.release();
  }
});
