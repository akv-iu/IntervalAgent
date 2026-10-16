// Minimal learning picker: epsilon-greedy per aging segment over channel x window x tone.
// Reward is payment (1 or 0). Train, freeze, then compare against a fixed baseline on new cases.
import { type Arm, type PickerArtifact, SCENARIO_VERSION, SCHEMA_VERSION, type Trial } from "./artifact";
import { ENV_VERSION, drawOutcome } from "./picker-env";
import { createRng, randInt } from "./rng";
import { type AgingBucket, BUCKETS } from "./sim/accounts";

export type { Arm, Trial };
export const ARMS: Arm[] = (["sms", "email"] as const).flatMap((channel) =>
  (["morning", "evening"] as const).flatMap((window) => (["friendly", "formal"] as const).map((tone) => ({ channel, window, tone }))),
);
export const FIXED_ARM: Arm = { channel: "sms", window: "morning", tone: "friendly" };
export const SEND_HOURS = { morning: 10, evening: 18 } as const;
const TRAIN_PER_SEGMENT = 500;
const TEST_PER_SEGMENT = 200;
const EPSILON = 0.1;
const SEGMENTS = BUCKETS.map(([b]) => b);

const caseId = (phase: string, segment: string, i: number) => `${phase}-${segment}-${String(i + 1).padStart(4, "0")}`;

// Highest sample-mean reward; ties go to the earlier arm so results are deterministic.
function best(sums: number[], counts: number[]): number {
  let bestIdx = 0;
  for (let i = 1; i < ARMS.length; i++) if (sums[i] / counts[i] > sums[bestIdx] / counts[bestIdx]) bestIdx = i;
  return bestIdx;
}

export function runPicker(o: { runId: string; createdAt: string; trainSeed: number; testSeed: number; exploreSeed: number }): PickerArtifact {
  const env = createRng(o.trainSeed); // customer draws during training
  const explore = createRng(o.exploreSeed); // policy randomness, separate from customer draws
  const testEnv = createRng(o.testSeed); // customer draws for the held-out test
  const trials: Trial[] = [];
  const selected = {} as Record<AgingBucket, Arm>;

  for (const segment of SEGMENTS) {
    const sums = ARMS.map(() => 0);
    const counts = ARMS.map(() => 0);
    for (let i = 0; i < TRAIN_PER_SEGMENT; i++) {
      const a = i < ARMS.length ? i : explore() < EPSILON ? randInt(explore, 0, ARMS.length - 1) : best(sums, counts);
      const { responded, paid } = drawOutcome(segment, ARMS[a], env(), env());
      counts[a]++;
      sums[a] += paid ? 1 : 0;
      trials.push({ phase: "train", segment, caseId: caseId("train", segment, i), strategy: "learned", arm: ARMS[a], responded, paid });
    }
    selected[segment] = ARMS[best(sums, counts)]; // frozen from here on
  }

  for (const segment of SEGMENTS) {
    for (let i = 0; i < TEST_PER_SEGMENT; i++) {
      // Drawn once per case, before any choice, so both strategies face the same customer.
      const u1 = testEnv();
      const u2 = testEnv();
      for (const [strategy, arm] of [
        ["fixed", FIXED_ARM],
        ["learned", selected[segment]],
      ] as const) {
        trials.push({ phase: "test", segment, caseId: caseId("test", segment, i), strategy, arm, ...drawOutcome(segment, arm, u1, u2) });
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: o.runId,
    kind: "picker",
    createdAt: o.createdAt,
    status: "complete",
    sourceMode: "synthetic",
    scenarioVersion: SCENARIO_VERSION,
    metadata: { environmentVersion: ENV_VERSION, epsilon: EPSILON, sendHours: SEND_HOURS, fixedArm: FIXED_ARM },
    trainSeed: o.trainSeed,
    testSeed: o.testSeed,
    exploreSeed: o.exploreSeed,
    counts: { trainPerSegment: TRAIN_PER_SEGMENT, testPerSegment: TEST_PER_SEGMENT },
    reward: "paid ? 1 : 0",
    selected,
    trials,
  };
}

interface Rates {
  respond: number;
  pay: number;
}
export interface SummaryRow {
  segment: AgingBucket | "all";
  n: number;
  fixed: Rates;
  learned: Rates;
  payDiffPts: number;
  respondDiffPts: number;
}

// Held-out test rows only. Training rows never enter the headline numbers.
export function summarize(trials: Trial[]): SummaryRow[] {
  const test = trials.filter((t) => t.phase === "test");
  const rates = (rows: Trial[]): Rates => ({
    respond: rows.filter((t) => t.responded).length / rows.length,
    pay: rows.filter((t) => t.paid).length / rows.length,
  });
  const row = (segment: AgingBucket | "all", rows: Trial[]): SummaryRow => {
    const fixed = rates(rows.filter((t) => t.strategy === "fixed"));
    const learned = rates(rows.filter((t) => t.strategy === "learned"));
    return {
      segment,
      n: rows.filter((t) => t.strategy === "fixed").length,
      fixed,
      learned,
      payDiffPts: (learned.pay - fixed.pay) * 100,
      respondDiffPts: (learned.respond - fixed.respond) * 100,
    };
  };
  return [...SEGMENTS.map((s) => row(s, test.filter((t) => t.segment === s))), row("all", test)];
}
