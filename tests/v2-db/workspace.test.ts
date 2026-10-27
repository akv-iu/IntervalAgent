import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { localDate } from "../../src/lib/time";
import { calculateProposal } from "../../src/lib/v2/options";
import { projectEnv } from "../../src/lib/project-env";
import { beginCommand, budgetUsage, closeV2Pool, commitResult, createWorkspace, failRun, initializeV2, readWorkspace, recordLive, reserveLive, resetWorkspace, startLive, v2Pool, type Job } from "../../src/lib/v2/store";
import { handleV2 } from "../../src/lib/v2/http";
import * as store from "../../src/lib/v2/store";
import { beginLearning, completeLearning, reserveLearningCall } from "../../src/lib/v2/store";
import { EVALUATION_VERSION, activeLessons, type LearningEvaluation, type LearningJob, type ProposedLesson } from "../../src/lib/v2/learning";
import { MODEL } from "../../src/lib/v2/model";
import { boundedModel } from "../../src/lib/v2/model";
import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { investigateFromSource } from "../../src/lib/v2/agents";
import { scriptedClaim } from "../helpers/v2-claim";
import type { PaymentClaim } from "../../src/lib/v2/claim";
import { startingCases } from "../../src/lib/v2/fixtures";
import { syntheticSource } from "../../src/lib/v2/source";
import { ROLE_VERSION, type CaseUpdate, type InvestigationResult, type Verification } from "../../src/lib/v2/contracts";

// All storage/API paths run unchanged; only the connection targets a dedicated test database.
vi.mock("pg", async (importOriginal) => {
  const original = await importOriginal<typeof import("pg")>();
  return { ...original, Pool: class extends original.Pool {
    constructor() {
      const configured = projectEnv(".env.v2").V2_DATABASE_URL;
      if (!configured) throw new Error("V2 DB tests require the isolated local setup");
      const url = new URL(configured);
      if (url.hostname !== "127.0.0.1" || url.port !== "55442") throw new Error("Tests refuse nonlocal connections");
      url.pathname = "/intervalagent_v2_test";
      super({ connectionString: url.toString(), max: 4 });
    }
  } };
});

const command = (action: "customer" | "business" | "retry" | "takeover" | "resume" = "customer", text = "I promise to pay $50 tomorrow") => ({ id: randomUUID(), caseId: "late-payment", action, text });
const approved = (reply = "Your promise was recorded. No payment was received."): InvestigationResult => ({ draft: { reply, needsOperator: false }, verification: null, resolution: null, review: { accepted: true, reasons: [] }, activity: [] });
const verification: Verification = { claimMessageId: "placeholder", outcome: "awaiting_business", businessMessage: "Please confirm payment amount, effective date, invoice and settlement status.", summary: "Awaiting the business", amountCents: null, paymentDate: null, invoiceId: null, reference: null, settlementStatus: "unknown", missingFacts: ["amount", "date", "invoice", "status"] };
const c = async (token: string) => (await readWorkspace(token)).cases["late-payment"];
const requireJob = (job: Job | null): Job => { if (!job) throw new Error("Expected a new job"); return job; };
const requireLearning = (job: LearningJob | null): LearningJob => { if (!job) throw new Error("Expected a learning job"); return job; };

test.each([true, false])("contextual SDK investigation persists reviewed interpretation and only publishes a business request when accepted=%s", async (accepted) => {
  const { token } = await createWorkspace();
  const first = requireJob(await beginCommand(token, command("customer", "I have already made a payment")));
  await commitResult(token, first, approved("Was the payment for INV-101?"));
  const confirmation = requireJob(await beginCommand(token, command("customer", "That's the one")));
  await commitResult(token, confirmation, approved("What amount did you pay?"));
  const job = requireJob(await beginCommand(token, command("customer", "I paid the full amount")));
  const before = await c(token), opening = before.messages[0];
  const paymentClaim: PaymentClaim = { businessId: before.facts.businessId, caseId: before.facts.id, sourceVersion: before.facts.sourceVersion, intent: "payment_claim", claimMessageId: first.id, throughMessageId: job.id,
    invoice: { value: "INV-101", evidence: [{ messageId: `${first.id}-reply`, quote: "Was the payment for INV-101?" }, { messageId: confirmation.id, quote: "That's the one" }] },
    amount: { value: 12900, evidence: [{ messageId: opening.id, quote: "$129.00" }, { messageId: job.id, quote: "I paid the full amount" }] }, date: { value: null, evidence: [] }, uncertainties: ["Payment date is unknown"] };
  const pending: Verification = { ...verification, claimMessageId: first.id, invoiceId: "INV-101", amountCents: 12900, businessMessage: "Could you check the claimed $129 payment for INV-101? The payment date is unknown." };
  let customerCalls = 0;
  const roles: string[] = [];
  const model: Model = { async getResponse(request) {
    const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
    if (role === "reviewer") return scriptedOutput({ accepted, reasons: accepted ? [] : ["Scripted rejection: interpretation needs clarification"] });
    if (role === "business_verification") return scriptedOutput(pending);
    if (++customerCalls === 1) return scriptedTool("business_verification", paymentClaim);
    return scriptedOutput({ reply: "I asked the business to check the claimed payment for INV-101; receipt is not confirmed.", needsOperator: false });
  }, async *getStreamedResponse() { throw new Error("unused"); } };
  await completeScripted(token, job, model);
  await closeV2Pool();
  const saved = await c(token);
  expect(saved.facts).toEqual(before.facts); expect(saved.updates).toEqual([]); expect(saved.turns).toBe(3);
  expect(saved.audit.at(-1)).toMatchObject({ paymentClaim, roleVersion: ROLE_VERSION, review: { accepted } });
  expect(saved.lastReview?.paymentClaim).toEqual(paymentClaim);
  if (accepted) {
    expect(roles).toEqual(["customer", "business_verification", "customer", "reviewer"]);
    expect(saved.paymentClaim).toEqual(paymentClaim); expect(saved.status).toBe("awaiting_business");
    expect(saved.messages.at(-2)).toMatchObject({ channel: "business", speaker: "agent", requestId: saved.requestId, text: pending.businessMessage });
    const reply = requireJob(await beginCommand(token, { ...command("business", "We only received $50"), requestId: saved.requestId! }));
    expect(reply.input.paymentClaim).toEqual(paymentClaim);
  } else {
    expect(saved.status).toBe("needs_review"); expect(saved.requestId).toBeNull(); expect(saved.paymentClaim).toBeNull();
    expect(saved.messages.some((m) => m.channel === "business")).toBe(false);
    const learning = requireLearning(await beginLearning(token, { id: randomUUID(), action: "propose_lesson", caseId: job.caseId, revision: saved.revision, targetAuditId: job.id, targetRole: "customer", scope: "scenario" }));
    expect(learning.candidate.evidence.messages.map((m) => m.id)).toContain(`${first.id}-reply`);
    expect(learning.candidate.evidence.messages.map((m) => m.id)).toContain(opening.id);
  }
});

test("commit refuses forged interpretation even if a scripted Reviewer accepted the business request", async () => {
  const { token } = await createWorkspace(), job = requireJob(await beginCommand(token, command("customer", "I paid INV-101")));
  const before = await c(token), paymentClaim = scriptedClaim(job.input);
  paymentClaim.invoice.evidence[0].quote = "a quotation that was never said";
  await expect(commitResult(token, job, { ...approved(), paymentClaim, verification: { ...verification, claimMessageId: job.id } })).rejects.toThrow("evidence");
  expect(await c(token)).toEqual(before);
});
const lessonProposal: ProposedLesson = { reusable: true, diagnosis: "instructions", focus: "invoice_clarity", rationale: "The owner wants the current invoice identified in financial communication.", instruction: "Name the current invoice in financial replies; never infer payment receipt from a claim." };
async function learningCase(role: "customer" | "reviewer" = "customer") {
  const { token, original } = await correctionCase();
  const correctionId = randomUUID();
  await beginCommand(token, { id: correctionId, caseId: "late-payment", action: "correct", revision: original.revision, targetAuditId: original.audit.at(-1)!.id, targetRole: role, text: "Name the invoice in financial replies, preserving all evidence and financial safety checks." });
  const state = await c(token), value = { id: randomUUID(), action: "propose_lesson" as const, caseId: "late-payment", revision: state.revision, targetAuditId: original.audit.at(-1)!.id, targetRole: role, scope: "scenario" as const, correctionId };
  const job = requireLearning(await beginLearning(token, value));
  return { token, value, job, original: state };
}
function qualifyingReport(job: LearningJob, provenance: "live" | "scripted" = "live"): LearningEvaluation {
  return { version: EVALUATION_VERSION, model: MODEL, provenance, at: new Date().toISOString(), baseCandidateId: job.candidate.baseCandidateId, eligible: true, reason: "A simulated test fixture for the internal state contract", calls: 8,
    rows: ["target", "target", "regression", "safety"].map((category, i) => ({ id: `check-${i}`, category: category as "target" | "regression" | "safety", baselinePassed: i > 0, candidatePassed: true, baselineCalls: 1, candidateCalls: 1, baseline: null, candidate: null })) };
}
async function evaluateFixture(token: string, candidateId: string, provenance: "live" | "scripted" = "live") {
  const state = (await readWorkspace(token)).learning!;
  const job = requireLearning(await beginLearning(token, { id: randomUUID(), action: "evaluate_lesson", candidateId, learningRevision: state.revision }));
  await completeLearning(token, job, qualifyingReport(job, provenance)); return job;
}
async function learningDecision(token: string, candidateId: string, action: "activate_lesson" | "rollback_lesson" | "reject_lesson" = "activate_lesson") {
  return beginLearning(token, { id: randomUUID(), action, candidateId, learningRevision: (await readWorkspace(token)).learning!.revision, note: "Inspected paired outputs and checked target, regression and safety evidence." });
}

test("learning proposal is sourced from saved corrections, isolated and idempotent without financial/chat effects", async () => {
  const { token, value, job, original } = await learningCase();
  expect(await beginLearning(token, value)).toBeNull();
  await completeLearning(token, job, lessonProposal); await closeV2Pool();
  const view = await readWorkspace(token), saved = view.cases["late-payment"];
  expect(saved.messages).toEqual(original.messages); expect(saved.facts).toEqual(original.facts); expect(saved.turns).toBe(original.turns);
  expect(view.learning!.candidates[0]).toMatchObject({ status: "ready", sourceAuditId: value.targetAuditId, correctionId: value.correctionId, proposal: lessonProposal });
  const other = await createWorkspace(); expect((await readWorkspace(other.token)).learning).toBeUndefined();
  await expect(beginLearning(other.token, { id: randomUUID(), action: "evaluate_lesson", learningRevision: 0, candidateId: value.id })).rejects.toMatchObject({ status: 404 });
});

test("evaluated activation affects subsequent scoped jobs, pins versions, and rollback retains evidence", async () => {
  const { token, job } = await learningCase(); await completeLearning(token, job, lessonProposal); await evaluateFixture(token, job.candidate.id);
  await learningDecision(token, job.candidate.id); await beginCommand(token, command("resume"));
  const run = requireJob(await beginCommand(token, command("customer", "What is my balance?")));
  expect(run.input.lessons?.map((l) => l.id)).toEqual([job.candidate.id]);
  await learningDecision(token, job.candidate.id, "rollback_lesson");
  await commitResult(token, run, approved("The balance remains $129 for INV-101."));
  const view = await readWorkspace(token);
  expect(view.cases["late-payment"].audit.at(-1)?.lessonVersions).toEqual([job.candidate.id]);
  expect(view.learning!.active).toEqual([]); expect(view.learning!.history.map((h) => h.action)).toEqual(["activate_lesson", "rollback_lesson"]);
  const next = requireJob(await beginCommand(token, command("customer", "And now?"))); expect(next.input.lessons).toEqual([]);
  expect(activeLessons(view.learning, view.cases["cedar-late-payment"].facts)).toEqual([]);
});

test("an obsolete comparison requires the declared current suite and retains its original report", async () => {
  const { token, job } = await learningCase(); await completeLearning(token, job, lessonProposal); await evaluateFixture(token, job.candidate.id);
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{learning,candidates,0,evaluation,version}',to_jsonb($1::text))", ["learning-evals-1"]);
  await expect(learningDecision(token, job.candidate.id)).rejects.toThrow("live-evaluated");
  await evaluateFixture(token, job.candidate.id);
  const candidate = (await readWorkspace(token)).learning!.candidates[0];
  expect(candidate.evaluation?.version).toBe(EVALUATION_VERSION); expect(candidate.evaluationHistory?.[0].version).toBe("learning-evals-1");
  await learningDecision(token, job.candidate.id);
  await expect(learningDecision(token, job.candidate.id, "reject_lesson")).rejects.toThrow("Roll back");
  await learningDecision(token, job.candidate.id, "rollback_lesson"); await learningDecision(token, job.candidate.id, "reject_lesson");
  expect((await readWorkspace(token)).learning!.candidates[0].status).toBe("rejected");
});

test("a changed active baseline cannot activate an older evaluated candidate", async () => {
  const { token, job } = await learningCase(); await completeLearning(token, job, lessonProposal); await evaluateFixture(token, job.candidate.id);
  const state = (await readWorkspace(token)).learning!, replacement = { ...state.candidates[0], id: randomUUID(), status: "active" as const };
  state.candidates.push(replacement); state.active = [{ scope: replacement.scope, candidateId: replacement.id }];
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{learning}',$1::jsonb)", [JSON.stringify(state)]);
  await expect(learningDecision(token, job.candidate.id)).rejects.toThrow("live-evaluated");
});

