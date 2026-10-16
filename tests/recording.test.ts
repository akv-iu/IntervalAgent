import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gate } from "../src/lib/checks";
import { mockProvider } from "../src/lib/llm/mock";
import { recordingProvider, replayProvider, requestKey } from "../src/lib/llm/recording";
import type { LlmRequest } from "../src/lib/llm/types";
import { runEval } from "../src/lib/sim/eval";

const req = (system = "You write outreach.", attempt = 1): LlmRequest => ({
  system,
  messages: [{ role: "agent", text: "hi" }],
  context: { subject: "S01", version: "guarded", turn: 1, attempt },
});
const tmp = () => mkdtempSync(join(tmpdir(), "rec-"));
const meta = { runId: "eval-rec", createdAt: "2026-10-15T12:00:00.000Z" };

describe("requestKey", () => {
  const base = { model: "m", params: { a: 1, b: 2 }, contractVersion: 1, req: req() };
  test("stable under key order", () => expect(requestKey(base)).toBe(requestKey({ ...base, params: { b: 2, a: 1 } })));
  test("changes with one character of prompt", () => expect(requestKey(base)).not.toBe(requestKey({ ...base, req: req("You write outreach!") })));
  test("changes with context attempt", () => expect(requestKey(base)).not.toBe(requestKey({ ...base, req: req(undefined, 2) })));
  test("changes with model and contract version", () => {
    expect(requestKey(base)).not.toBe(requestKey({ ...base, model: "m2" }));
    expect(requestKey(base)).not.toBe(requestKey({ ...base, contractVersion: 2 }));
  });
});

describe("record then replay", () => {
  test("replay returns the recorded text for each request", async () => {
    const dir = tmp();
    const rec = recordingProvider(mockProvider(), "set-a", dir);
    const r1 = await rec.complete(req());
    const r2 = await rec.complete(req("Other prompt"));
    rec.finish(["S01"], ["guarded"]);
    const rep = replayProvider("set-a", { dir });
    expect((await rep.complete(req())).text).toBe(r1.text);
    expect((await rep.complete(req("Other prompt"))).text).toBe(r2.text);
    expect(rep.name).toBe("replay");
    expect(rep.manifest.sourceMode).toBe("mock");
  });

  test("recording into an existing set fails", () => {
    const dir = tmp();
    recordingProvider(mockProvider(), "set-b", dir);
    expect(() => recordingProvider(mockProvider(), "set-b", dir)).toThrow(/exists/);
  });

  test("set ids must be slugs", () => {
    expect(() => recordingProvider(mockProvider(), "../evil", tmp())).toThrow();
    expect(() => replayProvider("../evil", { dir: tmp() })).toThrow();
  });
});

describe("replay fails closed", () => {
  async function recorded() {
    const dir = tmp();
    const rec = recordingProvider(mockProvider(), "set-c", dir);
    await rec.complete(req());
    rec.finish(["S01"], ["guarded"]);
    return { dir, path: (f: string) => join(dir, "set-c", f) };
  }
  const edit = (path: string, fn: (j: any) => unknown) => // eslint-disable-line @typescript-eslint/no-explicit-any -- test fixture surgery on arbitrary JSON
    writeFileSync(path, JSON.stringify(fn(JSON.parse(readFileSync(path, "utf8")))));

  test("missing key", async () => {
    const { dir } = await recorded();
    await expect(replayProvider("set-c", { dir }).complete(req("never recorded"))).rejects.toThrow(/missing recording/);
  });
  test("a changed prompt is a missing key, not a fuzzy match", async () => {
    const { dir } = await recorded();
    await expect(replayProvider("set-c", { dir }).complete(req("You write outreach"))).rejects.toThrow(/missing recording/);
  });
  test("incomplete manifest", async () => {
    const { dir, path } = await recorded();
    edit(path("manifest.json"), (m) => ({ ...m, complete: false }));
    expect(() => replayProvider("set-c", { dir })).toThrow(/incomplete/);
  });
  test("contract version mismatch", async () => {
    const { dir, path } = await recorded();
    edit(path("manifest.json"), (m) => ({ ...m, contractVersion: 99 }));
    expect(() => replayProvider("set-c", { dir })).toThrow(/version/);
  });
  test("requireLive rejects a mock-origin set", async () => {
    const { dir } = await recorded();
    expect(() => replayProvider("set-c", { dir, requireLive: true })).toThrow(/live/);
  });
  test("duplicate response keys", async () => {
    const { dir, path } = await recorded();
    edit(path("responses.json"), (r) => [...r, ...r]);
    expect(() => replayProvider("set-c", { dir })).toThrow(/duplicate/);
  });
  test("responses that do not match the manifest keys", async () => {
    const { dir, path } = await recorded();
    edit(path("manifest.json"), (m) => ({ ...m, keys: ["0".repeat(64)] }));
    expect(() => replayProvider("set-c", { dir })).toThrow(/manifest/);
  });
  test("a missing set", () => expect(() => replayProvider("nope", { dir: tmp() })).toThrow());
});

