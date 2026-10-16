import { deleteLesson, bumpUsed, insertLesson, setActive } from "../../src/lib/lessons-store";
import { lessonsLog } from "../../src/lib/reports";
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