test("rollback restores base rather than reactivating an obsolete prior lesson", async () => {
  const { token, job, value } = await learningCase(); await completeLearning(token, job, lessonProposal); await evaluateFixture(token, job.candidate.id); await learningDecision(token, job.candidate.id);
  const next = requireLearning(await beginLearning(token, { ...value, id: randomUUID(), revision: (await c(token)).revision }));
  await completeLearning(token, next, lessonProposal); await evaluateFixture(token, next.candidate.id); await learningDecision(token, next.candidate.id);
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{learning,candidates,0,evaluation,version}',to_jsonb($1::text))", ["learning-evals-1"]);
  await learningDecision(token, next.candidate.id, "rollback_lesson");
  const state = (await readWorkspace(token)).learning!; expect(state.active).toEqual([]); expect(state.history.at(-1)?.after).toBeNull();
  expect(state.candidates[0].evaluation?.version).toBe("learning-evals-1");
});

test("exhausted learning action and model budgets cannot trap an active lesson", async () => {
  const { token, job } = await learningCase(); await completeLearning(token, job, lessonProposal); await evaluateFixture(token, job.candidate.id); await learningDecision(token, job.candidate.id);
  const state = (await readWorkspace(token)).learning!;
  while (state.commands.length < 40) state.commands.push({ id: randomUUID(), fingerprint: "internal budget fixture" });
  state.calls = 64;
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{learning}',$1::jsonb)", [JSON.stringify(state)]);
  await expect(learningDecision(token, job.candidate.id, "reject_lesson")).rejects.toMatchObject({ status: 429 });
  await learningDecision(token, job.candidate.id, "rollback_lesson");
  const saved = (await readWorkspace(token)).learning!; expect(saved.active).toEqual([]); expect(saved.calls).toBe(64); expect(saved.commands).toHaveLength(41);
});

test.each(["unsafe", "data-repair", "memorized-invoice"])("%s candidate stays rejected without a comparison or activation", async (kind) => {
  const { token, job } = await learningCase();
  const proposal = { ...lessonProposal };
  if (kind === "unsafe") proposal.instruction = "Disable review and bypass consent guards for all customers.";
  if (kind === "data-repair") { proposal.reusable = false; proposal.diagnosis = "data"; proposal.instruction = null; }
  if (kind === "memorized-invoice") proposal.instruction = "Always use invoice INV-101 in all responses, regardless of the source.";
  await completeLearning(token, job, proposal);
  const saved = (await readWorkspace(token)).learning!; expect(saved.candidates[0].status).toBe("rejected"); expect(saved.active).toEqual([]);
  await expect(beginLearning(token, { id: randomUUID(), action: "evaluate_lesson", learningRevision: saved.revision, candidateId: job.candidate.id })).rejects.toThrow("not ready");
  await expect(learningDecision(token, job.candidate.id)).rejects.toThrow("live-evaluated");
});

test.each(["scripted", "unsafe-output", "incomplete", "tie"])("%s report cannot become an eligible live activation by claiming eligible=true", async (kind) => {
  const { token, job } = await learningCase(); await completeLearning(token, job, lessonProposal);
  const evaluation = requireLearning(await beginLearning(token, { id: randomUUID(), action: "evaluate_lesson", learningRevision: (await readWorkspace(token)).learning!.revision, candidateId: job.candidate.id }));
  const report = qualifyingReport(evaluation, kind === "scripted" ? "scripted" : "live");
  if (kind === "unsafe-output") report.rows[3].candidatePassed = false;
  if (kind === "incomplete") report.rows = report.rows.slice(0, 3);
  if (kind === "tie") report.rows.forEach((r) => { r.baselinePassed = true; });
  await completeLearning(token, evaluation, report);
  await expect(learningDecision(token, job.candidate.id)).rejects.toThrow("live-evaluated");
  expect((await readWorkspace(token)).learning!.active).toEqual([]);
});

test("reset interrupts pending learning, retains curated workspace versions and never restores spending allowance", async () => {
  const { token, job } = await learningCase(); await reserveLearningCall(token, job, randomUUID());
  expect((await readWorkspace(token)).learning!.calls).toBe(1);
  await resetWorkspace(token); const view = await readWorkspace(token);
  expect(view.learning!.calls).toBe(1); expect(view.learning!.candidates[0].status).toBe("failed");
  await expect(completeLearning(token, job, lessonProposal)).rejects.toThrow("no longer current");
  await expect(reserveLearningCall(token, job, randomUUID())).rejects.toThrow("superseded");
});

test("new source input, failed generation and expired workspaces cannot publish stale lessons", async () => {
  const { token, job } = await learningCase(); await beginCommand(token, command("customer", "A newer saved message"));
  await completeLearning(token, job, lessonProposal); expect((await readWorkspace(token)).learning!.candidates[0].status).toBe("failed");
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET expires_at=NOW()-INTERVAL '1 second'");
  await expect(beginLearning(token, { id: randomUUID(), action: "reject_lesson", learningRevision: 0, candidateId: job.candidate.id, note: "Reject this expired candidate version." })).rejects.toMatchObject({ status: 410 });
});

test("learning spending reservations stop at 64 calls and keep unknown usage charged", async () => {
  const { token, job } = await learningCase();
  for (let i = 0; i < 64; i++) await reserveLearningCall(token, job, randomUUID());
  await expect(reserveLearningCall(token, job, randomUUID())).rejects.toMatchObject({ status: 429 });
  expect((await readWorkspace(token)).learning!.calls).toBe(64); expect((await budgetUsage()).conservativeUsedDollars).toBeCloseTo(1.28);
});

