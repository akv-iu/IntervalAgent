// Record live responses into one immutable set; replay from exactly one set. Fails closed:
// no fuzzy matching, no searching other sets, no falling back to a live call.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseAgentOutput } from "../agent/output";
import { CONTRACT_VERSION, SCENARIO_VERSION, SCHEMA_VERSION, slug } from "../artifact";
import { EVAL_SEED_BASE } from "../sim/scenarios";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

export const RECORDINGS_DIR = join("fixtures", "recordings");

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function requestKey(i: { model: string; params: Record<string, number>; contractVersion: number; req: LlmRequest }): string {
  const { system, messages, context } = i.req;
  const payload = stable({ model: i.model, params: i.params, contractVersion: i.contractVersion, system, messages, context });
  return createHash("sha256").update(payload).digest("hex");
}

export const Manifest = z.object({
  schemaVersion: z.number().int(),
  scenarioVersion: z.number().int(),
  contractVersion: z.number().int(),
  sourceMode: z.enum(["live", "mock"]),
  model: z.string(),
  params: z.record(z.string(), z.number()),
  seed: z.number().int(),
  scenarios: z.array(z.string()),
  versions: z.array(z.string()),
  keys: z.array(z.string()),
  complete: z.boolean(),
});
export type Manifest = z.infer<typeof Manifest>;

const Entry = z.object({
  key: z.string(),
  subject: z.string(),
  version: z.string(),
  turn: z.number().int(),
  attempt: z.number().int(),
  text: z.string(),
  valid: z.boolean(),
  usage: z.object({ input: z.number(), output: z.number() }).optional(),
});
type Entry = z.infer<typeof Entry>;

// Declared scenarios and versions must match what was actually recorded, both ways.
function checkCoverage(setId: string, scenarios: string[], versions: string[], entries: { subject: string; version: string }[]) {
  if (!scenarios.length || !versions.length) throw new Error(`recording set ${setId}: coverage declares no scenarios or versions`);
  for (const s of scenarios) {
    for (const v of versions) {
      if (!entries.some((e) => e.subject === s && e.version === v)) throw new Error(`recording set ${setId}: coverage has no responses for ${s} ${v}`);
    }
  }
  const stray = entries.find((e) => !scenarios.includes(e.subject) || !versions.includes(e.version));
  if (stray) throw new Error(`recording set ${setId}: coverage does not include recorded ${stray.subject} ${stray.version}`);
}

export function recordingProvider(inner: LlmProvider, setId: string, dir = RECORDINGS_DIR): LlmProvider & { finish(scenarios: string[], versions: string[]): void } {
  slug.parse(setId);
  const setDir = join(dir, setId);
  mkdirSync(dir, { recursive: true });
  try {
    mkdirSync(setDir); // exclusive: fails if another run already created this set
  } catch {
    throw new Error(`recording set ${setId} already exists; sets are never overwritten`);
  }
  const entries: Entry[] = [];
  let sealed = false;
  const sourceMode = inner.name === "openai" ? "live" : "mock";

  const write = (complete: boolean, scenarios: string[] = [], versions: string[] = []) => {
    const manifest: Manifest = {
      schemaVersion: SCHEMA_VERSION,
      scenarioVersion: SCENARIO_VERSION,
      contractVersion: CONTRACT_VERSION,
      sourceMode,
      model: inner.model,
      params: inner.params,
      seed: EVAL_SEED_BASE,
      scenarios,
      versions,
      keys: entries.map((e) => e.key),
      complete,
    };
    writeFileSync(join(setDir, "responses.json"), JSON.stringify(entries, null, 2) + "\n");
    writeFileSync(join(setDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  };
  write(false); // a crash mid-run leaves an incomplete set that replay refuses

  return {
    name: inner.name,
    model: inner.model,
    params: inner.params,
    recordingSetId: setId,
    originalSourceMode: sourceMode,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      if (sealed) throw new Error(`recording set ${setId} is finished and sealed`);
      const key = requestKey({ model: inner.model, params: inner.params, contractVersion: CONTRACT_VERSION, req });
      if (entries.some((e) => e.key === key)) throw new Error(`duplicate request while recording: ${req.context.subject} turn ${req.context.turn}`);
      const res = await inner.complete(req);
      const { subject, version, turn, attempt } = req.context;
      entries.push({ key, subject, version, turn, attempt, text: res.text, valid: parseAgentOutput(res.text) !== null, ...(res.usage ? { usage: res.usage } : {}) });
      write(false);
      return res;
    },
    finish(scenarios: string[], versions: string[]) {
      checkCoverage(setId, scenarios, versions, entries);
      write(true, scenarios, versions);
      sealed = true;
    },
  };
}

export function replayProvider(setId: string, opts: { requireLive?: boolean; dir?: string } = {}): LlmProvider & { manifest: Manifest } {
  slug.parse(setId);
  const setDir = join(opts.dir ?? RECORDINGS_DIR, setId);
  const read = (f: string) => {
    const p = join(setDir, f);
    if (!existsSync(p)) throw new Error(`recording set ${setId}: ${f} not found`);
    return JSON.parse(readFileSync(p, "utf8")) as unknown;
  };
  const manifest = Manifest.parse(read("manifest.json"));
  if (!manifest.complete) throw new Error(`recording set ${setId} is incomplete`);
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.scenarioVersion !== SCENARIO_VERSION || manifest.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`recording set ${setId} has incompatible versions`);
  }
  if (opts.requireLive && manifest.sourceMode !== "live") throw new Error(`recording set ${setId} is ${manifest.sourceMode}-origin; a live-origin set is required`);

  const entries = z.array(Entry).parse(read("responses.json"));
  const byKey = new Map<string, Entry>();
  for (const e of entries) {
    if (byKey.has(e.key)) throw new Error(`recording set ${setId} has duplicate key ${e.key.slice(0, 12)}`);
    byKey.set(e.key, e);
  }
  checkCoverage(setId, manifest.scenarios, manifest.versions, entries);
  const keys = new Set(manifest.keys);
  if (keys.size !== manifest.keys.length) throw new Error(`recording set ${setId} has duplicate manifest keys`);
  if (keys.size !== byKey.size || [...byKey.keys()].some((k) => !keys.has(k))) {
    throw new Error(`recording set ${setId}: responses do not match the manifest keys`);
  }

  return {
    name: "replay",
    model: manifest.model,
    params: manifest.params,
    manifest,
    recordingSetId: setId,
    originalSourceMode: manifest.sourceMode,
    async complete(req: LlmRequest) {
      const key = requestKey({ model: manifest.model, params: manifest.params, contractVersion: manifest.contractVersion, req });
      const e = byKey.get(key);
      if (!e) {
        const c = req.context;
        throw new Error(`missing recording for ${c.subject} ${c.version} turn ${c.turn} attempt ${c.attempt} in set ${setId}`);
      }
      return { text: e.text, ...(e.usage ? { usage: e.usage } : {}) };
    },
  };
}
