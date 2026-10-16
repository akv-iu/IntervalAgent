// Write side for the Try page: lessons and daily token use. Reached only by the live route (tests/import-graph.test.ts).
import type { Pool } from "pg";
import { getLessonsPool } from "./db";
import type { Lesson } from "./lessons";

type Db = Pick<Pool, "query">;
export type NewLesson = Omit<Lesson, "id" | "createdAt" | "active" | "timesUsed">;

export async function insertLesson(l: NewLesson, db: Db = getLessonsPool()): Promise<number> {
  const r = await db.query(
    `insert into lessons (situation, reason, instruction, hard_rule, applies_to, scenario_id, moment, before_text, after_text)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) returning id`,
    [l.situation, l.reason, l.instruction, l.hardRule, l.appliesTo, l.scenarioId, JSON.stringify(l.moment), l.beforeText, l.afterText],
  );
  return r.rows[0].id;
}

export async function setActive(id: number, active: boolean, db: Db = getLessonsPool()): Promise<void> {
  await db.query("update lessons set active = $2 where id = $1", [id, active]);
}

export async function deleteLesson(id: number, db: Db = getLessonsPool()): Promise<void> {
  await db.query("delete from lessons where id = $1", [id]);
}

// Counts how many replies a lesson was sent with (not whether it worked).
export async function bumpUsed(ids: number[], db: Db = getLessonsPool()): Promise<void> {
  if (ids.length) await db.query("update lessons set times_used = times_used + 1 where id = any($1::int[])", [ids]);
}

// Public Try page: tokens are reserved from today's shared cap (UTC day) before any model call, in one statement,
// so simultaneous requests on different server instances cannot all slip under the cap.
export async function reserveTryTokens(day: string, tokens: number, cap: number, db: Db = getLessonsPool()): Promise<boolean> {
  const r = await db.query(
    `insert into try_usage (day, tokens) select $1, $2::bigint where $2::bigint <= $3::bigint
     on conflict (day) do update set tokens = try_usage.tokens + excluded.tokens where try_usage.tokens + excluded.tokens <= $3::bigint`,
    [day, tokens, cap],
  );
  return r.rowCount === 1;
}

// After the calls: give back what a request reserved but did not use (or add what it went over).
export async function adjustTryTokens(day: string, delta: number, db: Db = getLessonsPool()): Promise<void> {
  if (delta !== 0) await db.query("update try_usage set tokens = greatest(0, tokens + $2::bigint) where day = $1", [day, delta]);
}

export async function lessonCount(db: Db = getLessonsPool()): Promise<number> {
  const r = await db.query("select count(*)::int as n from lessons");
  return r.rows[0].n;
}
