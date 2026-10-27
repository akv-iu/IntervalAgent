import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateCurrentClaim } from "../src/lib/v2/claim";
import { validateUpdates, type Investigation, type InvestigationResult } from "../src/lib/v2/contracts";
import type { ModelCall } from "../src/lib/v2/model";

const directory = "fixtures/v2/reconciliation-20261026-1";
type Report = { revision: string; roleVersion: string; rows: { id: string; input: Investigation; result?: InvestigationResult; checks: string[]; error?: { kind: string }; calls: { id: string; result: ModelCall | null }[] }[] };
const read = (name: string) => readFileSync(`${directory}/${name}.json`, "utf8");
const report = (name: string): Report => JSON.parse(read(name));

test("reconciliation evidence retains its exact captured versions, failures and fixture hashes", () => {
  const manifest = JSON.parse(read("manifest"));
  for (const [name, hash] of Object.entries(manifest.files)) expect(createHash("sha256").update(readFileSync(`${directory}/${name}`)).digest("hex")).toBe(hash);
  expect(report("initial").rows[0].checks).toContain("Review blocked");
  expect(report("validated-reuse").roleVersion).toBe("v2-reconciliation-4");
  expect(report("validated-reuse").revision.startsWith(manifest.runtimeRevision)).toBe(true);
});

test("saved live agreement and recognition independently satisfy current provenance and money guards", () => {
  const [agreement, receipt, incomplete] = report("validated-reuse").rows;
  for (const row of [agreement, receipt]) { expect(row.checks).toEqual([]); expect(row.result!.review.accepted).toBe(true); expect(row.result!.draft.needsOperator).toBe(false); }
  expect(validateCurrentClaim(agreement.result!.paymentClaim, agreement.input)).toMatchObject({ amount: { value: 4000 }, date: { value: null }, reportResponse: { stance: "agrees" } });
  const input = { ...receipt.input, paymentClaim: receipt.result!.paymentClaim, verification: receipt.result!.verification };
  const updates = validateUpdates(receipt.result!.resolution!.updates, input);
  expect(updates).toHaveLength(1); expect(updates[0]).toMatchObject({ kind: "payment_recognized", amountCents: 4000 });
  expect(input.facts.balanceCents - 4000).toBe(3900);
  expect(() => validateUpdates(updates, { ...input, facts: { ...input.facts, payments: [...input.facts.payments, { id: "already-recorded", invoiceId: "INV-102", amountCents: 4000, date: "2026-10-26", status: "settled", includedInBalance: true }] } })).toThrow("already be included");
  expect(agreement.calls).toHaveLength(13); expect(receipt.calls).toHaveLength(6);
  expect(incomplete.error?.kind).toBe("test_budget"); expect(incomplete.result).toBeUndefined();
});

test("all live attempts, including the interrupted save, remain within the closed separate $1 allowance", () => {
  const calls = ["initial", "linked-report-retest", "diagnostic", "repair-feedback-interrupted-snapshot", "validated-reuse"].flatMap((name) => report(name).rows.flatMap((row) => row.calls));
  expect(new Set(calls.map((call) => call.id)).size).toBe(50);
  expect(calls.filter((call) => !call.result)).toHaveLength(1);
  expect(calls.reduce((sum, call) => sum + (call.result?.inputTokens ?? 0), 0)).toBe(220465);
  expect(calls.reduce((sum, call) => sum + (call.result?.outputTokens ?? 0), 0)).toBe(12564);
  expect(JSON.parse(read("budget"))).toEqual({ capCents: 100, reservedCents: 100, calls: 50 });
});
