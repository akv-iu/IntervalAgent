// Evaluation-only filesystem access. Never import this module into src/ or deploy it with the web app.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { slug } from "../../src/lib/artifact";
import { Proposal, ToolName, ToolRequest } from "../../src/lib/v2/contracts";
import { AccountScope, Records, sameAccount } from "../../src/lib/v2/records";
import { createReadTools } from "../../src/lib/v2/tools";

const SET_ID = "billing-20261019-1";
const MANIFEST_SHA256 = "9d5195aec6cf2cb5465fadf8a4aa6030e94e9c477bdf3b596c1704a1860c3414";
const ROOT = fileURLToPath(new URL(`../../fixtures/v2/evaluation/${SET_ID}/`, import.meta.url));
const Split = z.enum(["development", "validation", "holdout"]);
const Category = z.enum(["exact_payment", "ambiguous_payment", "cancelled_charge", "partial_payment", "missing_record", "contradictory_record", "duplicate_request", "tool_failure"]);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const Controls = z.strictObject({
  repeatSubmission: z.boolean(),
  failure: z.strictObject({ tools: z.array(ToolName).min(1).max(5), mode: z.enum(["unavailable", "invalid_data"]) }).optional(),
});
export const Manifest = z.strictObject({
  schemaVersion: z.literal(2), setId: z.literal(SET_ID), createdOn: z.iso.date(),
  cases: z.array(z.strictObject({ caseId: slug, split: Split, familyId: slug, category: Category, inputSha256: sha, oracleSha256: sha, controls: Controls })).min(36),
}).superRefine((m, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(m.cases.map((c) => c.caseId)).size !== m.cases.length) invalid("duplicate case ID");
  if (new Set(m.cases.map((c) => c.inputSha256)).size !== m.cases.length) invalid("duplicate case facts");
  const families = new Map<string, string>();
  for (const c of m.cases) {
    if (families.has(c.familyId) && families.get(c.familyId) !== c.split) invalid("case family crosses splits");
    families.set(c.familyId, c.split);
    if ((c.category === "tool_failure") !== Boolean(c.controls.failure)) invalid("fault controls must match the tool-failure category");
  }
  for (const split of Split.options) {
    const entries = m.cases.filter((c) => c.split === split);
    if (entries.length < 12) invalid(`insufficient ${split} cases`);
    for (const category of Category.options) {
      if (!entries.some((c) => c.category === category)) invalid(`missing ${split}/${category} coverage`);
    }
  }
});

const Input = z.strictObject({
  schemaVersion: z.literal(2), scope: AccountScope, customerMessage: z.string().trim().min(1).max(500), records: Records,
}).refine((i) => i.records.accounts.some((a) => sameAccount(a, i.scope)), "input account is missing");
export const Expected = z.strictObject({
  schemaVersion: z.literal(2), disposition: z.enum(["propose", "clarify", "escalate", "no_change"]),
  actions: z.array(Proposal.shape.actions.element).max(8),
  remainingBalances: z.array(z.strictObject({ invoiceId: slug, balanceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(8),
  requiredEvidence: z.array(z.strictObject({ recordType: z.enum(["account", "invoice", "payment", "allocation", "cancellation", "credit", "policy"]), recordId: slug })).max(24),
  rationale: z.string().min(1).max(500),
}).superRefine((e, ctx) => {
  if ((e.disposition === "propose") !== (e.actions.length > 0)) ctx.addIssue({ code: "custom", message: "only proposals carry financial actions" });
  if (new Set(e.remainingBalances.map((b) => b.invoiceId)).size !== e.remainingBalances.length) ctx.addIssue({ code: "custom", message: "duplicate expected balance" });
  if (e.disposition === "propose") {
    const targets = new Set(e.actions.map((a) => a.invoiceId));
    if (targets.size !== e.remainingBalances.length || e.remainingBalances.some((b) => !targets.has(b.invoiceId))) {
      ctx.addIssue({ code: "custom", message: "expected balances must cover exactly the affected invoices" });
    }
    const has = (type: string, id: string) => e.requiredEvidence.some((r) => r.recordType === type && r.recordId === id);
    if (!e.requiredEvidence.some((r) => r.recordType === "policy") || e.actions.some((a) => !has("invoice", a.invoiceId)
      || (a.type === "allocate_payment" ? !has("payment", a.paymentId) : !has("cancellation", a.cancellationId)))) {
      ctx.addIssue({ code: "custom", message: "financial answers require policy and referenced record evidence" });
    }
  }
});

export function verifyBytes(raw: string, expectedSha256: string): void {
  if (createHash("sha256").update(raw).digest("hex") !== expectedSha256) throw new Error("fixture hash mismatch; frozen sets must not be silently edited");
}
export function loadManifest() {
  const raw = readFileSync(`${ROOT}/manifest.json`, "utf8");
  verifyBytes(raw, MANIFEST_SHA256);
  return Manifest.parse(JSON.parse(raw));
}
function entryFor(id: string) {
  slug.parse(id);
  const entry = loadManifest().cases.find((c) => c.caseId === id);
  if (!entry) throw new Error("unknown fixture case");
  return entry;
}
function readCase(id: string, kind: "inputs" | "oracles", digest: string): string {
  const raw = readFileSync(`${ROOT}/${kind}/${id}.json`, "utf8");
  verifyBytes(raw, digest);
  return raw;
}
export function loadInput(id: string) {
  const entry = entryFor(id);
  return Input.parse(JSON.parse(readCase(entry.caseId, "inputs", entry.inputSha256)));
}
export function loadExpectation(id: string, options: { allowHoldout?: boolean } = {}) {
  const entry = entryFor(id);
  if (entry.split === "holdout" && options.allowHoldout !== true) throw new Error("holdout answers are locked until explicit final evaluation");
  return Expected.parse(JSON.parse(readCase(entry.caseId, "oracles", entry.oracleSha256)));
}
export function checkFixtures() {
  const manifest = loadManifest();
  const counts = { development: 0, validation: 0, holdout: 0 };
  for (const entry of manifest.cases) {
    loadInput(entry.caseId);
    const raw = readCase(entry.caseId, "oracles", entry.oracleSha256);
    if (entry.split !== "holdout") Expected.parse(JSON.parse(raw));
    counts[entry.split]++;
  }
  return { setId: SET_ID, counts, holdoutEvaluated: false as const };
}

// Controls never enter agent input. This wrapper injects service faults into the normal read tools.
export function fixtureTools(id: string) {
  const input = loadInput(id);
  const { controls } = entryFor(id);
  return {
    async execute(context: unknown, rawRequest: unknown) {
      const bound = z.strictObject({ ...AccountScope.shape, role: z.literal("investigator") }).parse(context);
      if (!sameAccount(bound, input.scope)) throw new Error("fixture tool scope mismatch");
      const request = ToolRequest.parse(rawRequest);
      return createReadTools(async () => {
        if (controls.failure?.tools.includes(request.name)) {
          if (controls.failure.mode === "invalid_data") return {};
          throw new Error("fixture service unavailable");
        }
        return input.records;
      }).execute(bound, request);
    },
  };
}