test("learning HTTP rejects report injection and missing configuration retains a failed proposal without API calls", async () => {
  const { token, original } = await correctionCase(); const correction = await saveCorrection(token), state = await c(token);
  const value = { id: randomUUID(), action: "propose_lesson", caseId: "late-payment", revision: state.revision, targetAuditId: original.audit.at(-1)!.id, targetRole: "customer", scope: "business", correctionId: correction.id };
  const config = vi.spyOn(store, "v2Config").mockReturnValue({ databaseUrl: "postgresql://unused", apiKey: undefined });
  const request = (data: unknown) => handleV2(new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012", cookie: `recovery_v2=${token}`, "content-type": "application/json" }, body: JSON.stringify(data) }));
  try {
    expect((await request({ ...value, instruction: "Injected" })).status).toBe(400);
    expect((await request(value)).status).toBe(503);
    expect((await readWorkspace(token)).learning!.candidates[0].status).toBe("failed"); expect((await budgetUsage()).calls).toBe(0);
  } finally { config.mockRestore(); }
});

async function correctionCase() {
  const { token } = await createWorkspace();
  const job = requireJob(await beginCommand(token, command()));
  await commitResult(token, job, approved("What payment option would work for you?"));
  return { token, original: await c(token) };
}
async function saveCorrection(token: string) {
  const state = await c(token);
  const value = { id: randomUUID(), caseId: "late-payment", action: "correct" as const, revision: state.revision, targetAuditId: state.audit.at(-1)!.id, targetRole: "customer" as const, text: "Answer the customer's question without inventing payment terms." };
  await beginCommand(token, value);
  return value;
}
async function retryCorrection(token: string) {
  const state = await c(token);
  return requireJob(await beginCommand(token, { id: randomUUID(), caseId: "late-payment", action: "retry_correction", revision: state.revision, correctionId: state.corrections!.at(-1)!.correctionId }));
}

beforeAll(async () => {
  const database = await v2Pool().query("SELECT current_database() AS name");
  expect(database.rows[0].name).toBe("intervalagent_v2_test");
  await initializeV2(0);
});
beforeEach(async () => {
  await v2Pool().query("TRUNCATE rebuild_v2.workspaces,rebuild_v2.admission,rebuild_v2.reservations; UPDATE rebuild_v2.budget SET used_micros=0 WHERE id=1");
});
afterAll(closeV2Pool);

const scriptedOutput = (value: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const scriptedTool = (name: string, args: unknown): ModelResponse => ({ usage: new Usage(), output: [{ type: "function_call", callId: randomUUID(), name, arguments: JSON.stringify(args) }] });
async function completeScripted(token: string, job: Job, model: Model) {
  const bounded = boundedModel({ apiKey: "scripted-no-provider", model, reserve: (id) => reserveLive(id, { token, job }), start: (call) => startLive(call, { token, job }), record: (call) => recordLive(call, { token, job }) });
  const run = await investigateFromSource(job.input, syntheticSource([job.input.facts]), bounded);
  await commitResult(token, { ...job, input: run.input }, run.result);
  return run.result;
}

test.each(startingCases(new Date("2026-10-24T12:00:00Z")).map((facts) => facts.id))("%s SDK-to-storage journey preserves source money, changing contact intent, isolation and STOP", async (caseId) => {
  const { token } = await createWorkspace(), other = await createWorkspace(), initial = await readWorkspace(token);
  const original = structuredClone(initial.cases[caseId].facts), foreign = original.businessId === "northside" ? "Cedar Home Services" : "Northside Fitness";
  const turns = ["record", "commitment", "preference", "appointment"] as const;
  for (const turn of turns) {
    const text = turn === "record" ? `What balance is recorded for ${original.invoiceId}?` : turn === "commitment" ? "I promise to pay $50 tomorrow. Call me tomorrow afternoon." : turn === "preference" ? "Do not call. Email instead; I have not chosen a time." : "Please email tomorrow afternoon using my saved email.";
    const value = { id: randomUUID(), action: "customer" as const, caseId, text }, job = requireJob(await beginCommand(token, value));
    const date = localDate(new Date(job.input.now), original.timezone, 1);
    const updates: CaseUpdate[] = turn === "record" ? [] : turn === "commitment" ? [{ kind: "promise", amountCents: 5000, date, sourceMessageId: job.id }, { kind: "contact_requested", channel: "call", date, window: "afternoon", sourceMessageId: job.id }]
      : turn === "preference" ? [{ kind: "contact_preference", channel: "email", sourceMessageId: job.id }] : [{ kind: "contact_requested", channel: "email", date, window: "afternoon", sourceMessageId: job.id }];
    let customerCalls = 0; const roles: string[] = [];
    const model: Model = { async getResponse(request) {
      const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
      expect(JSON.stringify(request.input)).toContain(original.invoiceId); expect(JSON.stringify(request.input)).not.toContain(foreign);
      if (role === "reviewer") return scriptedOutput({ accepted: true, reasons: [] });
      if (role === "account_resolution") return scriptedOutput({ summary: "Record requested intent without executing contact or receiving money.", needsOperator: false, updates });
      if (role !== "customer") throw new Error("Unexpected role in a non-verification journey");
      if (++customerCalls === 1 && updates.length) return scriptedTool("account_resolution", { input: "Interpret the current customer request and propose its supported case updates." });
      return scriptedOutput({ reply: turn === "record" ? `The dated record for ${original.invoiceId} shows $${(original.balanceCents / 100).toFixed(2)}. No later payment is confirmed.` : "Your request is recorded; no contact or payment has executed.", needsOperator: false });
    }, async *getStreamedResponse() { throw new Error("unused"); } };
    const result = await completeScripted(token, job, model);
    expect(roles).toEqual(turn === "record" ? ["customer", "reviewer"] : ["customer", "account_resolution", "customer", "reviewer"]);
    expect(await beginCommand(token, value)).toBeNull(); await expect(commitResult(token, job, result)).rejects.toMatchObject({ status: 409 });
    const saved = (await readWorkspace(token)).cases[caseId];
    expect(saved.facts).toEqual(original); expect(saved.audit.at(-1)?.after).toEqual(saved.updates);
    expect(saved.lastRun?.calls).toBe(turn === "record" ? 2 : 4);
    if (turn === "commitment") expect(saved.events).toMatchObject([{ channel: "call", state: "planned", date }]);
    if (turn === "preference") { expect(saved.preferredChannel).toBe("email"); expect(saved.events).toMatchObject([{ channel: "call", state: "superseded" }]); }
  }
  await closeV2Pool(); const reloaded = await readWorkspace(token), saved = reloaded.cases[caseId];
  expect(saved.turns).toBe(4); expect(saved.audit).toHaveLength(4); expect(saved.events.map((e) => e.state)).toEqual(["superseded", "planned"]);
  expect(saved.updates.filter((u) => u.kind === "promise")).toHaveLength(1); expect(saved.facts).toEqual(original);
  for (const [id, state] of Object.entries(initial.cases)) if (id !== caseId) expect(reloaded.cases[id]).toEqual(state);
  expect((await readWorkspace(other.token)).cases).toEqual(other.view.cases);
  const calls = (await budgetUsage()).calls; expect(calls).toBe(14);
  expect(await beginCommand(token, { id: randomUUID(), caseId, action: "customer", text: "STOP" })).toBeNull();
  await expect(beginCommand(token, { id: randomUUID(), caseId, action: "retry" })).rejects.toMatchObject({ status: 409 });
  expect((await readWorkspace(token)).cases[caseId].events.map((e) => e.state)).toEqual(["superseded", "blocked"]);
  expect((await budgetUsage()).calls).toBe(calls);
});

test.each(["late-payment", "cedar-late-payment"])("%s business-evidence SDK journey obeys automatic versus operator financial authority", async (caseId) => {
  const { token } = await createWorkspace(), original = (await readWorkspace(token)).cases[caseId].facts;
  const claim = requireJob(await beginCommand(token, { id: randomUUID(), caseId, action: "customer", text: `I paid $50 today for ${original.invoiceId}. Please verify receipt.` }));
  const date = localDate(new Date(claim.input.now), original.timezone);
  for (const stage of ["request", "reply"] as const) {
    let job = claim;
    if (stage === "reply") {
      const saved = (await readWorkspace(token)).cases[caseId], foreignId = caseId === "late-payment" ? "cedar-late-payment" : "late-payment";
      expect(saved.status).toBe("awaiting_business"); expect(saved.facts).toEqual(original);
      await expect(beginCommand(token, { id: randomUUID(), caseId: foreignId, action: "business", requestId: saved.requestId!, text: "Yes" })).rejects.toMatchObject({ status: 409 });
      job = requireJob(await beginCommand(token, { id: randomUUID(), caseId, action: "business", requestId: saved.requestId!, text: `Yes, we received and settled $50 today for ${original.invoiceId}.` }));
    }
    const operator = original.recognitionPolicy === "operator_review"; let customerCalls = 0;
    const roles: string[] = [], evidence: Verification = { claimMessageId: claim.id, outcome: stage === "request" ? "awaiting_business" : "business_confirmed", businessMessage: stage === "request" ? `Was the $50 for ${original.invoiceId} received and settled on ${date}?` : null, summary: stage === "request" ? "Awaiting linked business evidence" : "The linked business reply confirmed the scoped payment", amountCents: 5000, invoiceId: original.invoiceId, paymentDate: date, reference: null, settlementStatus: stage === "request" ? "unknown" : "settled", missingFacts: stage === "request" ? ["receipt"] : [] };
    const model: Model = { async getResponse(request) {
      const role = String(request.modelSettings.providerData?.metadata?.agent_role); roles.push(role);
      expect(JSON.stringify(request.input)).toContain(original.invoiceId);
      if (role === "reviewer") return scriptedOutput({ accepted: true, reasons: [] });
      if (role === "business_verification") return scriptedOutput(evidence);
      if (role === "account_resolution") return scriptedOutput({ summary: operator ? "Complete evidence needs operator approval under this business policy." : "Propose recording the exact linked business-confirmed payment.", needsOperator: operator, updates: operator ? [] : [{ kind: "payment_recognized", amountCents: 5000, date, invoiceId: original.invoiceId, reference: null, sourceMessageId: claim.id, businessMessageId: job.id }] });
      if (role !== "customer") throw new Error("Unexpected role");
      if (++customerCalls === 1) return scriptedTool("business_verification", scriptedClaim(job.input, { claimMessageId: claim.id, amountCents: 5000, date }));
      if (stage === "reply" && customerCalls === 2) return scriptedTool("account_resolution", { input: "Assess this business-confirmed payment using the configured recognition policy." });
      return scriptedOutput({ reply: stage === "request" ? "I requested business verification; receipt is not confirmed." : operator ? "The business confirmed $50; an operator must approve recording it. The balance is unchanged." : `The business-confirmed $50 was recorded for ${original.invoiceId}; $${((original.balanceCents - 5000) / 100).toFixed(2)} remains.`, needsOperator: stage === "reply" && operator });
    }, async *getStreamedResponse() { throw new Error("unused"); } };
    await completeScripted(token, job, model);
    expect(roles).toEqual(stage === "request" ? ["customer", "business_verification", "customer", "reviewer"] : ["customer", "business_verification", "customer", "account_resolution", "customer", "reviewer"]);
  }
  let saved = (await readWorkspace(token)).cases[caseId];
  if (original.recognitionPolicy === "operator_review") {
    expect(saved.facts).toEqual(original); expect(saved.status).toBe("needs_review");
    await beginCommand(token, { id: randomUUID(), caseId, action: "takeover" }); saved = (await readWorkspace(token)).cases[caseId];
    const approval = { id: randomUUID(), caseId, action: "approve_recognition" as const, revision: saved.revision, targetAuditId: saved.audit.at(-1)!.id, evidenceReference: "scripted-5c-business-evidence", note: "Scripted test operator inspected the complete linked synthetic business evidence." };
    const calls = (await budgetUsage()).calls;
    expect(await beginCommand(token, approval)).toBeNull(); expect(await beginCommand(token, approval)).toBeNull();
    expect((await budgetUsage()).calls).toBe(calls);
  }
  await closeV2Pool(); saved = (await readWorkspace(token)).cases[caseId];
  expect(saved.facts.balanceCents).toBe(original.balanceCents - 5000); expect(saved.facts.payments).toHaveLength(1);
  expect(saved.facts.payments[0]).toMatchObject({ amountCents: 5000, invoiceId: original.invoiceId, includedInBalance: true, provenance: original.recognitionPolicy === "operator_review" ? "operator_decision" : "business_confirmation" });
  expect(saved.operations).toBeUndefined(); expect((await budgetUsage()).calls).toBe(10);
});

test("same-case histories are private across tester workspaces; foreign IDs fail", async () => {
  const a = await createWorkspace(), b = await createWorkspace();
  await beginCommand(a.token, command());
  expect((await c(a.token)).messages.filter((m) => m.origin !== "synthetic_opening")).toHaveLength(1);
  expect((await c(b.token)).messages.filter((m) => m.origin !== "synthetic_opening")).toHaveLength(0);
  await expect(readWorkspace("a".repeat(64))).rejects.toMatchObject({ status: 401 });
  await expect(beginCommand(a.token, { ...command(), caseId: "constructor" })).rejects.toMatchObject({ status: 404 });
});

test("saving an operator correction pauses once, preserves the original and spends no model/turn allowance", async () => {
  const { token, original } = await correctionCase();
  const value = await saveCorrection(token);
  expect(await beginCommand(token, value)).toBeNull();
  const saved = await c(token);
  expect(saved).toMatchObject({ takeover: true, status: "taken_over", turns: original.turns, retries: original.retries, revision: original.revision + 1 });
  expect(saved.messages).toEqual(original.messages); expect(saved.updates).toEqual(original.updates); expect(saved.lastRun).toEqual(original.lastRun);
  expect(saved.corrections).toHaveLength(1);
  expect(saved.corrections![0]).toMatchObject({ correctionId: value.id, original: original.lastReview, targetAuditId: original.audit.at(-1)!.id, text: value.text });
  expect((await budgetUsage()).calls).toBe(0);
  await expect(beginCommand(token, { ...value, text: "Different feedback with the same ID" })).rejects.toMatchObject({ status: 409 });
});

test("correction retry resumes explicitly, publishes only after review and keeps linked original/revised history", async () => {
  const { token, original } = await correctionCase();
  const correction = await saveCorrection(token), job = await retryCorrection(token);
  expect(job.input.operatorFeedback).toMatchObject({ correctionId: correction.id, text: correction.text, original: original.lastReview });
  expect(job.input.messages).toEqual(original.messages);
  const revised = approved("I can record your preferences, but no installment plan has been approved.");
  await commitResult(token, job, revised);
  await closeV2Pool();
  const saved = await c(token);
  expect(saved).toMatchObject({ takeover: false, reviewHold: false, status: "ready", retries: 1, turns: 1 });
  expect(saved.messages.slice(0, original.messages.length)).toEqual(original.messages);
  expect(saved.messages.at(-1)).toMatchObject({ text: revised.draft.reply, origin: "operator_revision" });
  expect(saved.corrections![0]).toMatchObject({ outcome: "completed", runId: job.id, result: revised, original: original.lastReview });
  expect(saved.audit.at(-1)).toMatchObject({ id: job.id, correctionId: correction.id });
  expect(saved.audit.at(-1)!.sourceMessageIds).not.toContain(correction.id);
  await expect(commitResult(token, job, revised)).rejects.toMatchObject({ status: 409 });
  const next = requireJob(await beginCommand(token, command("customer", "Please email me instead")));
  expect(next.input.operatorFeedback).toBeUndefined();
});

test("Reviewer rejection retains the revised draft privately without publishing it", async () => {
  const { token, original } = await correctionCase();
  await saveCorrection(token); const job = await retryCorrection(token);
  const rejected = { ...approved("Unapproved installment terms are agreed"), review: { accepted: false, reasons: ["Business policy does not establish these terms"] } };
  await commitResult(token, job, rejected);
  const saved = await c(token);
  expect(saved.messages).toEqual(original.messages); expect(saved.status).toBe("needs_review");
  expect(saved.corrections![0]).toMatchObject({ outcome: "blocked", result: rejected });
});

test("a blocked original can be corrected once; concurrent retries start only one reviewed run", async () => {
  const { token } = await createWorkspace();
  const original = requireJob(await beginCommand(token, command()));
  await commitResult(token, original, { ...approved("Unsupported original draft"), review: { accepted: false, reasons: ["Missing facts"] } });
  await saveCorrection(token);
  const saved = await c(token);
  const value = { id: randomUUID(), caseId: "late-payment", action: "retry_correction" as const, revision: saved.revision, correctionId: saved.corrections![0].correctionId };
  const jobs = await Promise.all([beginCommand(token, value), beginCommand(token, value)]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  const job = requireJob(jobs.find(Boolean)!);
  const date = localDate(new Date(), "America/Denver", 1);
  await commitResult(token, job, { ...approved("Your $50 promise was saved; no money has been received."), resolution: { needsOperator: false, summary: "Record the actual customer promise", updates: [{ kind: "promise", amountCents: 5000, date, sourceMessageId: original.id }] } });
  const after = await c(token);
  expect(after.retries).toBe(1); expect(after.turns).toBe(1);
  expect(after.updates).toMatchObject([{ kind: "promise", sourceMessageId: original.id }]);
  expect(after.facts.balanceCents).toBe(12900);
  expect(after.corrections![0].original.review.accepted).toBe(false);
  expect(after.messages.some((m) => m.text === "Unsupported original draft")).toBe(false);
  expect(after.messages.at(-1)!.origin).toBe("operator_revision");
});

test.each(["customer", "resume", "stop", "reset", "expiry"])("%s invalidates saved feedback before its correction retry", async (change) => {
  const { token } = await correctionCase(); await saveCorrection(token);
  const before = await c(token);
  const retry = { id: randomUUID(), caseId: "late-payment", action: "retry_correction" as const, revision: before.revision, correctionId: before.corrections![0].correctionId };
  if (change === "reset") await resetWorkspace(token);
  else if (change === "expiry") await v2Pool().query("UPDATE rebuild_v2.workspaces SET expires_at=NOW()-INTERVAL '1 second'");
  else await beginCommand(token, command(change === "resume" ? "resume" : "customer", change === "stop" ? "STOP" : "New customer evidence"));
  await expect(beginCommand(token, retry)).rejects.toMatchObject({ status: change === "expiry" ? 410 : 409 });
  expect((await budgetUsage()).calls).toBe(0);
});

test.each(["customer", "takeover", "stop", "reset"])("%s prevents a running correction from publishing obsolete work", async (change) => {
  const { token, original } = await correctionCase(); await saveCorrection(token); const job = await retryCorrection(token);
  if (change === "reset") await resetWorkspace(token);
  else await beginCommand(token, command(change === "takeover" ? "takeover" : "customer", change === "stop" ? "STOP" : "New customer evidence"));
  await expect(commitResult(token, job, approved("Obsolete revision"))).rejects.toMatchObject({ status: 409 });
  const saved = await c(token);
  expect(saved.messages.some((m) => m.text === "Obsolete revision")).toBe(false);
  if (change !== "reset") {
    expect(saved.corrections![0]).toMatchObject({ outcome: "interrupted", original: original.lastReview });
    expect(saved.corrections![0].result).toBeUndefined();
  }
});

test("corrections reject foreign targets, active runs, forged roles, oversized feedback and cross-case IDs", async () => {
  const a = await correctionCase(), b = await correctionCase();
  const value = await saveCorrection(a.token), saved = await c(a.token);
  await expect(beginCommand(b.token, { ...value, id: randomUUID(), revision: b.original.revision })).rejects.toMatchObject({ status: 409 });
  await expect(beginCommand(a.token, { ...value, id: randomUUID(), caseId: "cedar-late-payment", revision: 0 })).rejects.toMatchObject({ status: 409 });
  await expect(beginCommand(a.token, { ...value, id: randomUUID(), revision: saved.revision, text: "x".repeat(1201) })).rejects.toMatchObject({ status: 400 });
  const response = await handleV2(new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012", cookie: `recovery_v2=${a.token}`, "content-type": "application/json" }, body: JSON.stringify({ ...value, targetRole: "maintainer", revision: saved.revision }) }));
  expect(response.status).toBe(400);
  await retryCorrection(a.token);
  await expect(beginCommand(a.token, { ...value, id: randomUUID(), revision: (await c(a.token)).revision })).rejects.toMatchObject({ status: 409 });
});

test("correction attempts retain safe failure status and cannot be silently repeated or exceed limits", async () => {
  const { token } = await correctionCase(); await saveCorrection(token); const job = await retryCorrection(token);
  await failRun(token, job, { kind: "access", status: 401, code: "invalid_api_key", message: "Check credentials." });
  const failed = await c(token);
  expect(failed.corrections![0]).toMatchObject({ outcome: "failed", runId: job.id });
  await expect(retryCorrection(token)).rejects.toMatchObject({ status: 409 });
  for (let i = 1; i < 6; i++) await saveCorrection(token);
  await expect(saveCorrection(token)).rejects.toMatchObject({ status: 429 });
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,retries}','6'::jsonb)");
  await expect(retryCorrection(token)).rejects.toMatchObject({ status: 429 });
  expect((await c(token)).turns).toBe(1); expect((await budgetUsage()).calls).toBe(0);
});

test("the HTTP correction save is private, idempotent and never calls a model", async () => {
  const { token, original } = await correctionCase();
  const value = { id: randomUUID(), caseId: "late-payment", action: "correct", revision: original.revision, targetAuditId: original.audit.at(-1)!.id, targetRole: "reviewer", text: "Check whether the customer asked for information rather than agreeing to terms." };
  const request = (origin = "http://127.0.0.1:3012") => new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin, cookie: `recovery_v2=${token}`, "content-type": "application/json" }, body: JSON.stringify(value) });
  expect((await handleV2(request("https://foreign.test"))).status).toBe(403);
  const response = await handleV2(request());
  expect(response.status).toBe(200);
  expect((await response.json()).workspace.cases["late-payment"].corrections[0].targetRole).toBe("reviewer");
  expect((await handleV2(request())).status).toBe(200);
  expect((await c(token)).corrections).toHaveLength(1);
  expect((await budgetUsage()).calls).toBe(0);
});

