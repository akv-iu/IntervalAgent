import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import type { Model } from "@openai/agents";
import { investigate, ROLE_VERSION } from "../src/lib/v2/agents";
import { validateUpdates, type Investigation, type InvestigationResult } from "../src/lib/v2/contracts";
import { boundedModel, MODEL, type ModelCall } from "../src/lib/v2/model";
import { describeFailure } from "../src/lib/v2/failures";
import { projectEnv } from "../src/lib/project-env";
import { reserveTestCall } from "./v2-test-budget";
import { samReconciliation } from "./v2-reconciliation-input";

const directory = "results/v2-reconciliation-20261026-1";
type Row = { id: string; expected: string; input: Investigation; elapsedMs: number; calls: { id: string; role?: string; result: ModelCall | null }[]; trace: { input: unknown; output: unknown }[]; result?: InvestigationResult; checks: string[]; error?: ReturnType<typeof describeFailure> };
async function main() {
  const args = process.argv.slice(2), run = args.find((a) => /^--run=[a-z0-9-]{1,40}$/.test(a))?.slice(6);
  if (!args.includes("--live")) { console.log("Offline preparation: exact Sam agreement, complete new payment, already-included payment, actual dispute. Zero API calls."); return; }
  const from = args.find((a) => /^--from=[a-z0-9-]{1,40}$/.test(a))?.slice(7);
  if (!run || args.length !== (from ? 3 : 2)) throw new Error("Use --live --run=unique-name [--from=completed-agreement]; evidence cannot be overwritten");
  const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
  if (git("diff", "--name-only", "HEAD", "--", "src/lib/v2")) throw new Error("Commit runtime changes before live testing");
  const apiKey = projectEnv(".env.v2").V2_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing configured V2 API key");
  mkdirSync(directory, { recursive: true });
  const path = `${directory}/${run}.json`; closeSync(openSync(path, "wx"));
  const report = { version: "reconciliation-20261026-1", revision: git("rev-parse", "HEAD"), roleVersion: ROLE_VERSION, model: MODEL, at: new Date().toISOString(), from, budget: { capCents: 100, path: `${directory}/budget.json`, reservationCents: 2 }, rows: [] as Row[] };
  const save = () => { writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2)); renameSync(`${path}.tmp`, path); };
  async function evaluate(id: string, input: Investigation, expected: string, check: (r: InvestigationResult) => string[]) {
    const row: Row = { id, input, expected, elapsedMs: 0, calls: [], trace: [], checks: [] }; report.rows.push(row); save();
    const signal = AbortSignal.timeout(90_000), started = Date.now();
    const transport = boundedModel({ apiKey: apiKey!, signal,
      reserve: async (id) => { reserveTestCall(report.budget.path, 100); row.calls.push({ id, result: null }); save(); },
      start: async ({ id, role }) => { row.calls.find((c) => c.id === id)!.role = role; save(); },
      record: async (call) => { row.calls.find((c) => c.id === call.id)!.result = call; save(); },
    });
    const model: Model = { async getResponse(request) { const response = await transport.getResponse(request); row.trace.push({ input: request.input, output: response.output }); save(); return response; }, async *getStreamedResponse() { throw new Error("No streaming in this test"); } };
    try { row.result = await investigate(structuredClone(input), model, signal); row.checks = check(row.result); }
    catch (error) { row.error = error instanceof Error && error.message.startsWith("Approved $1 test budget") ? { kind: "test_budget", message: "Approved reservation cap reached; stopped before another call" } : describeFailure(error); row.checks = ["Run incomplete"]; }
    row.elapsedMs = Date.now() - started; save();
    console.log(id, row.checks.length ? "FAIL" : "STRUCTURED PASS", row.calls.length, "calls", row.elapsedMs, "ms");
    if (row.error) throw new Error("Live run stopped; inspect retained evidence before another invocation");
    return row.result!;
  }
  const accepted = (r: InvestigationResult) => !r.review.accepted ? ["Review blocked"] : [];
  const noMoney = (r: InvestigationResult) => r.resolution?.updates.some((u) => u.kind === "payment_recognized") ? ["Unexpected recognition"] : [];
  const sam = samReconciliation();
  const prior = from ? JSON.parse(readFileSync(`${directory}/${from}.json`, "utf8")) : null;
  if (prior && (prior.roleVersion !== ROLE_VERSION || prior.model !== MODEL || !prior.rows[0]?.result?.review.accepted || prior.rows[0].checks.length)) throw new Error("Resume requires a previously accepted agreement under this role/model version");
  const agreement: InvestigationResult = prior?.rows[0].result ?? await evaluate("sam-agrees", sam, "Refresh claim to 4000/agrees; business follow-up for receipt details; no operator or money yet", (r) => [...accepted(r), ...noMoney(r), ...(r.paymentClaim?.amount.value !== 4000 || r.paymentClaim.reportResponse?.stance !== "agrees" ? ["Stale customer interpretation"] : []), ...(r.verification?.outcome !== "needs_facts" || !r.verification.businessMessage ? ["Missing targeted business follow-up"] : []), ...(r.draft.needsOperator || r.resolution?.needsOperator ? ["Unnecessary operator hold"] : [])]);
  if (!agreement.review.accepted || !agreement.verification?.businessMessage || !agreement.paymentClaim) { process.exitCode = 1; return; }
  const next = (text: string, id: string): Investigation => ({ ...sam, paymentClaim: agreement.paymentClaim, verification: agreement.verification, messages: [...sam.messages, { id: "followup", channel: "business", speaker: "agent", text: agreement.verification!.businessMessage!, requestId: sam.requestId!, at: sam.now }, { id, channel: "business", speaker: "business", text, requestId: sam.requestId!, at: sam.now }] });
  await evaluate("new-settled-payment", next("Yes, this is a new $40 payment received and settled on 2026-10-26 for INV-102. It is additional to the earlier $50 receipt, and is not included in the dated $79 remaining balance. No separate reference is available.", "new-settled"), "Recognize exactly 4000 from the current business confirmation; remaining balance 3900; no operator", (r) => {
    const failures = accepted(r), updates = r.resolution?.updates ?? [];
    if (updates.length !== 1 || updates[0].kind !== "payment_recognized" || updates[0].amountCents !== 4000) failures.push("Expected one $40 recognition");
    if (r.draft.needsOperator || r.resolution?.needsOperator) failures.push("Unnecessary operator hold");
    try { validateUpdates(updates, { ...next("Yes, this is a new $40 payment received and settled on 2026-10-26 for INV-102. It is additional to the earlier $50 receipt, and is not included in the dated $79 remaining balance. No separate reference is available.", "new-settled"), paymentClaim: r.paymentClaim, verification: r.verification }); } catch { failures.push("Financial authority validation failed"); }
    return failures;
  });
  await evaluate("already-included", next("The $40 is part of the older $50 receipt already included in the $79 remaining balance. There is no additional payment after the snapshot; do not subtract it again.", "included"), "Do not recognize already-included money", (r) => [...accepted(r), ...noMoney(r)]);
  const dispute = structuredClone(sam); dispute.messages.at(-1)!.text = "That report is wrong. I paid the full $79 and I dispute the $40 amount.";
  await evaluate("actual-dispute", dispute, "Customer dispute remains distinct from agreement; no financial write", (r) => [...accepted(r), ...noMoney(r), ...(r.paymentClaim?.reportResponse?.stance !== "disputes" ? ["Dispute interpretation lost"] : []), ...(!r.draft.needsOperator && !r.resolution?.needsOperator ? ["Unresolved dispute needs operator"] : [])]);
  console.log("Saved", path, "Read the actual outputs; structured checks do not grade conversational quality.");
  if (report.rows.some((r) => r.checks.length)) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error instanceof Error && !/sk-/.test(error.message) ? error.message : "Live test stopped"); process.exitCode = 1; });