test("end to end: record a full mock eval, replay it, same verdicts", async () => {
  const dir = tmp();
  const rec = recordingProvider(mockProvider(), "set-e2e", dir);
  const live = await runEval({ ...meta, provider: rec, versions: ["baseline", "guarded"] });
  rec.finish(["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12"], ["baseline", "guarded"]);
  const rep = replayProvider("set-e2e", { dir });
  const replayed = await runEval({ ...meta, provider: rep, versions: ["baseline", "guarded"] });
  expect(replayed.conversations.map((c) => c.scenarioChecks)).toEqual(live.conversations.map((c) => c.scenarioChecks));
  expect(replayed.sourceMode).toBe("replay");
  expect(gate(replayed).ok).toBe(true);
});

describe("review round 1 regressions", () => {
  test("the set directory is created exclusively", () => {
    const dir = tmp();
    mkdirSync(join(dir, "set-x"), { recursive: true });
    expect(() => recordingProvider(mockProvider(), "set-x", dir)).toThrow(/exists/);
  });
  test("a finished recorder is sealed", async () => {
    const dir = tmp();
    const rec = recordingProvider(mockProvider(), "set-s", dir);
    await rec.complete(req());
    rec.finish(["S01"], ["guarded"]);
    await expect(rec.complete(req("later"))).rejects.toThrow(/sealed|finished/);
    expect(() => replayProvider("set-s", { dir })).not.toThrow();
  });
  test("finish rejects declared coverage that the recordings do not match", async () => {
    const dir = tmp();
    const rec = recordingProvider(mockProvider(), "set-cov", dir);
    await rec.complete(req());
    expect(() => rec.finish([], [])).toThrow(/coverage/);
    expect(() => rec.finish(["S01", "S02"], ["guarded"])).toThrow(/S02/);
  });
  test("replay rejects a manifest with no declared scenarios", async () => {
    const dir = tmp();
    const rec = recordingProvider(mockProvider(), "set-empty", dir);
    await rec.complete(req());
    rec.finish(["S01"], ["guarded"]);
    const p = join(dir, "set-empty", "manifest.json");
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), scenarios: [], versions: [] }));
    expect(() => replayProvider("set-empty", { dir })).toThrow(/coverage/);
  });
  test("replay rejects duplicate manifest keys", async () => {
    const dir = tmp();
    const rec = recordingProvider(mockProvider(), "set-dk", dir);
    await rec.complete(req());
    rec.finish(["S01"], ["guarded"]);
    const p = join(dir, "set-dk", "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    writeFileSync(p, JSON.stringify({ ...m, keys: [...m.keys, ...m.keys] }));
    expect(() => replayProvider("set-dk", { dir })).toThrow(/duplicate/);
  });
});

test("replay reports what the recording holds, and eval runs carry it as provenance", async () => {
  const dir = tmp();
  const rec = recordingProvider(mockProvider(), "set-stats", dir);
  await rec.complete(req());
  await rec.complete(req("Other prompt"));
  rec.finish(["S01"], ["guarded"]);
  const rep = replayProvider("set-stats", { dir });
  expect(rep.recordingStats).toEqual({ calls: 2, tokens: 0, model: "mock-agent-v1" });
  const a = await runEval({ ...meta, provider: { ...rep, complete: async () => ({ text: '{"message":"x","action":"stop"}' }) }, versions: ["guarded"], limit: 1 });
  expect(a.metadata.recording).toEqual({ calls: 2, tokens: 0, model: "mock-agent-v1" });
});
