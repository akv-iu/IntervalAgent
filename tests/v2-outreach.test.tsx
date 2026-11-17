import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import snapshot from "../fixtures/v2/outreach-policy-v1.json";
import { Artifact } from "../src/lib/artifact";
import { runPicker } from "../src/lib/picker";
import { OUTREACH_GROUPS, OutreachPolicy, outreachPreview } from "../src/lib/v2/outreach";
import { startingCases } from "../src/lib/v2/fixtures";
import type { CaseState } from "../src/lib/v2/store";
import OutreachStrategy from "../src/components/v2/OutreachStrategy";

const facts = startingCases(new Date("2026-10-24T18:00:00Z"));
const c = { facts: facts[0], stopped: false, takeover: false, reviewHold: false, preferredChannel: null } as CaseState;

test("the compact frozen policy reproduces the preserved V1 algorithm and original seeds", () => {
  const policy = OutreachPolicy.parse(snapshot);
  const original = runPicker({ runId: policy.sourceRunId, createdAt: policy.sourceCreatedAt, trainSeed: policy.trainSeed, testSeed: policy.testSeed, exploreSeed: policy.exploreSeed });
  expect(Artifact.safeParse(original).success).toBe(true);
  expect(policy.selected).toEqual(original.selected); expect(policy.counts).toEqual(original.counts); expect(policy.sourceMode).toBe(original.sourceMode);
  expect(policy.sendHours).toEqual(original.metadata.sendHours); expect(policy.environmentVersion).toBe(original.metadata.environmentVersion);
  expect(policy.reward).toBe(original.reward); expect(policy.epsilon).toBe(original.metadata.epsilon);
  expect([policy.schemaVersion, policy.scenarioVersion]).toEqual([original.schemaVersion, original.scenarioVersion]);
  expect(original.trials.filter((t) => t.phase === "train")).toHaveLength(2000);
  expect(new Set(original.trials.filter((t) => t.phase === "test").map((t) => t.caseId)).size).toBe(800);
  expect(JSON.stringify(snapshot).length).toBeLessThan(2500);
});

test.each(OUTREACH_GROUPS)("%s preview uses the frozen arm and local hour without changing case state", (group) => {
  const state = structuredClone(c), before = JSON.stringify(state), choice = outreachPreview(group, state);
  expect(choice.status).toBe("preview");
  if (choice.status !== "preview") throw new Error("Expected frozen preview");
  expect(choice.arm).toEqual(snapshot.selected[group]); expect(choice.hour).toBe(snapshot.sendHours[choice.arm.window]);
  expect(JSON.stringify(state)).toBe(before);
});

test.each(["", "0-30", "121-150", "__proto__"])("%s has no implicit age group or default outreach choice", (value) => {
  const preview = outreachPreview(value, c);
  expect(preview.status).toBe("unselected"); expect(preview).not.toHaveProperty("arm");
});

test("a preview preserves STOP, paused control, missing destination and a conflicting contact preference", () => {
  const state = { ...c, stopped: true, takeover: true, preferredChannel: "email" as const, facts: { ...c.facts, phone: null } };
  const preview = outreachPreview("1-30", state);
  if (preview.status !== "preview") throw new Error("Expected frozen preview");
  expect(preview.warnings.join(" ")).toContain("Contact is stopped"); expect(preview.warnings.join(" ")).toContain("paused");
  expect(preview.warnings.join(" ")).toContain("email preference"); expect(preview.warnings.join(" ")).toContain("No phone number");
  expect(state.stopped).toBe(true); expect(state.preferredChannel).toBe("email");
});

test("the shared benchmark is not described as a business-specific lesson or retrained policy", () => {
  const northside = outreachPreview("31-60", c), cedar = outreachPreview("31-60", { ...c, facts: facts[6] });
  expect(northside).toEqual(cedar);
  const html = renderToStaticMarkup(<OutreachStrategy c={{ ...c, facts: facts[6] }} />);
  for (const text of ["V1 policy preview", "Overdue age is not included", "does not set the customer", "Overdue age for this preview", "Not trained for this business", "No model call or retraining", "Policy provenance", "picker-20261016-011624-901", "500 training cases", "200 paired synthetic test", "Source SHA-256"]) expect(html).toContain(text);
  expect(html).toContain('href="/picker"'); expect(html).toContain('value="" selected=""'); expect(html).not.toContain("Cedar learned");
});

test.each(["missing-arm", "unknown-channel", "unknown-version", "non-synthetic", "extra-field"])("%s cannot masquerade as a valid frozen policy", (kind) => {
  const value = structuredClone(snapshot) as unknown as Record<string, unknown>;
  if (kind === "missing-arm") delete (value.selected as Record<string, unknown>)["1-30"];
  if (kind === "unknown-channel") Object.assign((value.selected as Record<string, unknown>)["1-30"]!, { channel: "call" });
  if (kind === "unknown-version") value.version = "new";
  if (kind === "non-synthetic") value.sourceMode = "live";
  if (kind === "extra-field") value.apiKey = "not-allowed";
  expect(OutreachPolicy.safeParse(value).success).toBe(false);
});

test("the interactive panel has no action API or training path, is keyed by case, and retains current approval wording", () => {
  const panel = readFileSync("src/components/v2/OutreachStrategy.tsx", "utf8"), library = readFileSync("src/lib/v2/outreach.ts", "utf8"), workspace = readFileSync("src/components/v2/InvestigationWorkspace.tsx", "utf8");
  expect(panel).toContain("setGroup(event.target.value)"); expect(panel).toContain('aria-live="polite"');
  const runtimeImports = `${panel}\n${library}`.split("\n").filter((line) => !line.startsWith("import type ")).join("\n");
  expect(runtimeImports).not.toMatch(/fetch\(|runPicker|from ["'].*(?:store|model|picker)["'];/);
  expect(workspace).toContain('key={`outreach-${caseId}`}'); expect(workspace).not.toContain("Operator payment approval is not available in this checkpoint");
});