test("invalid source data reaches the app as a safe source failure before reserving or calling a model", async () => {
  const { token } = await createWorkspace();
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,facts,balanceCents}','-1'::jsonb)");
  vi.stubEnv("OPENAI_API_KEY", "test-key-never-transmitted");
  try {
    const response = await handleV2(new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012", cookie: `recovery_v2=${token}`, "content-type": "application/json" }, body: JSON.stringify(command()) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "The account source returned an invalid record." });
    expect((await c(token)).lastRun?.failure).toMatchObject({ kind: "source", code: "invalid_record" });
    expect((await budgetUsage()).calls).toBe(0);
  } finally { vi.unstubAllEnvs(); }
});

test("new business evidence invalidates a saved correction, and STOP forbids a new one", async () => {
  const { token } = await createWorkspace();
  const job = requireJob(await beginCommand(token, command("customer", "I paid today for INV-101")));
  await commitResult(token, job, { ...approved(), paymentClaim: scriptedClaim(job.input, { claimMessageId: job.id }), verification: { ...verification, claimMessageId: job.id } });
  await saveCorrection(token);
  const saved = await c(token);
  await beginCommand(token, { ...command("business", "Only $50 was received"), requestId: saved.requestId! });
  await expect(retryCorrection(token)).rejects.toMatchObject({ status: 409 });
  await beginCommand(token, command("customer", "STOP"));
  await expect(saveCorrection(token)).rejects.toMatchObject({ status: 409 });
  expect((await c(token)).stopped).toBe(true);
});

test("existing workspaces gain twelve scoped cases without rewriting saved work, allowance or expiry", async () => {
  const { token } = await createWorkspace();
  await beginCommand(token, command());
  await beginCommand(token, { ...command("customer", "STOP"), caseId: "fresh-record" });
  const before = await readWorkspace(token);
  const cases = Object.fromEntries(["late-payment", "fresh-record", "conflicting-payment"].map((id) => [id, before.cases[id]]));
  const expiry = new Date(Date.now() + 7_200_000).toISOString();
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=$1,expires_at=$2", [{ cases, resets: 2 }, expiry]);
  const [a, b] = await Promise.all([readWorkspace(token), readWorkspace(token)]);
  expect(Object.keys(a.cases)).toHaveLength(12);
  expect(b).toEqual({ ...a, observedAt: b.observedAt });
  expect(Number.isFinite(Date.parse(a.observedAt!))).toBe(true);
  expect(Number.isFinite(Date.parse(b.observedAt!))).toBe(true);
  expect(a.expiresAt).toBe(expiry); expect(a.resets).toBe(2);
  for (const id of Object.keys(cases)) expect(a.cases[id]).toEqual(cases[id]);
  const added = a.cases["cedar-late-payment"];
  expect(added.messages).toHaveLength(1); expect(added.turns).toBe(0);
  expect(added.messages[0].at).toBe(new Date(Date.parse(expiry) - 86_400_000).toISOString());
  expect(added.facts.balanceAsOf).toBe(new Date(Date.parse(expiry) - 2 * 86_400_000).toISOString());
  expect(await budgetUsage()).toMatchObject({ calls: 0, conservativeUsedDollars: 0 });
});

test("business request IDs cannot be used in another business case or tester workspace", async () => {
  const a = await createWorkspace(), b = await createWorkspace();
  const job = requireJob(await beginCommand(a.token, command("customer", "I paid $129 today for INV-101")));
  await commitResult(a.token, job, { ...approved("I asked the business to verify."), paymentClaim: scriptedClaim(job.input, { claimMessageId: job.id }), verification: { ...verification, claimMessageId: job.id } });
  const saved = await readWorkspace(a.token), requestId = saved.cases["late-payment"].requestId!;
  const reply = { ...command("business", "Yes"), requestId };
  await expect(beginCommand(a.token, { ...reply, caseId: "cedar-late-payment" })).rejects.toMatchObject({ status: 409 });
  await expect(beginCommand(b.token, reply)).rejects.toMatchObject({ status: 409 });
  expect((await readWorkspace(a.token)).cases["cedar-late-payment"]).toEqual(saved.cases["cedar-late-payment"]);
  expect((await readWorkspace(b.token)).cases["late-payment"].messages).toHaveLength(1);
});

test("reviewed dashboard records persist independently across businesses and reconnects", async () => {
  const { token } = await createWorkspace();
  const job = requireJob(await beginCommand(token, { ...command(), caseId: "cedar-late-payment" }));
  const date = localDate(new Date(), "America/Denver", 1);
  const updates = [{ kind: "promise" as const, amountCents: 5000, date, sourceMessageId: job.id }, { kind: "contact_requested" as const, channel: "call" as const, date, window: "afternoon" as const, sourceMessageId: job.id }];
  await commitResult(token, job, { ...approved(), resolution: { summary: "Recorded the promise and call request, without executing either.", needsOperator: false, updates } });
  await closeV2Pool();
  const view = await readWorkspace(token);
  expect(view.cases["cedar-late-payment"].updates).toEqual(updates);
  expect(view.cases["cedar-late-payment"].events[0]).toMatchObject({ state: "planned", channel: "call", date });
  expect(view.cases["late-payment"].updates).toEqual([]);
  expect(view.cases["late-payment"].events).toEqual([]);
  expect(view.cases["cedar-late-payment"].facts.balanceCents).toBe(18500);
});

test("concurrent duplicate submissions/retries do not double-count or start duplicate jobs", async () => {
  const { token } = await createWorkspace(); const request = command();
  const jobs = await Promise.all([beginCommand(token, request), beginCommand(token, request)]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  expect((await c(token)).turns).toBe(1);
  await expect(beginCommand(token, { ...request, text: "Changed content" })).rejects.toMatchObject({ status: 409 });
  const retry = command("retry");
  const retried = await Promise.all([beginCommand(token, retry), beginCommand(token, retry)]);
  expect(retried.filter(Boolean)).toHaveLength(1);
  expect((await c(token)).turns).toBe(1);
});

test("turn exhaustion still permits STOP and history without any model reservation", async () => {
  const { token } = await createWorkspace();
  for (let n = 0; n < 10; n++) await beginCommand(token, command());
  await expect(beginCommand(token, command())).rejects.toMatchObject({ status: 429 });
  await beginCommand(token, command("customer", "STOP"));
  expect((await c(token)).status).toBe("stopped");
  expect((await budgetUsage()).calls).toBe(0);
  await beginCommand(token, command("resume"));
  expect((await c(token)).stopped).toBe(true);
  await expect(beginCommand(token, command("retry"))).rejects.toMatchObject({ status: 409 });
});

test.each(["new-input", "reset", "takeover", "stop"])("%s fences stale publication and case writes", async (change) => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  if (change === "reset") await resetWorkspace(token);
  else await beginCommand(token, command(change === "takeover" ? "takeover" : "customer", change === "stop" ? "STOP" : "My claim changed"));
  await expect(commitResult(token, job, approved())).rejects.toMatchObject({ status: 409 });
  expect((await c(token)).messages.some((m) => m.id === `${job.id}-reply`)).toBe(false);
});

test("case update, saved reply and audit commit together; balance never changes", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const result = approved();
  result.resolution = { needsOperator: false, summary: "Promise and call request", updates: [
    { kind: "promise", amountCents: 5000, date: tomorrow, sourceMessageId: job.id },
    { kind: "contact_requested", channel: "call", date: tomorrow, window: "afternoon", sourceMessageId: job.id },
  ] };
  await commitResult(token, job, result);
  const saved = await c(token);
  expect(saved.updates).toHaveLength(2); expect(saved.audit).toHaveLength(1);
  expect(saved.audit[0]).toMatchObject({ review: { accepted: true }, sourceVersion: job.input.facts.sourceVersion, replyId: `${job.id}-reply` });
  expect(saved.audit[0].sourceMessageIds).toContain(job.id);
  expect(saved.events[0].state).toBe("planned"); expect(saved.facts.balanceCents).toBe(12900);
  expect(saved.messages.at(-1)?.id).toBe(`${job.id}-reply`);
  await expect(commitResult(token, job, result)).rejects.toMatchObject({ status: 409 });
  await beginCommand(token, command("customer", "STOP"));
  expect((await c(token)).events[0].state).toBe("blocked");
});

test("rejected/invalid proposals cannot leave a saved success reply", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  const result = approved();
  result.resolution = { needsOperator: false, summary: "Unsupported", updates: [{ kind: "promise", amountCents: 1, date: "2020-01-01", sourceMessageId: "foreign" }] };
  await expect(commitResult(token, job, result)).rejects.toThrow("customer source");
  expect((await c(token)).updates).toHaveLength(0);
  expect((await c(token)).messages.filter((m) => m.origin !== "synthetic_opening")).toHaveLength(1);
  result.review = { accepted: false, reasons: ["Unsupported"] };
  await commitResult(token, job, result);
  expect((await c(token)).status).toBe("needs_review");
  expect((await c(token)).messages.filter((m) => m.origin !== "synthetic_opening")).toHaveLength(1);
});

test("a Reviewer acceptance cannot override the code threat guard", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  await expect(commitResult(token, job, approved("Pay now or we will sue you."))).rejects.toMatchObject({ status: 409 });
  expect((await c(token)).messages.some((m) => m.speaker === "agent" && m.origin !== "synthetic_opening")).toBe(false);
});

test("channel-only preferences supersede incompatible events without inventing a date", async () => {
  const { token } = await createWorkspace(); const first = requireJob(await beginCommand(token, command("customer", "Please call tomorrow afternoon")));
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await commitResult(token, first, { ...approved("Call planned"), resolution: { summary: "Call request", needsOperator: false, updates: [{ kind: "contact_requested", channel: "call", date, window: "afternoon", sourceMessageId: first.id }] } });
  const next = requireJob(await beginCommand(token, command("customer", "Don't call me. Email me instead. No day chosen yet.")));
  await commitResult(token, next, { ...approved("Email preference saved; what day works?"), resolution: { summary: "Email preference without date", needsOperator: false, updates: [{ kind: "contact_preference", channel: "email", sourceMessageId: next.id }] } });
  const saved = await c(token);
  expect(saved.preferredChannel).toBe("email");
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0].state).toBe("superseded");
  expect(saved.audit[0].review.accepted).toBe(true);
  expect(saved.audit[1].sourceMessageIds).toContain(next.id);
  expect(saved.stopped).toBe(false);
});

