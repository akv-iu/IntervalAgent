import { readFileSync } from "node:fs";
import { Artifact } from "../src/lib/artifact";
import { ARMS, FIXED_ARM, runPicker, summarize } from "../src/lib/picker";
import { drawOutcome } from "../src/lib/picker-env";

const meta = { runId: "picker-test", createdAt: "2026-10-15T12:00:00.000Z" };
const seeds = { trainSeed: 11, testSeed: 22, exploreSeed: 33 };
const a = runPicker({ ...meta, ...seeds });
const SEGMENTS = ["1-30", "31-60", "61-90", "91-120"] as const;

test("eight arms; fixed baseline is sms, morning, friendly", () => {
  expect(ARMS).toHaveLength(8);
  expect(new Set(ARMS.map((x) => `${x.channel}/${x.window}/${x.tone}`)).size).toBe(8);
  expect(FIXED_ARM).toEqual({ channel: "sms", window: "morning", tone: "friendly" });
});

test("same seeds give the identical artifact; it parses", () => {
  expect(runPicker({ ...meta, ...seeds })).toEqual(a);
  expect(Artifact.safeParse(a).success).toBe(true);
  expect(a.reward).toBe("paid ? 1 : 0");
});

test("different test seed changes test outcomes but not training", () => {
  const b = runPicker({ ...meta, ...seeds, testSeed: 23 });
  expect(b.trials.filter((t) => t.phase === "train")).toEqual(a.trials.filter((t) => t.phase === "train"));
  expect(b.trials.filter((t) => t.phase === "test")).not.toEqual(a.trials.filter((t) => t.phase === "test"));
});

test("500 training rows and 200 test rows per strategy per segment", () => {
  for (const s of SEGMENTS) {
    expect(a.trials.filter((t) => t.phase === "train" && t.segment === s)).toHaveLength(500);
    for (const strategy of ["fixed", "learned"] as const) {
      expect(a.trials.filter((t) => t.phase === "test" && t.segment === s && t.strategy === strategy)).toHaveLength(200);
    }
  }
});

test("train and test cases are disjoint", () => {
  const train = new Set(a.trials.filter((t) => t.phase === "train").map((t) => t.caseId));
  expect(a.trials.filter((t) => t.phase === "test").some((t) => train.has(t.caseId))).toBe(false);
});

test("paid implies responded on every row", () => expect(a.trials.every((t) => !t.paid || t.responded)).toBe(true));

test("training tries every arm in every segment", () => {
  for (const s of SEGMENTS) {
    const tried = new Set(a.trials.filter((t) => t.phase === "train" && t.segment === s).map((t) => JSON.stringify(t.arm)));
    expect(tried.size).toBe(8);
  }
});

test("learned policy is frozen during test", () => {
  for (const s of SEGMENTS) {
    const arms = a.trials.filter((t) => t.phase === "test" && t.segment === s && t.strategy === "learned").map((t) => t.arm);
    expect(arms.every((x) => JSON.stringify(x) === JSON.stringify(a.selected[s]))).toBe(true);
  }
});

test("fixed and learned see paired draws: same arm, same outcome", () => {
  for (const s of SEGMENTS) {
    if (JSON.stringify(a.selected[s]) !== JSON.stringify(FIXED_ARM)) continue;
    const f = a.trials.filter((t) => t.phase === "test" && t.segment === s && t.strategy === "fixed");
    const l = a.trials.filter((t) => t.phase === "test" && t.segment === s && t.strategy === "learned");
    expect(l.map((t) => [t.responded, t.paid])).toEqual(f.map((t) => [t.responded, t.paid]));
  }
});

test("summary uses test rows only", () => {
  const base = summarize(a.trials);
  const poisoned = summarize([
    ...a.trials,
    { phase: "train", segment: "1-30", caseId: "x", strategy: "learned", arm: FIXED_ARM, responded: true, paid: true },
  ]);
  expect(poisoned).toEqual(base);
  const all = base.find((r) => r.segment === "all")!;
  expect(all.n).toBe(800);
  expect(base.filter((r) => r.segment !== "all")).toHaveLength(4);
  expect(all.payDiffPts).toBeCloseTo((all.learned.pay - all.fixed.pay) * 100, 6);
});

test("environment: payment is impossible without a response", () => {
  expect(drawOutcome("1-30", FIXED_ARM, 0.999999, 0)).toEqual({ responded: false, paid: false });
});

test("the learner cannot import the hidden probability table", () => {
  const src = readFileSync("src/lib/picker.ts", "utf8");
  const imports = [...src.matchAll(/import\s*{([^}]*)}\s*from\s*"\.\/picker-env"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
  expect(imports.filter(Boolean).sort()).toEqual(["ENV_VERSION", "drawOutcome"].sort());
});

test("the environment module exposes only the draw function and its version", async () => {
  const env = await import("../src/lib/picker-env");
  expect(Object.keys(env).sort()).toEqual(["ENV_VERSION", "drawOutcome"]);
});
