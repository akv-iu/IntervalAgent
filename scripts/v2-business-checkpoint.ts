import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import type { Model } from "@openai/agents";
import raw from "../fixtures/v2/business-confirmation-20261026-1/jordan.json";
import { investigate, ROLE_VERSION } from "../src/lib/v2/agents";
import { recognitionBalance, validateUpdates, type Investigation, type InvestigationResult } from "../src/lib/v2/contracts";
import { boundedModel, MODEL, type ModelCall } from "../src/lib/v2/model";
import { describeFailure } from "../src/lib/v2/failures";
import { projectEnv } from "../src/lib/project-env";
import { reserveTestCall } from "./v2-test-budget";

const directory = "results/v2-business-confirmation-20261026-1";
type Row = { id: string; expected: string; input: Investigation; calls: { id: string; result: ModelCall | null }[]; trace: { role: unknown; bytes: number; input: unknown; output: unknown }[]; elapsedMs: number; result?: InvestigationResult; failures: string[]; error?: ReturnType<typeof describeFailure> };

async function main() {
  const args = process.argv.slice(2), run = args.find((a) => /^--run=[a-z0-9-]{1,30}$/.test(a))?.slice(6);
  if (!args.includes("--live")) { console.log("Prepared: paid-today, corrected receipt, saved Jordan history, unknown date, pending. No API calls."); return; }
  if (args.length !== 2 || !run) throw new Error("Use --live --run=unique-name");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  if (git("diff", "--name-only", "HEAD", "--", "src")) throw new Error("Commit runtime before live testing");
  const key = projectEnv(".env.v2").V2_OPENAI_API_KEY;
  if (!key) throw new Error("Missing configured V2 API key");
  mkdirSync(directory, { recursive: true });
  const path = `${directory}/${run}.json`; closeSync(openSync(path, "wx"));
  const report = { version: "business-confirmation-20261026-1", at: new Date().toISOString(), revision: git("rev-parse", "HEAD"), roleVersion: ROLE_VERSION, model: MODEL, budgetPath: `${directory}/budget.json`, rows: [] as Row[] };
  const save = () => { writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2)); try { renameSync(`${path}.tmp`, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; copyFileSync(`${path}.tmp`, path); } };
  async function evaluate(id: string, input: Investigation, expected: string, check: (r: InvestigationResult) => string[]) {
    const row: Row = { id, input, expected, calls: [], trace: [], elapsedMs: 0, failures: [] }; report.rows.push(row); save(); const start = Date.now(), signal = AbortSignal.timeout(90_000);
    const transport = boundedModel({ apiKey: key!, signal, reserve: async (id) => { reserveTestCall(report.budgetPath, 100); row.calls.push({ id, result: null }); save(); }, record: async (call) => { row.calls.find((c) => c.id === call.id)!.result = call; save(); } });
    const model: Model = { async getResponse(request) { const response = await transport.getResponse(request); row.trace.push({ role: request.modelSettings.providerData?.metadata?.agent_role, bytes: Buffer.byteLength(JSON.stringify(request), "utf8"), input: request.input, output: response.output }); save(); return response; }, async *getStreamedResponse() { throw new Error("unused"); } };
    try { row.result = await investigate(structuredClone(input), model, signal); row.failures = check(row.result); }
    catch (error) { row.error = error instanceof Error && error.message.startsWith("Approved $1 test budget") ? { kind: "test_budget", message: "New $1 reservation cap reached; stopped before another API call" } : describeFailure(error); row.failures = ["Incomplete"]; }
    row.elapsedMs = Date.now() - start; save(); console.log(id, row.failures.length ? "FAIL" : "STRUCTURED PASS", row.calls.length, "calls", row.elapsedMs, "ms");
    if (row.error) throw new Error("Stopped; inspect retained evidence before further testing");
    return row.result!;
  }
  const base = structuredClone(raw) as Investigation;
  const first: Investigation = { ...structuredClone(base), messages: base.messages.slice(0, 5), now: base.messages[4].at };
  const original = first.messages[1];
  first.paymentClaim = { businessId: first.facts.businessId, caseId: first.facts.id, sourceVersion: first.facts.sourceVersion, intent: "payment_claim", claimMessageId: original.id, throughMessageId: original.id, invoice: { value: "INV-103", evidence: [{ messageId: first.messages[0].id, quote: "INV-103" }, { messageId: original.id, quote: original.text }] }, amount: { value: 12900, evidence: [{ messageId: first.messages[0].id, quote: "$129.00" }, { messageId: original.id, quote: original.text }] }, date: { value: null, evidence: [] }, uncertainties: ["Customer payment date unknown"], reportResponse: null };
  first.verification = { ...base.verification!, outcome: "awaiting_business", amountCents: 12900, paymentDate: null, settlementStatus: "unknown", summary: "Business asked to check receipt", businessMessage: first.messages[2].text, missingFacts: ["date", "receipt"] };
  function recognized(input: Investigation, amountCents: number, correction: boolean, r: InvestigationResult) {
    const failures = !r.review.accepted ? ["Review blocked"] : [];
    const updates = r.resolution?.updates ?? [], update = updates[0];
    if (r.draft.needsOperator || r.resolution?.needsOperator) failures.push("Unnecessary operator hold");
    if (updates.length !== 1 || update?.kind !== "payment_recognized" || update.amountCents !== amountCents || !!update.replacesReceiptId !== correction) failures.push("Expected one correct recognition/replacement");
    try { validateUpdates(updates, { ...input, verification: r.verification, paymentClaim: r.paymentClaim }); } catch { failures.push("Financial authority invalid"); }
    return failures;
  }
  const paid = await evaluate("business-paid-80-today", first, "Business confirms $80 received today: propose 8000 once; $49 remains, no customer agreement/operator", (r) => recognized(first, 8000, false, r));
  if (paid.review.accepted && paid.resolution?.updates[0]?.kind === "payment_recognized") {
    const update = paid.resolution.updates[0], corrected = structuredClone(base);
    corrected.facts.balanceCents = recognitionBalance(first.facts, update); corrected.facts.balanceAsOf = first.now; corrected.facts.sourceVersion += ":evaluated:receipt";
    corrected.facts.payments = [{ id: "evaluated-business-receipt", amountCents: update.amountCents, date: update.date, invoiceId: update.invoiceId, status: "settled", includedInBalance: true, provenance: "business_confirmation", requestId: first.requestId!, businessMessageId: update.businessMessageId, reference: update.reference }];
    corrected.caseUpdates = [update]; corrected.paymentClaim!.sourceVersion = corrected.facts.sourceVersion;
    corrected.messages[5].text = paid.draft.reply;
    await evaluate("business-corrects-80-to-50", corrected, "Same business receipt corrected to $50: replace it, restore $30, $79 remains", (r) => recognized(corrected, 5000, true, r));
  }
  await evaluate("jordan-saved-history", base, "Interpret the complete saved exchange: confirmed $50 receipt, recognize once, $79 remains without operator or context failure", (r) => recognized(base, 5000, false, r));
  for (const [id, text] of [["unknown-date", "Yes, $80 was received for INV-103, but I cannot establish the payment date yet."], ["pending", "An $80 payment for INV-103 is pending today and has not settled or been received yet."]]) {
    const input = structuredClone(first); input.messages.at(-1)!.text = text;
    await evaluate(id, input, "No financial effect; preserve missing date or pending receipt and give a useful response", (r) => [...(!r.review.accepted ? ["Review blocked"] : []), ...(r.resolution?.updates.some((u) => u.kind === "payment_recognized") ? ["Unsupported money update"] : []), ...(id === "unknown-date" && r.verification?.paymentDate !== null ? ["Invented date"] : [])]);
  }
  if (report.rows.some((r) => r.failures.length)) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error instanceof Error && !/sk-/.test(error.message) ? error.message : "Checkpoint stopped"); process.exitCode = 1; });