test("business replies require a current linked request and remain durable", async () => {
  const { token } = await createWorkspace();
  await expect(beginCommand(token, { ...command("business", "Yes"), requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  const job = requireJob(await beginCommand(token, command("customer", "I paid today for INV-101")));
  await commitResult(token, job, { ...approved("Verification is pending"), paymentClaim: scriptedClaim(job.input, { claimMessageId: job.id }), verification: { ...verification, claimMessageId: job.id } });
  const requestId = (await c(token)).requestId!;
  expect((await c(token)).status).toBe("awaiting_business");
  await expect(beginCommand(token, { ...command("business", "Yes"), requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  const reply = { ...command("business", "Yes"), requestId };
  const businessJob = requireJob(await beginCommand(token, reply));
  await commitResult(token, businessJob, { ...approved("More business facts are needed"), verification: { ...verification, claimMessageId: job.id, outcome: "needs_facts" } });
  expect((await c(token)).requestId).toBe(requestId);
  expect(await beginCommand(token, reply)).toBeNull();
  expect((await c(token)).businessReplies).toBe(1);
});

test("expiry and reset do not revive access, late replies or API allowance", async () => {
  const { token } = await createWorkspace(); const original = await readWorkspace(token);
  await reserveLive(randomUUID()); const usage = await budgetUsage();
  const reset = await resetWorkspace(token);
  expect(reset.expiresAt).toBe(original.expiresAt);
  expect((await budgetUsage()).conservativeUsedDollars).toBe(usage.conservativeUsedDollars);
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET expires_at=NOW()-INTERVAL '1 second'");
  await expect(readWorkspace(token)).rejects.toMatchObject({ status: 410 });
  await expect(beginCommand(token, command("business", "Paid"))).rejects.toMatchObject({ status: 410 });
});

test("shared reservations are atomic; known usage settles once and unknown calls remain charged", async () => {
  await v2Pool().query("UPDATE rebuild_v2.budget SET used_micros=1980000 WHERE id=1");
  const ids = [randomUUID(), randomUUID()];
  const attempts = await Promise.allSettled(ids.map((id) => reserveLive(id)));
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);
  const id = ids[0];
  expect((await budgetUsage()).capDollars).toBeNull();
  expect((await budgetUsage()).conservativeUsedDollars).toBe(2.02);
  expect((await budgetUsage()).unknown_calls).toBe(2);
  const call = { id, inputTokens: 1000, outputTokens: 100, usageKnown: true, latencyMs: 1, tools: [] };
  await recordLive(call); await recordLive(call);
  expect((await budgetUsage()).conservativeUsedDollars).toBe(2.00035);
  expect((await budgetUsage()).unknown_calls).toBe(1);
  await initializeV2(0);
  expect((await budgetUsage()).conservativeUsedDollars).toBe(2.00035);
});

test("missing usage keeps its reservation even when the SDK supplies normalized zero counts", async () => {
  const id = randomUUID(); await reserveLive(id);
  await recordLive({ id, inputTokens: 0, outputTokens: 0, usageKnown: false, latencyMs: 1, tools: [] });
  expect((await budgetUsage()).conservativeUsedDollars).toBe(0.02);
  expect((await budgetUsage()).unknown_calls).toBe(1);
});

test("business evidence received during takeover keeps its request linkage for explicit resumption", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command("customer", "I paid today for INV-101")));
  await commitResult(token, job, { ...approved("Verification pending"), paymentClaim: scriptedClaim(job.input, { claimMessageId: job.id }), verification: { ...verification, claimMessageId: job.id } });
  const requestId = (await c(token)).requestId!;
  await beginCommand(token, command("takeover"));
  expect((await c(token)).lastRun).toMatchObject({ id: job.id, outcome: "completed", calls: 0 });
  expect(await beginCommand(token, { ...command("business", "Yes"), requestId })).toBeNull();
  expect((await c(token)).messages.at(-1)?.requestId).toBe(requestId);
  await beginCommand(token, command("resume"));
  const retry = requireJob(await beginCommand(token, command("retry")));
  expect(retry.input.messages.some((m) => m.speaker === "business" && m.requestId === requestId)).toBe(true);
});

test("new claims receive a new business request; old request replies cannot attach", async () => {
  const { token } = await createWorkspace(); const first = requireJob(await beginCommand(token, command("customer", "I paid $50 yesterday for INV-101")));
  await commitResult(token, first, { ...approved("Verification pending"), paymentClaim: scriptedClaim(first.input, { claimMessageId: first.id }), verification: { ...verification, claimMessageId: first.id } });
  const oldRequest = (await c(token)).requestId!;
  const next = requireJob(await beginCommand(token, command("customer", "I made another payment today for INV-101")));
  await commitResult(token, next, { ...approved("Checking the new payment"), paymentClaim: scriptedClaim(next.input, { claimMessageId: next.id }), verification: { ...verification, claimMessageId: next.id, businessMessage: "Please check the new payment" } });
  expect((await c(token)).requestId).not.toBe(oldRequest);
  expect(await beginCommand(token, { ...command("business", "Yes"), requestId: oldRequest })).toBeNull();
  const saved = await c(token);
  expect(saved.messages.at(-1)?.disposition).toBe("late");
  expect(saved.verification?.claimMessageId).toBe(next.id);
  expect(saved.facts.balanceCents).toBe(12900);
});

test("a superseded run cannot reserve more model spending", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  await beginCommand(token, command("takeover"));
  await expect(reserveLive(randomUUID(), { token, job })).rejects.toMatchObject({ status: 409 });
  expect((await budgetUsage()).calls).toBe(0);
});

async function recognitionJob(amountCents = 5000) {
  const { token } = await createWorkspace();
  const claim = requireJob(await beginCommand(token, command("customer", "I paid $129 today for INV-101")));
  const date = localDate(new Date(claim.input.now), claim.input.facts.timezone);
  const pending: Verification = { ...verification, claimMessageId: claim.id, amountCents: 12900, invoiceId: "INV-101", paymentDate: date, businessMessage: `Was $129 received and settled today, ${date}, for INV-101?` };
  await commitResult(token, claim, { ...approved("Checking with the business"), paymentClaim: scriptedClaim(claim.input, { amountCents: pending.amountCents, date: pending.paymentDate }), verification: pending });
  const requestId = (await c(token)).requestId!;
  const job = requireJob(await beginCommand(token, { ...command("business", `Only $${amountCents / 100}; other details are correct.`), requestId }));
  const confirmed: Verification = { ...pending, outcome: "business_confirmed", amountCents, settlementStatus: "settled", missingFacts: [], businessMessage: null };
  const result: InvestigationResult = { ...approved("The business-confirmed payment was recorded in this simulated account."), verification: confirmed, resolution: { summary: "Reconcile the confirmed payment", needsOperator: false, updates: [{ kind: "payment_recognized", amountCents, date, invoiceId: "INV-101", reference: null, sourceMessageId: claim.id, businessMessageId: job.id }] } };
  return { token, job, result, claim };
}

test("operator feedback cannot recognize a payment, even with a valid reviewed confirmation", async () => {
  const { token, job, result } = await recognitionJob();
  await failRun(token, job);
  await saveCorrection(token); const retry = await retryCorrection(token);
  await expect(commitResult(token, retry, result)).rejects.toMatchObject({ status: 409 });
  const saved = await c(token);
  expect(saved.facts.balanceCents).toBe(12900); expect(saved.facts.payments).toEqual([]);
  expect(saved.corrections![0].result).toBeUndefined();
  expect(saved.messages.some((m) => m.id === `${retry.id}-reply`)).toBe(false);
});

test("correcting a published payment explanation preserves the committed receipt and balance", async () => {
  const { token, job, result } = await recognitionJob();
  await commitResult(token, job, result);
  const original = await c(token);
  await saveCorrection(token); const retry = await retryCorrection(token);
  await commitResult(token, retry, { ...approved("The confirmed $50 payment is already included; no additional payment was recorded."), verification: result.verification });
  const saved = await c(token);
  expect(saved.facts).toEqual(original.facts); expect(saved.updates).toEqual(original.updates);
  expect(saved.corrections![0].original).toEqual(result);
  expect(saved.messages).toHaveLength(original.messages.length + 1);
});

test.each([5000, 12900])("business-confirmed %i cents commits receipt, balance, reply and audit once", async (amount) => {
  const { token, job, result } = await recognitionJob(amount);
  await commitResult(token, job, result);
  await closeV2Pool();
  const saved = await c(token);
  expect(saved.facts.balanceCents).toBe(12900 - amount);
  expect(saved.facts.payments).toHaveLength(1);
  expect(saved.facts.payments[0]).toMatchObject({ amountCents: amount, includedInBalance: true, provenance: "business_confirmation", businessMessageId: job.id });
  expect(saved.messages.at(-1)?.id).toBe(`${job.id}-reply`);
  expect(saved.audit.at(-1)).toMatchObject({ balanceBeforeCents: 12900, balanceAfterCents: 12900 - amount });
  await expect(commitResult(token, job, result)).rejects.toMatchObject({ status: 409 });
  const retry = requireJob(await beginCommand(token, command("retry")));
  await expect(commitResult(token, retry, result)).rejects.toThrow();
  expect((await c(token)).facts.payments).toHaveLength(1);
});

test.each(["pending", "wrong-invoice", "foreign-source", "overpayment", "future-date", "old-date", "no-policy", "duplicate", "operator-required"])("%s cannot change a balance or publish a recognition reply", async (kind) => {
  const { token, job, result } = await recognitionJob();
  const update = result.resolution!.updates[0];
  if (update.kind !== "payment_recognized") throw new Error("Expected recognition proposal");
  if (kind === "pending") result.verification!.outcome = "pending";
  if (kind === "wrong-invoice") result.verification!.invoiceId = update.invoiceId = "INV-OTHER";
  if (kind === "foreign-source") update.businessMessageId = randomUUID();
  if (kind === "overpayment") result.verification!.amountCents = update.amountCents = 20000;
  if (kind === "future-date") result.verification!.paymentDate = update.date = "2099-01-01";
  if (kind === "old-date") result.verification!.paymentDate = update.date = "2020-01-01";
  if (kind === "operator-required") result.resolution!.needsOperator = true;
  if (kind === "no-policy" || kind === "duplicate") {
    await v2Pool().query(kind === "no-policy"
      ? "UPDATE rebuild_v2.workspaces SET data=data #- '{cases,late-payment,facts,recognitionPolicy}'"
      : "UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,facts,payments}',$1::jsonb)", kind === "duplicate" ? [JSON.stringify([{ id: "existing", invoiceId: "INV-101", amountCents: 5000, date: update.date, status: "settled", includedInBalance: true }])] : []);
    job.input.facts = (await c(token)).facts;
  }
  await expect(commitResult(token, job, result)).rejects.toThrow();
  const saved = await c(token);
  expect(saved.facts.balanceCents).toBe(12900);
  expect(saved.messages.some((m) => m.id === `${job.id}-reply`)).toBe(false);
  expect(saved.audit).toHaveLength(1);
});

test("Reviewer rejection blocks recognition; supersession blocks its publication", async () => {
  const { token, job, result } = await recognitionJob();
  await commitResult(token, job, { ...result, review: { accepted: false, reasons: ["Unclear evidence"] } });
  expect((await c(token)).facts.balanceCents).toBe(12900);
  expect((await c(token)).status).toBe("needs_review");
  const retry = requireJob(await beginCommand(token, command("retry")));
  await beginCommand(token, command("takeover"));
  await expect(commitResult(token, retry, result)).rejects.toMatchObject({ status: 409 });
  expect((await c(token)).facts.payments).toHaveLength(0);
});

test("model progress is saved without advancing a superseding run", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  const id = randomUUID(); await reserveLive(id, { token, job });
  const call = { id, inputTokens: 100, outputTokens: 10, usageKnown: true, latencyMs: 1, tools: [], role: "customer" };
  await startLive(call, { token, job });
  expect((await c(token)).run).toMatchObject({ activeCallId: id, activeRole: "customer", steps: [{ id, role: "customer", state: "started" }] });
  await recordLive(call, { token, job });
  expect((await c(token)).run).toMatchObject({ calls: 1, lastCompletedRole: "customer" });
  expect((await c(token)).run?.activeRole).toBeUndefined();
  await recordLive(call, { token, job });
  expect((await c(token)).run?.calls).toBe(1);
  await beginCommand(token, command("takeover"));
  expect((await c(token)).lastRun).toMatchObject({ id: job.id, outcome: "interrupted", calls: 1 });
  await expect(startLive(call, { token, job })).rejects.toMatchObject({ status: 409 });
  await recordLive(call, { token, job });
  expect((await c(token)).run).toBeNull();
});

test("runtime retains the dispatch and requested tools beyond the old six-call display window", async () => {
  const { token } = await createWorkspace(), job = requireJob(await beginCommand(token, command()));
  for (let i = 0; i < 7; i++) {
    const call = { id: randomUUID(), role: i === 0 ? "customer" : "account_resolution", inputTokens: 10, outputTokens: 2, usageKnown: true, latencyMs: 1, tools: i === 0 ? ["account_resolution"] : ["calculate_payment_proposal"] };
    await reserveLive(call.id, { token, job }); await startLive(call, { token, job }); await recordLive(call, { token, job });
  }
  await commitResult(token, job, approved()); await closeV2Pool();
  const runtime = (await c(token)).lastRun;
  expect(runtime?.calls).toBe(7); expect(runtime?.steps).toHaveLength(14);
  expect(runtime?.steps[0]).toMatchObject({ role: "customer", state: "started" });
  expect(runtime?.steps[1]).toMatchObject({ role: "customer", state: "completed", tools: ["account_resolution"] });
  expect(runtime?.steps.at(-1)?.tools).toEqual(["calculate_payment_proposal"]);
});

test("fresh cases seed one persisted opening without spending, customer turns or retryable work", async () => {
  const { token, view } = await createWorkspace();
  for (const state of Object.values(view.cases)) {
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ origin: "synthetic_opening", speaker: "agent", channel: "customer" });
    expect(state.messages[0].text).toContain(state.facts.invoiceId);
    expect(state.turns).toBe(0); expect(state.run).toBeNull();
  }
  await expect(beginCommand(token, command("retry"))).rejects.toMatchObject({ status: 409 });
  await closeV2Pool();
  expect((await c(token)).messages).toEqual(view.cases["late-payment"].messages);
  await readWorkspace(token);
  expect((await c(token)).messages).toHaveLength(1);
  expect((await budgetUsage()).calls).toBe(0);
  const reset = await resetWorkspace(token);
  expect(reset.cases["late-payment"].messages).toHaveLength(1);
  expect(reset.cases["late-payment"].revision).toBeGreaterThan(view.cases["late-payment"].revision);
});

