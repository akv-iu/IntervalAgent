import { Artifact, type EvalArtifact } from "../src/lib/artifact";
import { gate, HARD, summaryTable } from "../src/lib/checks";
import { runEval } from "../src/lib/sim/eval";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";

const meta = { runId: "eval-test", createdAt: "2026-10-15T12:00:00.000Z" };
let mock: EvalArtifact;
let bad: EvalArtifact;

beforeAll(async () => {
  mock = await runEval({ ...meta, provider: mockProvider(), versions: ["baseline", "guarded"] });
  bad = await runEval({ ...meta, provider: mockBadProvider(), versions: ["baseline", "guarded"] });
});

test("full mock run covers 12 scenarios x 2 versions and parses", () => {
  expect(mock.conversations).toHaveLength(24);
  expect(Artifact.safeParse(mock).success).toBe(true);
  expect(mock.sourceMode).toBe("mock");
});

test("message checks are stored on agent messages", () => {
  const first = mock.conversations[0].messages.find((m) => m.role === "agent")!;
  expect(first.checks.map((c) => c.name)).toContain("quiet_hours");
});

test("gate passes on the full mock run", () => {
  const g = gate(mock);
  expect(g.problems).toEqual([]);
  expect(g.ok).toBe(true);
});

test("gate fails when a scenario is missing and names it", () => {
  const g = gate({ ...mock, conversations: mock.conversations.filter((c) => c.scenarioId !== "S12") });
  expect(g.ok).toBe(false);
  expect(g.problems.join()).toMatch(/S12/);
});

test("gate fails when S09 never reached the stop", () => {
  const conversations = mock.conversations.map((c) =>
    c.scenarioId === "S09" ? { ...c, messages: c.messages.map((m) => (m.personaState ? { ...m, text: "ok", personaState: { ...m.personaState, stopped: false } } : m)) } : c,
  );
  const g = gate({ ...mock, conversations });
  expect(g.ok).toBe(false);
  expect(g.problems.join()).toMatch(/S09/);
});

test("gate fails a failed run", () => expect(gate({ ...mock, status: "failed" }).ok).toBe(false));

test("bad fixture: baseline fails hard checks, guarded still passes them", () => {
  const failed = (version: string, name: string) =>
    bad.conversations.filter((c) => c.version === version).some((c) => c.scenarioChecks.find((x) => x.name === name)?.passed === false);
  expect(failed("baseline", "no_threats_or_false_claims")).toBe(true);
  expect(failed("baseline", "stop_honored")).toBe(true);
  expect(failed("baseline", "quiet_hours")).toBe(true);
  for (const name of HARD) expect(failed("guarded", name)).toBe(false);
  expect(gate(bad).ok).toBe(true); // gate judges guarded only; baseline may fail
});

test("limit and version filters", async () => {
  const a = await runEval({ ...meta, provider: mockProvider(), versions: ["guarded"], limit: 2 });
  expect(a.conversations.map((c) => `${c.scenarioId}:${c.version}`)).toEqual(["S01:guarded", "S02:guarded"]);
  expect(gate(a).ok).toBe(false); // partial runs never pass the release gate
});

test("summary table lists every scenario", () => {
  const t = summaryTable(mock);
  for (let i = 1; i <= 12; i++) expect(t).toContain(`S${String(i).padStart(2, "0")}`);
});

describe("gate review regressions", () => {
  test("an applicable guarded hard check marked n/a fails the gate", () => {
    const conversations = mock.conversations.map((c) =>
      c.scenarioId === "S09" && c.version === "guarded"
        ? { ...c, scenarioChecks: c.scenarioChecks.map((x) => (x.name === "stop_honored" ? { ...x, passed: null } : x)) }
        : c,
    );
    expect(gate({ ...mock, conversations }).ok).toBe(false);
  });
  test("bait must be the expected first customer message", () => {
    const conversations = mock.conversations.map((c) =>
      c.scenarioId === "S08" ? { ...c, messages: c.messages.map((m) => (m.role === "customer" ? { ...m, text: "Hello" } : m)) } : c,
    );
    const g = gate({ ...mock, conversations });
    expect(g.ok).toBe(false);
    expect(g.problems.join()).toMatch(/S08.*bait/);
  });
});
