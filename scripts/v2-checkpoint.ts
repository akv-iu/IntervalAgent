import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Runner } from "@openai/agents";
import { buildAgents, investigate, ROLE_VERSION } from "../src/lib/v2/agents";
import { startingCases } from "../src/lib/v2/fixtures";
import { boundedModel, MODEL, RESERVATION_CENTS, type ModelCall } from "../src/lib/v2/model";
import type { Investigation } from "../src/lib/v2/contracts";
import { projectEnv } from "../src/lib/project-env";
import { closeV2Pool, recordLive, reserveLive } from "../src/lib/v2/store";

const directory = "results/v2-phase1";
const ledgerPath = `${directory}/spend.json`;
const lock = `${ledgerPath}.lock`;

function reserve() {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const handle = openSync(lock, "wx");
  try {
    const ledger: { reservedCents: number } = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { reservedCents: 0 };
    if (!Number.isSafeInteger(ledger.reservedCents) || ledger.reservedCents < 0 || !Number.isSafeInteger(ledger.reservedCents + RESERVATION_CENTS)) throw new Error("Invalid checkpoint usage ledger");
    ledger.reservedCents += RESERVATION_CENTS;
    writeFileSync(`${ledgerPath}.tmp`, JSON.stringify(ledger));
    renameSync(`${ledgerPath}.tmp`, ledgerPath);
  } finally { closeSync(handle); unlinkSync(lock); }
}

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Real API calls require --live; this checkpoint has no mock fallback");
  const env = projectEnv(".env.v2");
  if (existsSync(`${directory}/db-budget-required`) && !env.V2_DATABASE_URL) throw new Error("Phase 1 budget requires the configured V2 database");
  const reserveCall = async (id: string) => { if (env.V2_DATABASE_URL) await reserveLive(id); else reserve(); };
  const recordCall = async (call: ModelCall, calls: ModelCall[]) => { calls.push(call); if (env.V2_DATABASE_URL) await recordLive(call); };
  const apiKey = env.V2_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set V2_OPENAI_API_KEY in ignored .env.v2 locally; never paste it into chat");
  const now = new Date().toISOString();
  const fixtures = startingCases(new Date(now));
  const message = (text: string, id = "customer-1") => ({ id, text, channel: "customer" as const, speaker: "customer" as const, at: now });
  const late: Investigation = { facts: fixtures[0], messages: [message("I paid $129 today by debit card for INV-101. Can you check?")], now, verification: null };
  const pendingVerification = { claimMessageId: "customer-1", outcome: "awaiting_business" as const, businessMessage: "Please confirm the payment facts.", summary: "Waiting for the business", amountCents: null, paymentDate: null, invoiceId: null, reference: null, settlementStatus: "unknown" as const, missingFacts: ["amount", "date", "invoice", "status"] };
  const reported = { ...pendingVerification, outcome: "business_reported" as const, amountCents: 5000, invoiceId: "INV-101", businessMessage: null, missingFacts: ["date", "settlement"] };
  const reportMessages = [...late.messages,
    { ...message("For INV-101, was the $129 payment received and settled today?", "request-1"), channel: "business" as const, speaker: "agent" as const, requestId: "test-request" },
    { ...message("No he has paid 50 dollars", "business-1"), channel: "business" as const, speaker: "business" as const, requestId: "test-request" },
    { ...message("Was the $50 received and settled today for INV-101?", "followup-1"), channel: "business" as const, speaker: "agent" as const, requestId: "test-request" },
    { ...message("No I have proper evidence He has only paid 50 dollars", "business-2"), channel: "business" as const, speaker: "business" as const, requestId: "test-request" },
  ];
  // Declare expectations before generating any responses; none are sent to the model.
  const samples = [
    { id: "business-report-assertion", input: { ...late, verification: { ...pendingVerification, outcome: "needs_facts" as const, amountCents: 5000, invoiceId: "INV-101" }, requestId: "test-request", messages: reportMessages }, expected: "business_reported" },
    { id: "customer-disputes-report", input: { ...late, verification: reported, requestId: "test-request", messages: [...reportMessages, { ...message("Northside Fitness reports $50 paid for INV-101. You can dispute that report here.", "report-reply"), speaker: "agent" as const }, message("I dispute the business report. I paid $129, not $50. Please ask an operator to review.", "customer-2")] }, expected: "operator_review" },
    { id: "invoice-mismatch", input: { ...late, messages: [message("I have paid"), { ...message("Which invoice was the payment for, and what amount and date did you pay?", "reply-1"), speaker: "agent" as const }, message("Inv01 and I have paid 129 dollars , today", "customer-2")] }, expected: "invoice_clarification" },
    { id: "invoice-corrected", input: { ...late, messages: [message("I have paid"), message("Inv01 and I have paid 129 dollars , today", "customer-2"), { ...message("Please confirm the invoice number; this account shows INV-101.", "reply-2"), speaker: "agent" as const }, message("Sorry, I meant INV-101.", "customer-3")] }, expected: "awaiting_business" },
    { id: "unknown-invoice", input: { ...late, messages: [message("I paid $129 today for invoice INV-999. Please check.")] }, expected: "invoice_clarification" },
    { id: "invoice-follow-up", input: { ...late, messages: [message("I paid $129 today by debit card. Can you check?", "3240ae74-0344-4123-a241-63d72c9d3c0a"), message("My invoice number is INV-101.", "7240ae74-0344-4123-a241-63d72c9d3c0b")] }, expected: "awaiting_business" },
    { id: "business-not-found", input: { ...late, verification: pendingVerification, requestId: "test-request", messages: [...late.messages, { ...message("We checked INV-101 and found no matching payment in our business records.", "business-1"), requestId: "test-request", channel: "business" as const, speaker: "business" as const }] }, expected: "not_found" },
    { id: "late-payment", input: late, expected: "awaiting_business" },
    { id: "bare-business-yes", input: { ...late, verification: pendingVerification, requestId: "test-request", messages: [...late.messages, { ...message("Yes", "business-1"), requestId: "test-request", channel: "business" as const, speaker: "business" as const }] }, expected: "needs_facts" },
    { id: "mismatched-invoice", input: { ...late, verification: pendingVerification, requestId: "test-request", messages: [...late.messages, { ...message(`We received $129 on ${now.slice(0, 10)}, settled, reference TEST-9, for invoice INV-OTHER.`, "business-1"), requestId: "test-request", channel: "business" as const, speaker: "business" as const }] }, expected: "conflicting" },
    { id: "fresh-record", input: { ...late, facts: fixtures[1], messages: [message("Did my $50 payment reach invoice INV-102?")] }, expected: "direct_read" },
    { id: "promise-and-call", input: { ...late, messages: [message("I promise to pay $50 tomorrow. Please call me tomorrow afternoon.")] }, expected: "case_updates" },
    { id: "channel-only", input: { ...late, messages: [message("Don't call me. Please email me instead. I have not chosen a day or time yet.")] }, expected: "preference_only" },
    { id: "dated-email", input: { ...late, messages: [message("Please email me tomorrow afternoon at the email address on my account.")] }, expected: "planned_email" },
  ];
  const report: { id: string; passed: boolean; result: unknown; calls: ModelCall[] }[] = [];
  for (const sample of samples) {
    const selected = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
    if (selected && !selected.split(",").includes(sample.id)) continue;
    const calls: ModelCall[] = [];
    const model = boundedModel({ apiKey, reserve: reserveCall, record: async (call) => { await recordCall(call, calls); console.log(sample.id, `call=${calls.length}`, call.tools.join(",") || "response"); } });
    const result = await investigate(sample.input, model, AbortSignal.timeout(90_000));
    const expected = sample.expected === "direct_read" ? !calls.some((call) => call.tools.includes("business_verification")) && result.resolution === null
      : sample.expected === "invoice_clarification" ? result.verification === null && !result.activity.some((a) => a.role === "business_verification" && a.action === "delegated") && /confirm|check|provide|share|which|correct|clarify/i.test(result.draft.reply) && /invoice|INV-101/i.test(result.draft.reply) && !/verification failed|check failed|business (?:said|confirmed|reported)/i.test(`${result.draft.reply} ${result.resolution?.summary ?? ""}`)
      : sample.expected === "business_reported" ? result.verification?.outcome === "business_reported" && result.verification.amountCents === 5000 && result.verification.businessMessage === null && !result.draft.needsOperator && !result.resolution?.needsOperator && !result.resolution?.updates.some((u) => u.kind === "payment_recognized") && /50/.test(result.draft.reply) && /disput/i.test(result.draft.reply) && !/clarify with|contact (?:the business|Northside)|settle|payment date/i.test(result.draft.reply)
      : sample.expected === "operator_review" ? result.draft.needsOperator && !result.activity.some((a) => a.role === "business_verification" && a.action === "delegated") && !result.resolution?.updates.some((u) => u.kind === "payment_recognized")
      : sample.expected === "case_updates" ? result.resolution?.updates.some((u) => u.kind === "promise" && u.amountCents === 5000) && result.resolution?.updates.some((u) => u.kind === "contact_requested" && u.window === "afternoon")
      : sample.expected === "preference_only" ? result.resolution?.updates.some((u) => u.kind === "contact_preference" && u.channel === "email") && !result.resolution.updates.some((u) => u.kind === "contact_requested")
      : sample.expected === "planned_email" ? result.resolution?.updates.some((u) => u.kind === "contact_requested" && u.channel === "email" && u.window === "afternoon")
      : result.verification?.outcome === sample.expected;
    report.push({ id: sample.id, passed: Boolean(expected && result.review.accepted), result, calls });
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/checkpoint.json`, JSON.stringify({ model: MODEL, roleVersion: ROLE_VERSION, now, provenance: "live model / synthetic tools", samples: report }, null, 2));
    console.log(sample.id, report.at(-1)!.passed ? "PASS" : "FAIL", `calls=${calls.length}`);
  }
  const calls: ModelCall[] = [];
  const model = boundedModel({ apiKey, reserve: reserveCall, record: (call) => recordCall(call, calls) });
  const agents = buildAgents(late, model);
  const challenged = await new Runner(agents.runConfig).run(agents.reviewer, JSON.stringify({ input: late, draft: { reply: "Your $129 payment is bank verified and your balance is now zero.", needsOperator: false }, verification: null, resolution: null }), { maxTurns: 1, signal: AbortSignal.timeout(30_000) });
  report.push({ id: "unsupported-confirmation-blocked", passed: challenged.finalOutput?.accepted === false, result: challenged.finalOutput, calls });
  writeFileSync(`${directory}/checkpoint.json`, JSON.stringify({ model: MODEL, roleVersion: ROLE_VERSION, now, provenance: "live model / synthetic tools", samples: report }, null, 2));
  console.log("unsupported-confirmation-blocked", report.at(-1)!.passed ? "PASS" : "FAIL");
  console.log("Historical checkpoint reservation:", readFileSync(ledgerPath, "utf8"));
  if (report.some((sample) => !sample.passed)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const e = error as { name?: string; message?: string; status?: number };
  const local = e.message && /^(Agent |Phase 1 |Checkpoint |Set V2_|Real API)/.test(e.message) ? e.message : undefined;
  console.error("Checkpoint stopped; no mock fallback.", { kind: e.name, status: e.status, local });
  process.exitCode = 1;
}).finally(closeV2Pool);