test("untouched empty legacy cases receive one opener while started and stopped cases stay unchanged", async () => {
  const { token, view } = await createWorkspace();
  const empty = view.cases["late-payment"], started = view.cases["fresh-record"], stopped = view.cases["conflicting-payment"];
  empty.messages = [];
  started.turns = 1;
  started.messages = [{ id: "existing-message", channel: "customer", speaker: "customer", text: "Existing conversation", at: started.now }];
  stopped.messages = []; stopped.stopped = true; stopped.status = "stopped";
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases}',$1::jsonb)", [JSON.stringify(view.cases)]);
  const [a, b] = await Promise.all([readWorkspace(token), readWorkspace(token)]);
  expect(a.cases["late-payment"].messages).toHaveLength(1);
  expect(a.cases["late-payment"].messages[0]).toMatchObject({ origin: "synthetic_opening", speaker: "agent" });
  expect(b.cases["late-payment"].messages).toEqual(a.cases["late-payment"].messages);
  expect(a.cases["late-payment"].turns).toBe(0);
  expect(a.cases["fresh-record"].messages).toEqual(started.messages);
  expect(a.cases["conflicting-payment"].messages).toEqual([]);
  expect(a.expiresAt).toBe(view.expiresAt);
  expect((await budgetUsage()).calls).toBe(0);
});

test("latest runtime survives refresh, duplicates, rejected input and no-run controls until the next real run", async () => {
  const { token } = await createWorkspace(); const request = command();
  const job = requireJob(await beginCommand(token, request));
  const call = { id: randomUUID(), role: "reviewer", inputTokens: 10, outputTokens: 2, usageKnown: true, latencyMs: 1, tools: [] };
  await reserveLive(call.id, { token, job }); await startLive(call, { token, job }); await recordLive(call, { token, job });
  await commitResult(token, job, approved());
  await closeV2Pool();
  const saved = await c(token), runtime = saved.lastRun;
  expect(runtime).toMatchObject({ id: job.id, calls: 1, outcome: "completed", steps: [{ state: "started", role: "reviewer" }, { state: "completed", role: "reviewer" }] });
  expect(runtime?.durationMs).toBeGreaterThanOrEqual(0);
  expect(saved.audit.at(-1)?.runtime).toEqual(runtime);
  expect(await beginCommand(token, request)).toBeNull();
  await expect(beginCommand(token, command("customer", " "))).rejects.toMatchObject({ status: 400 });
  await beginCommand(token, command("takeover"));
  expect(await beginCommand(token, command("customer", "Save this for the operator"))).toBeNull();
  expect((await c(token)).lastRun).toEqual(runtime);
  await beginCommand(token, command("resume"));
  expect((await c(token)).lastRun).toEqual(runtime);
  const next = requireJob(await beginCommand(token, command("retry")));
  expect((await c(token)).lastRun).toBeUndefined();
  expect((await c(token)).audit.at(-1)?.runtime).toEqual(runtime);
  await failRun(token, job);
  expect((await c(token)).run?.id).toBe(next.id);
  await commitResult(token, next, { ...approved(), review: { accepted: false, reasons: ["Needs correction"] } });
  expect((await c(token)).lastRun).toMatchObject({ id: next.id, outcome: "blocked" });
});

test("business report persists without financial effects; a disputed report pauses replies until operator resume", async () => {
  const { token, job, result } = await recognitionJob();
  result.verification = { ...result.verification!, outcome: "business_reported", paymentDate: null, settlementStatus: "unknown", missingFacts: ["date", "settlement"] };
  result.resolution = null;
  result.draft = { reply: "The business reports $50 for INV-101. You may dispute this report.", needsOperator: false };
  await commitResult(token, job, result);
  expect((await c(token)).verification?.outcome).toBe("business_reported");
  expect((await c(token)).facts.balanceCents).toBe(12900);
  expect((await c(token)).facts.payments).toHaveLength(0);
  const dispute = requireJob(await beginCommand(token, command("customer", "I dispute the business report; I paid $129.")));
  await commitResult(token, dispute, { ...result, draft: { reply: "Your dispute is saved for operator review.", needsOperator: true } });
  expect((await c(token)).reviewHold).toBe(true);
  expect((await c(token)).status).toBe("needs_review");
  const before = await budgetUsage();
  expect(await beginCommand(token, command("customer", "Please review my receipt"))).toBeNull();
  expect(await beginCommand(token, command("retry"))).toBeNull();
  expect((await c(token)).messages.at(-1)?.text).toBe("Please review my receipt");
  expect((await c(token)).run).toBeNull();
  expect((await budgetUsage()).calls).toBe(before.calls);
  await beginCommand(token, command("resume"));
  expect((await c(token)).reviewHold).toBe(false);
  expect(await beginCommand(token, command("customer", "What did the operator decide?"))).not.toBeNull();
});

test("a conflicting amount keeps the business reply path open for clarification", async () => {
  const { token, job, result } = await recognitionJob();
  result.resolution = null;
  result.verification = { ...result.verification!, outcome: "conflicting", businessMessage: "Do the other original details apply to the $50?", settlementStatus: "unknown" };
  await commitResult(token, job, result);
  expect((await c(token)).status).toBe("awaiting_business");
  const followup = requireJob(await beginCommand(token, { ...command("business", "Yes, the other details are correct"), requestId: (await c(token)).requestId! }));
  expect(followup.input.messages.at(-1)?.disposition).toBeUndefined();
  expect((await c(token)).facts.balanceCents).toBe(12900);
});

test("interrupted runs become visible and failed runs retain raw input", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  await failRun(token, job);
  expect((await c(token)).status).toBe("run_failed");
  expect((await c(token)).messages.filter((m) => m.origin !== "synthetic_opening")).toHaveLength(1);
  expect((await c(token)).lastRun).toMatchObject({ id: job.id, outcome: "failed" });
  const retry = requireJob(await beginCommand(token, command("retry")));
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,run,startedAt}',to_jsonb((NOW()-INTERVAL '100 seconds')::text))");
  expect((await c(token)).status).toBe("run_failed");
  expect((await c(token)).lastRun).toMatchObject({ id: retry.id, outcome: "interrupted" });
  await expect(commitResult(token, retry, approved())).rejects.toMatchObject({ status: 409 });
});

test("provider failure details persist; legacy technical failures are recoverable without clearing real review holds", async () => {
  const { token } = await createWorkspace(); const job = requireJob(await beginCommand(token, command()));
  const failure = { kind: "quota", status: 429, code: "credit_balance_exhausted", message: "OpenAI account credits are exhausted." };
  await failRun(token, job, failure);
  expect((await c(token)).lastRun?.failure).toEqual(failure);
  expect((await c(token)).status).toBe("run_failed");
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,status}',$1::jsonb)", [JSON.stringify("needs_review")]);
  expect((await c(token)).status).toBe("run_failed");
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(jsonb_set(data,'{cases,late-payment,status}',$1::jsonb),'{cases,late-payment,reviewHold}','true'::jsonb)", [JSON.stringify("needs_review")]);
  expect((await c(token)).status).toBe("needs_review");
  expect((await c(token)).reviewHold).toBe(true);
  expect(await beginCommand(token, command("retry"))).toBeNull();
});

