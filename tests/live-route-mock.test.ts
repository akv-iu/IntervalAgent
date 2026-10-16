// The route with a local .env and live switched off: the mock agent answers, no key, no network.
// The lessons database is replaced with an in-memory stand-in.
import type { Lesson } from "../src/lib/lessons";

const db = vi.hoisted(() => ({ lessons: [] as Lesson[], inserted: [] as unknown[], bumped: [] as number[][], down: false, reads: 0 }));

// tryMode calls projectEnv inside its own module, so it gets the fake .env explicitly (never the real one).
vi.mock("../src/lib/project-env", async (orig) => {
  const m = await orig<typeof import("../src/lib/project-env")>();
  return { ...m, projectEnv: () => ({ APP_MODE: "local" }), tryMode: (host = process.env) => m.tryMode(host, { APP_MODE: "local" }) };
});
vi.mock("../src/lib/reports", () => ({
  lessonsLog: async () => {
    db.reads++;
    if (db.down) throw new Error("Missing required env vars: DATABASE_URL");
    return db.lessons;
  },
}));
vi.mock("../src/lib/lessons-store", () => ({
  insertLesson: async (l: unknown) => {
    db.inserted.push(l);
  },
  setActive: async () => {},
  deleteLesson: async () => {},
  bumpUsed: async (ids: number[]) => {
    db.bumped.push(ids);
  },
}));

import { POST } from "../src/app/api/live/route";

const post = (body: unknown) => POST(new Request("http://localhost/api/live", { method: "POST", body: JSON.stringify(body) }));
const opened = [{ role: "agent", text: "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", sentAt: "2026-03-10T16:00:00.000Z" }];
const moment = [...opened, { role: "customer", text: "I don't want to pay you", sentAt: "2026-03-10T16:10:00.000Z" }];
const draft = { reason: "gave_up", instruction: "Do not give up. Offer the plan or a person.", hardRule: null };
const lesson = (id: number): Lesson => ({
  id,
  createdAt: "2026-10-16T12:00:00.000Z",
  situation: "refusal",
  reason: "gave_up",
  instruction: `lesson ${id}`,
  hardRule: null,
  appliesTo: "situation",
  scenarioId: "S01",
  moment: moment as Lesson["moment"],
  beforeText: "b",
  afterText: "a",
  active: true,
  timesUsed: 0,
});

beforeEach(() => {
  process.env.APP_MODE = "local";
  db.lessons = [];
  db.inserted = [];
  db.bumped = [];
  db.down = false;
  db.reads = 0;
});
afterEach(() => {
  delete process.env.APP_MODE;
});

test("live off: the mock agent answers without a key", async () => {
  const res = await post({ scenarioId: "S01", version: "guarded", messages: [] });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.text).toMatch(/\$84\.00/);
  expect(body.agent).toBe("mock");
});

test("a normal turn counts the lessons it used", async () => {
  db.lessons = [lesson(7)];
  const res = await post({ scenarioId: "S01", version: "guarded", messages: moment });
  expect((await res.json()).lessonsUsed).toEqual([7]);
  expect(db.bumped).toEqual([[7]]);
});

describe("bad lesson requests are rejected before any model call", () => {
  test.each([
    [{ op: "retry", scenarioId: "S01", messages: moment }],
    [{ op: "retry", scenarioId: "S01", messages: moment, draftLesson: { ...draft, instruction: "x".repeat(301) } }],
    [{ op: "nuke", scenarioId: "S01", messages: moment }],
    [{ op: "toggle", id: "1; drop table lessons", active: false }],
  ])("%j", async (body) => expect((await post(body)).status).toBe(400));
});

test("retry answers the same moment with the draft lesson and saves nothing", async () => {
  const res = await post({ op: "retry", scenarioId: "S01", messages: moment, draftLesson: draft });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.text.length).toBeGreaterThan(0);
  expect(body.trace.join(" ")).toMatch(/draft lesson applied/);
  expect(db.inserted).toEqual([]);
});

test("accept saves the lesson with the situation worked out by the server", async () => {
  const res = await post({ op: "accept", scenarioId: "S01", messages: moment, draftLesson: { ...draft, situation: "general" }, beforeText: "Understood.", afterText: "I hear you." });
  expect(res.status).toBe(200);
  expect(db.inserted).toHaveLength(1);
  expect(db.inserted[0]).toMatchObject({ situation: "refusal", instruction: draft.instruction, scenarioId: "S01", appliesTo: "situation" });
});

test("recheck replays at most 8 lessons", async () => {
  db.lessons = Array.from({ length: 10 }, (_, i) => lesson(i + 1));
  const res = await post({ op: "recheck" });
  expect(res.status).toBe(200);
  expect((await res.json()).results).toHaveLength(8);
});

test("public mode: every op is not found", async () => {
  process.env.APP_MODE = "public";
  for (const op of ["turn", "retry", "accept", "toggle", "delete", "recheck"]) {
    expect((await post({ op, scenarioId: "S01", messages: moment, draftLesson: draft, id: 1 })).status).toBe(404);
  }
  expect(db.inserted).toEqual([]);
});

test("no database: chat still works, lessons are reported as off", async () => {
  db.down = true;
  const res = await post({ scenarioId: "S01", version: "guarded", messages: moment });
  expect(res.status).toBe(200);
  expect((await res.json()).lessonsOff).toMatch(/database/i);
});

test("bad chat input is rejected before the database is touched", async () => {
  const res = await post({ scenarioId: "S99", version: "guarded", messages: [] });
  expect(res.status).toBe(400);
  expect(db.reads).toBe(0);
});

describe("Codex check 1 (16b): recheck and usage", () => {
  test("recheck pages through all active lessons, 8 at a time", async () => {
    db.lessons = Array.from({ length: 10 }, (_, i) => lesson(i + 1));
    const first = await (await post({ op: "recheck", page: 0 })).json();
    const second = await (await post({ op: "recheck", page: 1 })).json();
    expect(first.results).toHaveLength(8);
    expect(first.next).toBe(1);
    expect(second.results).toHaveLength(2);
    expect(second.next).toBeNull();
  });
  test("recheck judges a hard lesson by its rule, not by tags", async () => {
    db.lessons = [{ ...lesson(1), hardRule: "handoff" }];
    const out = await (await post({ op: "recheck" })).json();
    // The mock agent does not hand off on this moment, so code had to.
    expect(out.results[0].verdict).toMatch(/code/);
  });
  test("retries count as uses too", async () => {
    db.lessons = [lesson(7)];
    await post({ op: "retry", scenarioId: "S01", messages: moment, draftLesson: draft });
    expect(db.bumped).toEqual([[7]]);
  });
});

test("the opening message cannot be taught: lessons start with the first customer reply", async () => {
  for (const op of ["retry", "accept"]) {
    const res = await post({ op, scenarioId: "S01", messages: [], draftLesson: draft, beforeText: "b", afterText: "a" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/customer/);
  }
  expect(db.inserted).toEqual([]);
});
