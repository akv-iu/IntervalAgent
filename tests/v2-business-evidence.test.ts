import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const directory = "fixtures/v2/business-confirmation-20261026-1";
const read = (file: string) => JSON.parse(readFileSync(`${directory}/${file}.json`, "utf8"));

test("business-confirmation captures preserve failed acceptance instead of reporting plumbing checks as live success", () => {
  const manifest = read("manifest");
  expect(manifest.liveAcceptance).toBe("failed");
  for (const [name, hash] of Object.entries(manifest.files)) expect(createHash("sha256").update(readFileSync(`${directory}/${name}`)).digest("hex")).toBe(hash);
  const rows = read("initial").rows;
  expect(rows.map((r: { id: string }) => r.id)).toEqual(["business-paid-80-today", "jordan-saved-history", "unknown-date", "pending"]);
  expect(rows[0].failures).toContain("Expected one correct recognition/replacement");
  expect(rows[1].failures).toContain("Review blocked");
  expect(rows[2].failures).toEqual([]); expect(rows[3].failures).toEqual([]);
  expect(rows.some((r: { id: string }) => r.id === "business-corrects-80-to-50")).toBe(false);
});

test("the new $1 reservation allowance includes every failed and incomplete live attempt", () => {
  const calls = [read("initial"), read("partial-policy-retest")].flatMap((report) => report.rows.flatMap((r: { calls: { id: string; result: { inputTokens: number; outputTokens: number; usageKnown: boolean } }[] }) => r.calls));
  expect(new Set(calls.map((c) => c.id)).size).toBe(50);
  expect(calls.every((c) => c.result.usageKnown)).toBe(true);
  expect(calls.reduce((sum, c) => sum + c.result.inputTokens, 0)).toBe(166775);
  expect(calls.reduce((sum, c) => sum + c.result.outputTokens, 0)).toBe(4821);
  expect(read("budget")).toEqual({ capCents: 100, reservedCents: 100, calls: 50 });
  const retest = read("partial-policy-retest").rows[0];
  expect(retest.result).toBeUndefined(); expect(retest.error.kind).toBe("test_budget");
});