test("HTTP boundary rejects foreign origins, role injection, missing sessions and oversized bodies", async () => {
  const url = "http://localhost:3012/api/v2/workspace";
  const post = (value: unknown, origin = "http://localhost:3012") => handleV2(new Request(url, { method: "POST", headers: { host: "localhost:3012", origin, "Content-Type": "application/json" }, body: JSON.stringify(value) }));
  expect((await handleV2(new Request(url, { headers: { host: "localhost:3012" } }))).status).toBe(401);
  expect((await post({ action: "create" }, "https://foreign.test")).status).toBe(403);
  expect((await post({ ...command(), role: "maintainer" })).status).toBe(400);
  expect((await post({ action: "customer", text: "x".repeat(20_000) })).status).toBe(413);
  const created = await post({ action: "create" });
  expect(created.status).toBe(201);
  expect(created.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
  const cookie = created.headers.get("set-cookie")!.split(";")[0];
  expect((await handleV2(new Request(url, { headers: { host: "localhost:3012", cookie } }))).status).toBe(200);
});

test.each(["localhost:3012", "127.0.0.1:3012", "[::1]:3012"])("same-origin %s survives Next.js loopback URL normalization", async (host) => {
  const request = new NextRequest(`http://${host}/api/v2/workspace`, {
    method: "POST", headers: { host, origin: `http://${host}`, "Content-Type": "application/json" }, body: "{}",
  });
  expect(new URL(request.url).hostname).toBe("localhost");
  expect((await handleV2(request)).status).toBe(400);
});

test.each([
  { host: "127.0.0.1:3012", origin: "http://localhost:3012" },
  { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3013" },
  { host: "127.0.0.1:3012", origin: "https://127.0.0.1:3012" },
  { host: "127.0.0.1:3012", origin: "null" },
  { host: "127.0.0.1:3012" },
  { origin: "http://localhost:3012" },
  { host: "foreign.test", origin: "http://foreign.test" },
  { host: "localhost.foreign.test:3012", origin: "http://localhost.foreign.test:3012" },
  { host: "localhost:3012@foreign.test", origin: "http://foreign.test" },
  { host: "foreign.test", origin: "http://localhost:3012", "x-forwarded-host": "localhost:3012" },
])("HTTP boundary rejects mismatched or untrusted authority $host / $origin", async (headers) => {
  const request = new NextRequest("http://localhost:3012/api/v2/workspace", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" } as Record<string, string>, body: "{}",
  });
  expect((await handleV2(request)).status).toBe(403);
});


test("reviewed proposals persist with the reply/audit, without a promise, receipt, event or balance change", async () => {
  const { token } = await createWorkspace();
  const request = command("customer", "Can I use cash in two installments starting tomorrow?");
  const job = requireJob(await beginCommand(token, request));
  const proposal = calculateProposal(job.input.facts, job.input.now, { method: "cash", count: 2, firstDate: localDate(new Date(job.input.now), "America/Denver", 1), sourceMessageId: request.id });
  const result = approved("Here is a two-installment cash proposal. It is not agreed and no payment was received.");
  result.resolution = { summary: "Calculated proposal only", needsOperator: false, updates: [proposal] };
  await commitResult(token, job, result);
  expect(await beginCommand(token, request)).toBeNull();
  await closeV2Pool();
  const saved = await c(token);
  expect(saved.updates).toEqual([proposal]); expect(saved.facts).toEqual(job.input.facts);
  expect(saved.events).toEqual([]); expect(saved.status).toBe("ready"); expect(saved.reviewHold).toBe(false);
  expect(saved.messages.at(-1)?.text).toBe(result.draft.reply);
  expect(saved.audit.at(-1)).toMatchObject({ after: [proposal], balanceBeforeCents: 12900, balanceAfterCents: 12900, sourceVersion: job.input.facts.sourceVersion, roleVersion: ROLE_VERSION });
  expect((await readWorkspace(token)).cases["cedar-late-payment"].updates).toEqual([]);
  expect((await c((await createWorkspace()).token)).updates).toEqual([]);
});

test.each(["rejected-review", "forged-amount", "foreign-policy", "stale-source", "foreign-customer", "future-date"])("%s proposal cannot publish terms even with a fabricated positive review", async (kind) => {
  const { token } = await createWorkspace();
  const request = command("customer", "Please propose two installments tomorrow"), job = requireJob(await beginCommand(token, request));
  const proposal = calculateProposal(job.input.facts, job.input.now, { method: "card", count: 2, firstDate: localDate(new Date(job.input.now), "America/Denver", 1), sourceMessageId: request.id });
  const result = approved("Here is the proposed schedule, not an agreement.");
  if (kind === "rejected-review") result.review = { accepted: false, reasons: ["Not supported"] };
  if (kind === "forged-amount") proposal.schedule[0].amountCents = 1;
  if (kind === "foreign-policy") proposal.policyVersion = "cedar-options-2";
  if (kind === "stale-source") proposal.sourceVersion = "outdated";
  if (kind === "foreign-customer") proposal.sourceMessageId = randomUUID();
  if (kind === "future-date") { proposal.firstDate = localDate(new Date(job.input.now), "America/Denver", 31); proposal.schedule[0].date = proposal.firstDate; }
  result.resolution = { summary: "Proposal", needsOperator: false, updates: [proposal] };
  if (kind === "rejected-review") await commitResult(token, job, result);
  else await expect(commitResult(token, job, result)).rejects.toThrow();
  const saved = await c(token);
  expect(saved.updates).toEqual([]); expect(saved.facts).toEqual(job.input.facts);
  expect(saved.messages.filter((m) => m.speaker === "agent" && m.origin !== "synthetic_opening")).toEqual([]);
});

test.each(["stop", "takeover", "new-input", "reset", "expired"])("%s blocks an in-flight proposal without recording terms or receipts", async (interruption) => {
  const { token } = await createWorkspace();
  const request = command("customer", "Can I pay in installments?"), job = requireJob(await beginCommand(token, request));
  const proposal = calculateProposal(job.input.facts, job.input.now, { method: "card", count: 2, firstDate: localDate(new Date(job.input.now), "America/Denver", 1), sourceMessageId: request.id });
  const result = approved("Proposed only"); result.resolution = { summary: "Proposal", needsOperator: false, updates: [proposal] };
  if (interruption === "stop") await beginCommand(token, command("customer", "STOP"));
  if (interruption === "takeover") await beginCommand(token, command("takeover"));
  if (interruption === "new-input") await beginCommand(token, command("customer", "Actually I disagree with the balance"));
  if (interruption === "reset") await resetWorkspace(token);
  if (interruption === "expired") await v2Pool().query("UPDATE rebuild_v2.workspaces SET expires_at=now()-interval '1 second'");
  await expect(commitResult(token, job, result)).rejects.toMatchObject({ status: interruption === "expired" ? 410 : 409 });
  if (interruption !== "expired") { const saved = await c(token); expect(saved.updates).toEqual([]); expect(saved.facts.payments).toEqual([]); }
});


async function paymentCase(method: "card" | "cash" = "card", tomorrow = false) {
  const { token } = await createWorkspace();
  const request = command("customer", "Please offer two monthly payments starting today"), job = requireJob(await beginCommand(token, request));
  const proposal = calculateProposal(job.input.facts, job.input.now, { method, count: 2, firstDate: localDate(new Date(job.input.now), "America/Denver", tomorrow ? 1 : 0), sourceMessageId: request.id });
  const result = approved("Here is a proposal, not a payment."); result.resolution = { summary: "Calculated terms", needsOperator: false, updates: [proposal] };
  await commitResult(token, job, result);
  return { token, proposal };
}
async function confirmedPaymentCase(method: "card" | "cash" = "card", tomorrow = false) {
  const scenario = await paymentCase(method, tomorrow), before = await c(scenario.token);
  const confirm = { id: randomUUID(), caseId: "late-payment", action: "confirm_plan" as const, revision: before.revision, proposal: scenario.proposal };
  const job = requireJob(await beginCommand(scenario.token, confirm));
  await commitResult(scenario.token, job, approved("Your simulated plan is confirmed. No payment was received."));
  return { ...scenario, confirm };
}

async function reconciliationCase(outcome: "pending" | "unknown" = "unknown") {
  const { token } = await confirmedPaymentCase();
  const job = requireJob(await beginCommand(token, await payCommand(token, outcome)));
  await commitResult(token, job, approved("Operator reconciliation is required; no receipt saved."));
  await beginCommand(token, command("takeover"));
  const state = await c(token);
  const value = { id: randomUUID(), caseId: "late-payment", action: "reconcile_payment" as const, revision: state.revision, operationId: state.operations![0].id, outcome: "succeeded" as const, note: "Checked synthetic settlement evidence for this exact attempt.", evidenceReference: "settlement-demo" };
  return { token, state, value };
}

async function operatorRecognitionCase() {
  const { token } = await createWorkspace(), caseId = "cedar-late-payment";
  const claim = requireJob(await beginCommand(token, { ...command("customer", "I paid $50 today for CED-201"), caseId }));
  const date = localDate(new Date(claim.input.now), "America/Denver");
  const pending: Verification = { ...verification, claimMessageId: claim.id, amountCents: 5000, invoiceId: "CED-201", paymentDate: date, businessMessage: `Did $50 settle today ${date} for CED-201?` };
  await commitResult(token, claim, { ...approved("Checking the business"), paymentClaim: scriptedClaim(claim.input, { amountCents: pending.amountCents, date: pending.paymentDate }), verification: pending });
  const requestId = (await readWorkspace(token)).cases[caseId].requestId!;
  const reply = requireJob(await beginCommand(token, { ...command("business", "Yes"), caseId, requestId }));
  await commitResult(token, reply, { ...approved("Business confirmation needs operator approval before the balance changes."), draft: { reply: "The business confirms $50; an operator must approve recording it.", needsOperator: true }, verification: { ...pending, outcome: "business_confirmed", businessMessage: null, settlementStatus: "settled", missingFacts: [] } });
  await beginCommand(token, { ...command("takeover"), caseId });
  const state = (await readWorkspace(token)).cases[caseId];
  const value = { id: randomUUID(), caseId, action: "approve_recognition" as const, revision: state.revision, targetAuditId: state.audit.at(-1)!.id, note: "Reviewed the linked business confirmation against this invoice.", evidenceReference: "operator-review-demo" };
  return { token, state, value };
}

test.each(["pending", "unknown"] as const)("operator reconciles %s once, preserving original history and a single durable receipt", async (prior) => {
  const { token, state, value } = await reconciliationCase(prior);
  const writes = await Promise.all([beginCommand(token, value), beginCommand(token, value)]);
  expect(writes).toEqual([null, null]); await closeV2Pool();
  let saved = await c(token);
  expect(saved.operations).toEqual(state.operations); expect(saved.financialDecisions).toHaveLength(1);
  expect(saved.financialDecisions![0]).toMatchObject({ targetId: value.operationId, outcome: "succeeded", balanceBeforeCents: 12900, balanceAfterCents: 6450 });
  expect(saved.facts.payments).toHaveLength(1); expect(saved.facts.payments[0]).toMatchObject({ decisionId: value.id, operationId: value.operationId, provenance: "operator_decision" });
  expect(saved).toMatchObject({ takeover: true, status: "taken_over", turns: state.turns, lastRun: state.lastRun, messages: state.messages });
  expect((await budgetUsage()).calls).toBe(0);
  await expect(beginCommand(token, { ...value, id: randomUUID(), revision: saved.revision })).rejects.toThrow("unresolved");
  await expect(beginCommand(token, { ...value, outcome: "failed" })).rejects.toThrow("different content");
  await beginCommand(token, command("resume"));
  const retry = requireJob(await beginCommand(token, command("retry")));
  expect(retry.input.financialDecisions![0].id).toBe(value.id); expect(retry.input.paymentAction).toEqual({ kind: "financial_decided", id: value.id });
  await failRun(token, retry, { kind: "connection", message: "Scripted explanation failure" });
  expect((await c(token)).facts.payments).toHaveLength(1);
  const again = requireJob(await beginCommand(token, command("retry")));
  await commitResult(token, again, approved("The operator recorded $64.50; $64.50 remains."));
  saved = await c(token); expect(saved.reviewHold).toBe(false); expect(saved.facts.balanceCents).toBe(6450);
  expect(saved.audit.at(-1)?.paymentAction).toEqual({ kind: "financial_decided", id: value.id });
  await expect(beginCommand(token, await payCommand(token))).rejects.toThrow("future payments");
});

test("not-settled reconciliation permits only a later explicit new attempt, never an implicit retry", async () => {
  const { token, value } = await reconciliationCase();
  await beginCommand(token, { ...value, outcome: "failed" });
  let saved = await c(token); expect(saved.facts.balanceCents).toBe(12900); expect(saved.facts.payments).toEqual([]);
  await beginCommand(token, command("resume"));
  const pay = requireJob(await beginCommand(token, await payCommand(token)));
  await commitResult(token, pay, approved("A distinct explicit simulated payment succeeded."));
  saved = await c(token); expect(saved.operations?.map((op) => op.outcome)).toEqual(["unknown", "succeeded"]);
  expect(saved.facts.payments).toHaveLength(1); expect(saved.facts.balanceCents).toBe(6450);
});

test("Cedar operator recognition uses reviewed business evidence, saves no new charge and survives explicit explanation", async () => {
  const { token, state, value } = await operatorRecognitionCase();
  expect(await beginCommand(token, value)).toBeNull();
  const saved = (await readWorkspace(token)).cases[value.caseId];
  expect(saved.facts.balanceCents).toBe(13500); expect(saved.facts.recognitionPolicy).toBe("operator_review");
  expect(saved.financialDecisions![0]).toMatchObject({ kind: "recognition_approved", targetId: value.targetAuditId, balanceBeforeCents: 18500, balanceAfterCents: 13500 });
  expect(saved.facts.payments[0]).toMatchObject({ provenance: "operator_decision", requestId: state.requestId, decisionId: value.id });
  expect(saved.operations).toBeUndefined(); expect(saved.messages).toEqual(state.messages); expect(saved.audit).toEqual(state.audit);
  expect((await c(token)).facts.balanceCents).toBe(12900);
  await expect(beginCommand(token, { ...value, id: randomUUID(), revision: saved.revision })).rejects.toThrow();
  await beginCommand(token, { ...command("resume"), caseId: value.caseId });
  const retry = requireJob(await beginCommand(token, { ...command("retry"), caseId: value.caseId }));
  await commitResult(token, retry, { ...approved("The operator recorded the business-confirmed $50; $135 remains."), verification: saved.verification });
  expect((await readWorkspace(token)).cases[value.caseId].facts.payments).toHaveLength(1);
});

test.each(["not-taken-over", "stale", "stopped", "foreign-operation", "changed-source", "reset", "expired"])("%s operator reconciliation cannot mutate the ledger", async (kind) => {
  const { token, state, value } = await reconciliationCase();
  if (kind === "not-taken-over") await beginCommand(token, command("resume"));
  if (kind === "stale") value.revision--;
  if (kind === "stopped") await beginCommand(token, command("customer", "STOP"));
  if (kind === "foreign-operation") value.operationId = randomUUID();
  if (kind === "changed-source") await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,facts,sourceVersion}',to_jsonb($1::text))", ["changed"]);
  if (kind === "reset") await resetWorkspace(token);
  if (kind === "expired") await v2Pool().query("UPDATE rebuild_v2.workspaces SET expires_at=NOW()-INTERVAL '1 second'");
  await expect(beginCommand(token, value)).rejects.toThrow();
  if (kind !== "expired") { const saved = await c(token); expect(saved.facts.balanceCents).toBe(state.facts.balanceCents); expect(saved.facts.payments).toEqual([]); expect(saved.financialDecisions).toBeUndefined(); }
});

test.each(["new-message", "foreign-audit", "rejected-review", "incomplete-evidence"])("%s cannot authorize operator recognition", async (kind) => {
  const { token, value } = await operatorRecognitionCase();
  if (kind === "new-message") { await beginCommand(token, { ...command("customer", "That confirmation is incorrect"), caseId: value.caseId }); value.revision = (await readWorkspace(token)).cases[value.caseId].revision; }
  if (kind === "foreign-audit") value.targetAuditId = randomUUID();
  if (kind === "rejected-review") await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,cedar-late-payment,lastReview,review,accepted}','false')");
  if (kind === "incomplete-evidence") await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,cedar-late-payment,verification,outcome}',to_jsonb($1::text))", ["pending"]);
  await expect(beginCommand(token, value)).rejects.toThrow();
  const saved = (await readWorkspace(token)).cases[value.caseId]; expect(saved.facts.balanceCents).toBe(18500); expect(saved.facts.payments).toEqual([]);
});

test("different concurrent reconciliation IDs cannot settle the same attempt twice", async () => {
  const { token, value } = await reconciliationCase();
  const results = await Promise.allSettled([beginCommand(token, value), beginCommand(token, { ...value, id: randomUUID() })]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const saved = await c(token); expect(saved.financialDecisions).toHaveLength(1); expect(saved.facts.payments).toHaveLength(1); expect(saved.facts.balanceCents).toBe(6450);
});

test.each(["rejected", "unsafe"])("%s explanation cannot undo or replay an operator receipt", async (kind) => {
  const { token, value } = await reconciliationCase(); await beginCommand(token, value); await beginCommand(token, command("resume"));
  const job = requireJob(await beginCommand(token, command("retry"))), result = approved("Incorrect explanation");
  if (kind === "rejected") { result.review = { accepted: false, reasons: ["Wrong outcome"] }; await commitResult(token, job, result); }
  else {
    result.resolution = { summary: "Replay a payment offer", needsOperator: false, updates: [job.input.agreements![0].proposal] };
    await expect(commitResult(token, job, result)).rejects.toThrow("assessment cannot");
  }
  const saved = await c(token); expect(saved.facts.balanceCents).toBe(6450); expect(saved.facts.payments).toHaveLength(1); expect(saved.messages.at(-1)?.text).not.toBe(result.draft.reply);
});

test("financial HTTP actions need the scoped session/origin and save without model credentials or calls", async () => {
  const { token, value } = await reconciliationCase(), other = await createWorkspace();
  const config = vi.spyOn(store, "v2Config").mockReturnValue({ databaseUrl: "postgresql://unused", apiKey: undefined });
  const request = (session: string, origin = "http://127.0.0.1:3012", data: unknown = value) => handleV2(new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin, cookie: `recovery_v2=${session}`, "content-type": "application/json" }, body: JSON.stringify(data) }));
  try {
    expect((await request(token, "https://foreign.test")).status).toBe(403);
    expect((await request(other.token)).status).toBe(409);
    expect((await request(token, undefined, { ...value, amountCents: 1 })).status).toBe(400);
    expect((await c(token)).facts.payments).toEqual([]);
    expect((await request(token)).status).toBe(200); expect((await request(token)).status).toBe(200);
    expect((await c(token)).facts.payments).toHaveLength(1); expect((await budgetUsage()).calls).toBe(0);
  } finally { config.mockRestore(); }
});

test("operator credit and extension decisions are audited without inventing recovered money", async () => {
  const { token, original } = await correctionCase(); await beginCommand(token, command("takeover"));
  let state = await c(token);
  const credit = { id: randomUUID(), caseId: "late-payment", action: "approve_credit" as const, targetAuditId: original.audit.at(-1)!.id, revision: state.revision, amountCents: 1000, note: "Reviewed and approved a synthetic customer credit.", evidenceReference: "credit-demo" };
  await beginCommand(token, credit); expect(await beginCommand(token, credit)).toBeNull(); state = await c(token);
  expect(state.facts.balanceCents).toBe(11900); expect(state.facts.payments).toEqual([]); expect(state.financialDecisions![0].kind).toBe("credit_approved");
  await expect(beginCommand(token, { ...credit, id: randomUUID(), revision: state.revision })).rejects.toThrow("latest reviewed evidence and source");
  await beginCommand(token, command("resume")); const job = requireJob(await beginCommand(token, command("customer", "May I have until tomorrow?")));
  const result = approved("Your extension request is recorded for review."); result.resolution = { summary: "Extension requested", needsOperator: true, updates: [{ kind: "extension_requested", sourceMessageId: job.id, date: localDate(new Date(job.input.now), "America/Denver", 1) }] };
  await commitResult(token, job, result); await beginCommand(token, command("takeover")); state = await c(token);
  await beginCommand(token, { id: randomUUID(), caseId: "late-payment", action: "approve_extension", revision: state.revision, sourceMessageId: job.id, note: "Approved this exact synthetic extension request.", evidenceReference: "extension-demo" });
  const saved = await c(token); expect(saved.financialDecisions?.map((d) => d.kind)).toEqual(["credit_approved", "extension_approved"]); expect(saved.facts.balanceCents).toBe(11900); expect(saved.facts.payments).toEqual([]);
});

