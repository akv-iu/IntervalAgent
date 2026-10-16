// The live route on the public site: the real model (faked here), lessons written through the lessons-only
// login (faked), tokens reserved from a shared daily cap before any call, and no turning lessons off or deleting them.
import type { Lesson } from "../src/lib/lessons";
import type { Budget } from "../src/lib/llm/budget";

const s = vi.hoisted(() => ({
  room: true,
  reserved: [] as number[],
  adjusted: [] as number[],
  inserted: 0,
  calls: 0,
  done: 0,
  managed: 0,
  lessons: [] as Lesson[],
  count: 0,
  failFirst: false,
  readerDown: false,
}));

// The deployed site has no .env file; tryMode gets that explicitly (never the real local .env).
vi.mock("../src/lib/project-env", async (orig) => {
  const m = await orig<typeof import("../src/lib/project-env")>();
  return { ...m, projectEnv: () => ({}), tryMode: (host = process.env) => m.tryMode(host, {}) };
});
vi.mock("../src/lib/reports", () => ({
  lessonsLog: async (): Promise<Lesson[]> => {
    if (s.readerDown) throw new Error("password authentication failed for user 'recovery_try_writer'");
    return s.lessons;
  },
}));
vi.mock("../src/lib/lessons-store", () => ({
  insertLesson: async () => {
    s.inserted++;
  },
  setActive: async () => {
    s.managed++;
  },
  deleteLesson: async () => {
    s.managed++;
  },
  bumpUsed: async () => {},
  lessonCount: async () => {
    if (s.count < 0) throw new Error("password authentication failed for user 'recovery_reader'");
    return s.count;
  },
  reserveTryTokens: async (_day: string, n: number) => {
    s.reserved.push(n);
    return s.room;
  },
  adjustTryTokens: async (_day: string, delta: number) => {
    s.adjusted.push(delta);
  },
}));
vi.mock("../src/lib/llm/openai", () => ({
  openaiProvider: (o: { apiKey: string; model: string; budget: Budget }) => ({
    name: "openai",
    model: o.model,
    params: {},
    async complete() {
      const n = ++s.calls;
      o.budget.reserve(100);
      if (s.failFirst && n === 1) throw new Error("upstream failed");
      await new Promise((r) => setTimeout(r, s.failFirst ? 20 : 0)); // siblings finish after the first one failed
      o.budget.record(250);
      s.done++;
      return { text: JSON.stringify({ message: "Hi Maya, this is Northside Fitness. Your account is past due with a balance of $84.00.", action: "send" }) };
    },
  }),
}));

import { POST } from "../src/app/api/live/route";

const HOST = { APP_MODE: "public", PUBLIC_TRY: "live", TRY_OPENAI_API_KEY: "k", TRY_OPENAI_MODEL: "m", DATABASE_URL_LESSONS: "u", TRY_DAILY_TOKENS: "100000" };
let ip = 0;
const post = (body: unknown, from = `10.0.0.${++ip}`) =>
  POST(new Request("https://site/api/live", { method: "POST", headers: { "x-forwarded-for": `${from}, 1.1.1.1` }, body: JSON.stringify(body) }));
const opening = { scenarioId: "S01", version: "guarded", messages: [] };
const reply = [
  { role: "agent", text: "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due.", sentAt: "2026-03-10T16:00:00.000Z" },
  { role: "customer", text: "I don't want to pay you", sentAt: "2026-03-10T16:10:00.000Z" },
];
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
  moment: reply as Lesson["moment"],
  beforeText: "b",
  afterText: "a",
  active: true,
  timesUsed: 0,
});

// The route's per-minute limits live in module memory; each test starts two minutes after the last.
let clock = Date.now();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((clock += 120_000));
  Object.assign(process.env, HOST);
  Object.assign(s, { room: true, reserved: [], adjusted: [], inserted: 0, calls: 0, done: 0, managed: 0, lessons: [], count: 0, failFirst: false, readerDown: false });
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of Object.keys(HOST)) delete process.env[k];
});

test("a turn reserves tokens first, then gives back what it did not use", async () => {
  const r = await post(opening);
  expect(r.status).toBe(200);
  expect((await r.json()).agent).toBe("live");
  expect(s.reserved).toHaveLength(1);
  expect(s.adjusted).toEqual([250 * s.done - s.reserved[0]]);
});

test("no room left today: no model call", async () => {
  s.room = false;
  const r = await post(opening);
  expect(r.status).toBe(429);
  expect((await r.json()).error).toMatch(/today/i);
  expect(s.calls).toBe(0);
});

