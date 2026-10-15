import { Artifact, slug } from "../src/lib/artifact";

const conv = {
  accountKey: "demo-001",
  scenarioId: null,
  version: "guarded",
  channel: "sms",
  tone: "friendly",
  startedAt: "2026-03-10T16:00:00.000Z",
  outcome: "agreed_to_pay",
  agreedAt: "2026-03-10T16:10:00.000Z",
  paidAt: "2026-03-12T16:10:00.000Z",
  recoveredCents: 8400,
  handedToHuman: false,
  messages: [
    { seq: 1, role: "agent", text: "Hi", sentAt: "2026-03-10T16:00:00.000Z", guardFlags: [], checks: [{ name: "quiet_hours", passed: true, detail: "" }] },
  ],
  scenarioChecks: [],
};

const bulk = {
  schemaVersion: 1,
  runId: "bulk-20261015-120000",
  kind: "bulk",
  createdAt: "2026-10-15T12:00:00.000Z",
  status: "complete",
  sourceMode: "mock",
  scenarioVersion: 1,
  reportAsOf: "2026-03-17T00:00:00.000Z",
  metadata: {},
  conversations: [conv],
};

test("valid bulk artifact parses", () => expect(Artifact.safeParse(bulk).success).toBe(true));
test("fractional cents rejected", () =>
  expect(Artifact.safeParse({ ...bulk, conversations: [{ ...conv, recoveredCents: 84.5 }] }).success).toBe(false));
test("traversal run id rejected", () => expect(Artifact.safeParse({ ...bulk, runId: "../etc" }).success).toBe(false));
test("bulk without reportAsOf rejected", () => {
  const { reportAsOf: _omit, ...rest } = bulk;
  void _omit;
  expect(Artifact.safeParse(rest).success).toBe(false);
});
test("complete artifact cannot contain a failed conversation", () =>
  expect(Artifact.safeParse({ ...bulk, conversations: [{ ...conv, outcome: "failed", paidAt: null, agreedAt: null, recoveredCents: 0 }] }).success).toBe(false));
test("failed artifact may contain a failed conversation", () =>
  expect(
    Artifact.safeParse({ ...bulk, status: "failed", conversations: [{ ...conv, outcome: "failed", paidAt: null, agreedAt: null, recoveredCents: 0 }] }).success,
  ).toBe(true));
test("picker artifact parses", () => {
  const picker = {
    schemaVersion: 1,
    runId: "picker-1",
    kind: "picker",
    createdAt: "2026-10-15T12:00:00.000Z",
    status: "complete",
    sourceMode: "synthetic",
    scenarioVersion: 1,
    metadata: {},
    trainSeed: 1,
    testSeed: 2,
    exploreSeed: 3,
    counts: { trainPerSegment: 500, testPerSegment: 200 },
    reward: "paid ? 1 : 0",
    selected: Object.fromEntries(["1-30", "31-60", "61-90", "91-120"].map((b) => [b, { channel: "sms", window: "morning", tone: "friendly" }])),
    trials: [
      { phase: "test", segment: "1-30", caseId: "t-1-30-0001", strategy: "learned", arm: { channel: "email", window: "evening", tone: "formal" }, responded: false, paid: true },
    ],
  };
  // paid without responded is invalid
  expect(Artifact.safeParse(picker).success).toBe(false);
  picker.trials[0].responded = true;
  expect(Artifact.safeParse(picker).success).toBe(true);
});
test.each(["ok-1", "eval-20261015", "a"])("slug ok %s", (s) => expect(slug.safeParse(s).success).toBe(true));
test.each(["../x", "A", "-x", "a/b", "a".repeat(65), ""])("slug bad %s", (s) => expect(slug.safeParse(s).success).toBe(false));

test("unsupported scenarioVersion rejected", () => expect(Artifact.safeParse({ ...bulk, scenarioVersion: -1 }).success).toBe(false));
test("complete artifact rejects a conversation with no messages", () =>
  expect(Artifact.safeParse({ ...bulk, conversations: [{ ...conv, messages: [] }] }).success).toBe(false));
test("replay artifact needs recording set and original source", () => {
  const replay = { ...bulk, kind: "eval", sourceMode: "replay", conversations: [{ ...conv, accountKey: "eval-S01", scenarioId: "S01" }] };
  expect(Artifact.safeParse(replay).success).toBe(false);
  expect(Artifact.safeParse({ ...replay, recordingSetId: "live-1", metadata: { originalSourceMode: "live" } }).success).toBe(true);
});
test("picker must select an arm for every segment", () => {
  const arm = { channel: "sms", window: "morning", tone: "friendly" };
  const base = {
    schemaVersion: 1, runId: "picker-2", kind: "picker", createdAt: "2026-10-15T12:00:00.000Z", status: "complete",
    sourceMode: "synthetic", scenarioVersion: 1, metadata: {}, trainSeed: 1, testSeed: 2, exploreSeed: 3,
    counts: { trainPerSegment: 500, testPerSegment: 200 }, reward: "paid ? 1 : 0", trials: [],
  };
  expect(Artifact.safeParse({ ...base, selected: {} }).success).toBe(false);
  expect(Artifact.safeParse({ ...base, selected: { "1-30": arm, "31-60": arm, "61-90": arm, "91-120": arm } }).success).toBe(true);
});
