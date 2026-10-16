// Write side for lessons. Reached only by the local-only live route (tests/import-graph.test.ts).
import type { Pool } from "pg";
import { getPool } from "./db";
import type { Lesson } from "./lessons";

type Db = Pick<Pool, "query">;
export type NewLesson = Omit<Lesson, "id" | "createdAt" | "active" | "timesUsed">;

export async function insertLesson(l: NewLesson, db: Db = getPool()): Promise<number> {
  const r = await db.query(
    `insert into lessons (situation, reason, instruction, hard_rule, applies_to, scenario_id, moment, before_text, after_text)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) returning id`,
    [l.situation, l.reason, l.instruction, l.hardRule, l.appliesTo, l.scenarioId, JSON.stringify(l.moment), l.beforeText, l.afterText],
  );
  return r.rows[0].id;
}

export async function setActive(id: number, active: boolean, db: Db = getPool()): Promise<void> {
  await db.query("update lessons set active = $2 where id = $1", [id, active]);
}

export async function deleteLesson(id: number, db: Db = getPool()): Promise<void> {
  await db.query("delete from lessons where id = $1", [id]);
}

// Counts how many replies a lesson was sent with (not whether it worked).
export async function bumpUsed(ids: number[], db: Db = getPool()): Promise<void> {
  if (ids.length) await db.query("update lessons set times_used = times_used + 1 where id = any($1::int[])", [ids]);
}