test("a failed request keeps its whole reservation: a lost reply may still have been paid for", async () => {
  s.lessons = [1, 2, 3].map(lesson);
  s.failFirst = true;
  const r = await post({ op: "recheck", page: 0 });
  expect(r.status).toBe(503);
  expect(s.done).toBeGreaterThan(0); // the siblings finished before counting
  expect(s.adjusted).toEqual([]); // nothing given back
});

test("visitors can turn a lesson off and on (Akshay: reviewers should see it)", async () => {
  const r = await post({ op: "toggle", id: 1, active: false });
  expect(r.status).toBe(200);
  expect(s.managed).toBe(1);
});

test("visitors cannot delete lessons: deleting is permanent", async () => {
  const r = await post({ op: "delete", id: 1 });
  expect(r.status).toBe(403);
  expect(s.managed).toBe(0);
});

test("turning lessons on and off counts toward the visitor's limit", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 13; i++) codes.push((await post({ op: "toggle", id: 1, active: i % 2 === 0 }, "10.7.7.7")).status);
  expect(codes[12]).toBe(429);
});

test("once the lesson log is full, no more lessons are saved", async () => {
  s.count = 200;
  const r = await post({ op: "accept", draftLesson: draft, beforeText: "b", afterText: "a", scenarioId: "S01", messages: reply });
  expect(r.status).toBe(409);
  expect(s.inserted).toBe(0);
});

test("one visitor is limited per minute; another visitor is not", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 13; i++) codes.push((await post(opening, "10.9.9.9")).status);
  expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
  expect(codes[12]).toBe(429);
  expect((await post(opening, "10.9.9.10")).status).toBe(200);
});

test("an empty recheck still counts toward the visitor's limit", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 13; i++) codes.push((await post({ op: "recheck", page: 999999 }, "10.8.8.8")).status);
  expect(codes[12]).toBe(429);
});

test("off when the host has not opted in, even with APP_MODE=public", async () => {
  delete process.env.PUBLIC_TRY;
  expect((await post(opening)).status).toBe(404);
});

test("server errors reach visitors as a plain message, never database details", async () => {
  s.count = -1; // makes the fake lessonCount fail below
  const r = await post({ op: "accept", draftLesson: draft, beforeText: "b", afterText: "a", scenarioId: "S01", messages: reply });
  const body = await r.json();
  expect(r.status).toBe(503);
  expect(body.error).not.toMatch(/password|recovery_|postgres/i);
});

test("when lessons cannot be read, the chat still works and visitors see no database details", async () => {
  s.readerDown = true;
  const r = await post(opening);
  const body = await r.json();
  expect(r.status).toBe(200);
  expect(body.lessonsOff).toBeTruthy();
  expect(body.lessonsOff).not.toMatch(/password|recovery_|postgres/i);
});

// Outside review: a conversation where the agent already sent 10 messages is finished and cannot be replayed.
const finished = Array.from({ length: 19 }, (_, i) => ({
  role: i % 2 === 0 ? "agent" : "customer",
  text: i % 2 === 0 ? "Hi Maya, this is Northside Fitness. Your $84.00 balance is past due." : "I don't want to pay you",
  sentAt: new Date(Date.UTC(2026, 2, 10, 16, i * 10)).toISOString(),
}));

describe("finished conversations are refused before anything is saved or reserved", () => {
  test("accepting a lesson on one", async () => {
    const r = await post({ op: "accept", draftLesson: draft, beforeText: "b", afterText: "a", scenarioId: "S01", messages: finished });
    expect(r.status).toBe(400);
    expect(s.inserted).toBe(0);
  });
  test.each(["turn", "retry"])("%s on one", async (op) => {
    const r = await post({ op, draftLesson: draft, scenarioId: "S01", version: "guarded", messages: finished });
    expect(r.status).toBe(400);
    expect(s.reserved).toEqual([]);
    expect(s.calls).toBe(0);
  });
  test("a stored lesson on a finished conversation is skipped by recheck, the others still run", async () => {
    s.lessons = [{ ...lesson(1), moment: finished as Lesson["moment"] }, lesson(2)];
    const r = await post({ op: "recheck", page: 0 });
    expect(r.status).toBe(200);
    const { results } = await r.json();
    expect(results.find((x: { id: number }) => x.id === 1).verdict).toMatch(/finished/);
    expect(results.find((x: { id: number }) => x.id === 2).text).toBeTruthy();
  });
});