test("receipt reversal restores balance exactly once and leaves the original operation and receipt trace", async () => {
  const { token } = await confirmedPaymentCase(), job = requireJob(await beginCommand(token, await payCommand(token)));
  await commitResult(token, job, approved("Receipt saved.")); await beginCommand(token, command("takeover")); const before = await c(token);
  const value = { id: randomUUID(), caseId: "late-payment", action: "reverse_receipt" as const, revision: before.revision, receiptId: before.facts.payments[0].id, note: "Corrected this mistaken synthetic receipt with compensating entry.", evidenceReference: "reversal-demo" };
  await beginCommand(token, value); await closeV2Pool(); const saved = await c(token);
  expect(saved.facts.balanceCents).toBe(12900); expect(saved.operations).toEqual(before.operations); expect(saved.facts.payments[0]).toMatchObject({ id: value.receiptId, reversedBy: value.id });
  expect(saved.financialDecisions![0]).toMatchObject({ kind: "receipt_reversed", balanceBeforeCents: 6450, balanceAfterCents: 12900 });
  await expect(beginCommand(token, { ...value, id: randomUUID(), revision: saved.revision })).rejects.toThrow("unreversed local");
});

test("a source pending payment has separate operator settlement without altering another business", async () => {
  const { token } = await createWorkspace(), caseId = "pending-payment"; await beginCommand(token, { ...command("takeover"), caseId });
  const before = (await readWorkspace(token)).cases[caseId];
  await beginCommand(token, { id: randomUUID(), caseId, action: "reconcile_record", revision: before.revision, paymentId: before.facts.payments[0].id, outcome: "succeeded", note: "Verified the synthetic source payment has settled.", evidenceReference: "source-settlement" });
  const saved = await readWorkspace(token); expect(saved.cases[caseId].facts.balanceCents).toBe(0); expect(saved.cases[caseId].facts.payments).toHaveLength(2); expect(saved.cases["cedar-pending-payment"].facts.balanceCents).toBe(16000);
});
const payCommand = async (token: string, outcome: "succeeded" | "failed" | "pending" | "unknown" = "succeeded") => {
  const state = await c(token);
  return { id: randomUUID(), caseId: "late-payment", action: "simulate_payment" as const, revision: state.revision, agreementId: state.agreements!.at(-1)!.id, outcome };
};

test("confirmed terms persist with reviewed linkage; chat yes alone cannot confirm, pay or consume a turn for a control", async () => {
  const { token, proposal } = await paymentCase();
  const chat = requireJob(await beginCommand(token, command("customer", "Yes, go ahead")));
  await commitResult(token, chat, approved("Use the displayed confirmation control to proceed."));
  expect((await c(token)).agreements).toBeUndefined(); expect((await c(token)).facts.balanceCents).toBe(12900);
  const before = await c(token), confirm = { id: randomUUID(), caseId: "late-payment", action: "confirm_plan" as const, revision: before.revision, proposal };
  const job = requireJob(await beginCommand(token, confirm));
  expect(job.input.paymentAction).toEqual({ kind: "agreement_confirmed", id: confirm.id });
  await commitResult(token, job, approved("Plan confirmed, with no payment received.")); await closeV2Pool();
  const saved = await c(token);
  expect(saved.turns).toBe(before.turns); expect(saved.agreements).toHaveLength(1); expect(saved.operations).toBeUndefined();
  expect(saved.agreements![0]).toMatchObject({ id: confirm.id, proposal, proposalAuditId: saved.audit[0].id });
  expect(saved.facts.balanceCents).toBe(12900); expect(saved.audit.at(-1)?.paymentAction?.id).toBe(confirm.id);
  expect(await beginCommand(token, confirm)).toBeNull();
});

test.each(["succeeded", "failed", "pending", "unknown"] as const)("%s payment commits once, survives model failure and is not replayed by an explanation retry", async (outcome) => {
  const { token } = await confirmedPaymentCase(), value = await payCommand(token, outcome);
  const job = requireJob(await beginCommand(token, value));
  const balance = outcome === "succeeded" ? 6450 : 12900;
  expect((await c(token)).facts.balanceCents).toBe(balance);
  await failRun(token, job, { kind: "connection", message: "Scripted explanation failure" }); await closeV2Pool();
  let saved = await c(token);
  expect(saved.operations).toHaveLength(1); expect(saved.operations![0].outcome).toBe(outcome);
  expect(saved.facts.payments).toHaveLength(outcome === "succeeded" ? 1 : 0);
  expect(await beginCommand(token, value)).toBeNull();
  const retry = requireJob(await beginCommand(token, command("retry")));
  expect(retry.input.operations).toEqual(saved.operations); expect(retry.input.paymentAction).toEqual({ kind: "payment_attempted", id: value.id });
  await commitResult(token, retry, approved(`Saved simulation outcome: ${outcome}; no retry of the payment.`));
  saved = await c(token);
  expect(saved.operations).toHaveLength(1); expect(saved.facts.balanceCents).toBe(balance);
  expect(saved.reviewHold).toBe(outcome === "pending" || outcome === "unknown");
});

test("concurrent payment clicks cannot create duplicate receipts or apply the next installment early", async () => {
  const { token } = await confirmedPaymentCase(), value = await payCommand(token);
  const jobs = await Promise.all([beginCommand(token, value), beginCommand(token, value)]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  await commitResult(token, requireJob(jobs.find(Boolean)!), approved("Simulated receipt saved; $64.50 remains."));
  await expect(beginCommand(token, { ...value, id: randomUUID() })).rejects.toMatchObject({ status: 409 });
  await expect(beginCommand(token, { ...value, outcome: "failed" })).rejects.toMatchObject({ status: 409 });
  await expect(beginCommand(token, await payCommand(token))).rejects.toThrow("future payments");
  expect((await c(token)).facts.payments).toHaveLength(1); expect((await c(token)).operations).toHaveLength(1);
});

test.each(["pending", "unknown"] as const)("%s results cannot be relabelled as success by resuming, a new UUID, or another confirmation", async (outcome) => {
  const { token, proposal } = await confirmedPaymentCase(), job = requireJob(await beginCommand(token, await payCommand(token, outcome)));
  await commitResult(token, job, approved("Operator reconciliation is required."));
  await beginCommand(token, command("resume"));
  await expect(beginCommand(token, await payCommand(token))).rejects.toThrow("reconciliation");
  await expect(beginCommand(token, { id: randomUUID(), caseId: "late-payment", action: "confirm_plan", revision: (await c(token)).revision, proposal })).rejects.toThrow("reconciliation");
  expect((await c(token)).facts.balanceCents).toBe(12900); expect((await c(token)).operations).toHaveLength(1);
});

test("a known failed attempt can receive a distinct explicit retry, without treating failure as a receipt", async () => {
  const { token } = await confirmedPaymentCase(), failed = requireJob(await beginCommand(token, await payCommand(token, "failed")));
  await commitResult(token, failed, approved("The simulation failed; no receipt or balance reduction."));
  const retry = requireJob(await beginCommand(token, await payCommand(token)));
  await commitResult(token, retry, approved("The new explicit simulation succeeded."));
  const saved = await c(token);
  expect(saved.operations?.map((op) => op.outcome)).toEqual(["failed", "succeeded"]);
  expect(saved.facts.payments).toHaveLength(1); expect(saved.facts.balanceCents).toBe(6450);
});

test.each(["forged", "stale-revision", "unreviewed", "old-policy", "foreign-case"])("%s confirmation cannot grant financial authority", async (kind) => {
  const { token, proposal } = await paymentCase(), before = await c(token);
  if (kind === "unreviewed") await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,audit}','[]')");
  const value = { id: randomUUID(), caseId: kind === "foreign-case" ? "fresh-record" : "late-payment", action: "confirm_plan" as const, revision: kind === "stale-revision" ? before.revision - 1 : before.revision, proposal: { ...proposal } };
  if (kind === "forged") value.proposal.schedule = [{ ...proposal.schedule[0], amountCents: 1 }, proposal.schedule[1]];
  if (kind === "old-policy") value.proposal.policyVersion = "northside-options-1";
  await expect(beginCommand(token, value)).rejects.toMatchObject({ status: 409 });
  expect((await c(token)).agreements).toBeUndefined(); expect((await c(token)).facts.balanceCents).toBe(12900);
});

test.each(["cash", "future", "stale-source", "foreign-agreement", "stop", "takeover", "expired", "reset"])("%s blocks payment before any simulated receipt", async (kind) => {
  const { token } = await confirmedPaymentCase(kind === "cash" ? "cash" : "card", kind === "future"), value = await payCommand(token);
  if (kind === "stale-source") await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(data,'{cases,late-payment,facts,sourceVersion}',$1::jsonb)", [JSON.stringify("changed-source")]);
  if (kind === "foreign-agreement") value.agreementId = randomUUID();
  if (kind === "stop") await beginCommand(token, command("customer", "STOP"));
  if (kind === "takeover") await beginCommand(token, command("takeover"));
  if (kind === "expired") await v2Pool().query("UPDATE rebuild_v2.workspaces SET expires_at=now()-interval '1 second'");
  if (kind === "reset") await resetWorkspace(token);
  await expect(beginCommand(token, value)).rejects.toMatchObject({ status: kind === "expired" ? 410 : 409 });
  if (kind !== "expired") { const saved = await c(token); expect(saved.operations ?? []).toEqual([]); expect(saved.facts.payments).toEqual([]); }
});

test("proposal deduplication survives PostgreSQL JSON key ordering across a reviewed retry", async () => {
  const { token, proposal } = await paymentCase(), job = requireJob(await beginCommand(token, command("retry")));
  const result = approved("The same offer is retained."); result.resolution = { summary: "Same proposal", needsOperator: false, updates: [proposal] };
  await commitResult(token, job, result);
  expect((await c(token)).updates).toHaveLength(1);
});

test("HTTP explanation configuration failure preserves the already-committed receipt and returns an honest retry message", async () => {
  const { token } = await confirmedPaymentCase(), value = await payCommand(token);
  const config = vi.spyOn(store, "v2Config").mockReturnValue({ databaseUrl: "postgresql://unused", apiKey: undefined });
  try {
    const response = await handleV2(new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012", cookie: `recovery_v2=${token}`, "content-type": "application/json" }, body: JSON.stringify(value) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("simulated action is already saved");
    expect((await c(token)).facts.balanceCents).toBe(6450); expect((await c(token)).operations).toHaveLength(1);
    expect((await budgetUsage()).calls).toBe(0);
    const duplicate = await handleV2(new NextRequest("http://127.0.0.1:3012/api/v2/workspace", { method: "POST", headers: { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012", cookie: `recovery_v2=${token}`, "content-type": "application/json" }, body: JSON.stringify(value) }));
    expect(duplicate.status).toBe(200); expect((await c(token)).facts.payments).toHaveLength(1);
  } finally { config.mockRestore(); }
});

test("a rejected assessment or attempted financial replay cannot undo a committed simulated receipt", async () => {
  const { token, proposal } = await confirmedPaymentCase(), value = await payCommand(token);
  const job = requireJob(await beginCommand(token, value));
  const unsafe = approved("Replay the payment"); unsafe.resolution = { summary: "Another offer during assessment", needsOperator: false, updates: [proposal] };
  await expect(commitResult(token, job, unsafe)).rejects.toThrow("assessment cannot");
  expect((await c(token)).facts.balanceCents).toBe(6450); expect((await c(token)).facts.payments).toHaveLength(1);
  const rejected = approved("Unpublished wrong explanation"); rejected.review = { accepted: false, reasons: ["Incorrect outcome"] };
  await commitResult(token, job, rejected);
  const saved = await c(token);
  expect(saved.operations).toHaveLength(1); expect(saved.facts.balanceCents).toBe(6450);
  expect(saved.messages.at(-1)?.text).not.toBe(rejected.draft.reply); expect(saved.status).toBe("needs_review");
});

test("unresolved business evidence blocks confirmation rather than reclassifying old money", async () => {
  const { token, proposal } = await paymentCase();
  await v2Pool().query("UPDATE rebuild_v2.workspaces SET data=jsonb_set(jsonb_set(data,'{cases,late-payment,verification}',$1::jsonb),'{cases,late-payment,requestId}',$2::jsonb)", [JSON.stringify({ ...verification, claimMessageId: proposal.sourceMessageId }), JSON.stringify(randomUUID())]);
  await expect(beginCommand(token, { id: randomUUID(), caseId: "late-payment", action: "confirm_plan", revision: (await c(token)).revision, proposal })).rejects.toThrow("business payment evidence");
  expect((await c(token)).agreements).toBeUndefined(); expect((await c(token)).facts.payments).toEqual([]);
});
