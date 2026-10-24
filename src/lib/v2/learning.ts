import { z } from "zod";
import type { Activity, CaseFacts, InvestigationResult, Message } from "./contracts";

export const LEARNING_VERSION = "learning-1";
export const EVALUATION_VERSION = "learning-evals-2";
const Role = z.enum(["customer", "business_verification", "account_resolution", "reviewer"]);
const Identity = { id: z.uuid() }, Revision = z.number().int().nonnegative();
const Decision = { learningRevision: Revision, candidateId: z.uuid(), note: z.string().trim().min(10).max(1200) };
export const LearningCommand = z.discriminatedUnion("action", [
  z.object({ ...Identity, action: z.literal("propose_lesson"), caseId: z.string().regex(/^[a-z-]{1,60}$/), revision: Revision, targetAuditId: z.uuid(), targetRole: Role, scope: z.enum(["scenario", "business"]), correctionId: z.uuid().optional() }).strict(),
  z.object({ ...Identity, action: z.literal("evaluate_lesson"), learningRevision: Revision, candidateId: z.uuid() }).strict(),
  z.object({ ...Identity, action: z.enum(["activate_lesson", "reject_lesson", "rollback_lesson"]), ...Decision }).strict(),
]);
export type LearningCommand = z.infer<typeof LearningCommand>;
export const ProposedLesson = z.object({ reusable: z.boolean(), diagnosis: z.enum(["instructions", "routing", "review", "data", "tool"]), focus: z.enum(["invoice_clarity", "contact_preference", "verification_handoff", "payment_truthfulness"]), rationale: z.string().min(10).max(1200), instruction: z.string().trim().min(10).max(600).nullable() }).strict();
export type ProposedLesson = z.infer<typeof ProposedLesson>;
export type LessonScope = { businessId: string; role: Activity["role"]; scenario: CaseFacts["scenario"] | null };
export type LessonInstruction = LessonScope & { id: string; instruction: string; baseVersion: string };
export type LearningEvidence = { facts: CaseFacts; messages: Message[]; result: InvestigationResult; feedback: string; targetRole: Activity["role"] };
export type EvaluationRow = { id: string; category: "target" | "regression" | "safety"; baselinePassed: boolean; candidatePassed: boolean; baselineCalls: number; candidateCalls: number; baseline: unknown; candidate: unknown; error?: string };
export type LearningEvaluation = { version: string; model: string; provenance: "live" | "scripted"; at: string; baseCandidateId: string | null; rows: EvaluationRow[]; eligible: boolean; reason: string; calls: number };
export const LearningEvaluationSchema = z.object({ version: z.literal(EVALUATION_VERSION), model: z.string().min(1).max(80), provenance: z.enum(["live", "scripted"]), at: z.iso.datetime({ offset: true }), baseCandidateId: z.uuid().nullable(), rows: z.array(z.object({ id: z.string().min(1).max(80), category: z.enum(["target", "regression", "safety"]), baselinePassed: z.boolean(), candidatePassed: z.boolean(), baselineCalls: z.number().int().min(0).max(32), candidateCalls: z.number().int().min(0).max(32), baseline: z.unknown(), candidate: z.unknown(), error: z.string().max(200).optional() }).strict()).max(5), eligible: z.boolean(), reason: z.string().max(500), calls: z.number().int().min(0).max(33) }).strict();
export type LearningCandidate = {
  id: string; scope: LessonScope; sourceCaseId: string; sourceAuditId: string; sourceRevision: number; correctionId?: string;
  baseVersion: string; sourceRoleVersion: string; baseCandidateId: string | null; createdAt: string; updatedAt: string; evidence: LearningEvidence;
  status: "proposing" | "ready" | "evaluating" | "evaluated" | "active" | "rejected" | "failed";
  proposal?: ProposedLesson; evaluation?: LearningEvaluation; evaluationHistory?: LearningEvaluation[]; error?: string;
};
export type LearningState = {
  revision: number; candidates: LearningCandidate[]; calls: number;
  active: { scope: LessonScope; candidateId: string }[];
  history: { id: string; action: "activate_lesson" | "reject_lesson" | "rollback_lesson"; candidateId: string; before: string | null; after: string | null; at: string; note: string }[];
  commands: { id: string; fingerprint: string }[];
};
export type LearningJob = { id: string; kind: "propose" | "evaluate"; candidate: LearningCandidate; baseline: LessonInstruction[] };
export const emptyLearning = (): LearningState => ({ revision: 0, candidates: [], calls: 0, active: [], history: [], commands: [] });
export const sameScope = (a: LessonScope, b: LessonScope) => a.businessId === b.businessId && a.role === b.role && a.scenario === b.scenario;
export function activeLessons(state: LearningState | undefined, facts: Pick<CaseFacts, "businessId" | "scenario">): LessonInstruction[] {
  if (!state) return [];
  return Role.options.flatMap((role) => {
    const matches = state.active.filter((a) => a.scope.role === role && a.scope.businessId === facts.businessId && (a.scope.scenario === null || a.scope.scenario === facts.scenario));
    const active = matches.find((a) => a.scope.scenario === facts.scenario) ?? matches.find((a) => a.scope.scenario === null);
    const candidate = state.candidates.find((c) => c.id === active?.candidateId);
    return candidate?.proposal?.instruction ? [{ ...candidate.scope, id: candidate.id, instruction: candidate.proposal.instruction, baseVersion: candidate.baseVersion }] : [];
  });
}
export function baselineCandidate(state: LearningState, scope: LessonScope): string | null {
  const facts = { businessId: scope.businessId, ...(scope.scenario ? { scenario: scope.scenario } : {}) };
  return activeLessons(state, facts).find((l) => l.role === scope.role)?.id ?? null;
}
export function unsafeLesson(proposal: ProposedLesson): string | null {
  if (!proposal.reusable || ["data", "tool"].includes(proposal.diagnosis) || !proposal.instruction) return "Data/tool repair is not a reusable runtime instruction.";
  if (/\b(?:bypass|disable|ignore|override|remove)\b.{0,55}\b(?:guard|review|permission|budget|consent|stop|policy|validation|safety)\b|arbitrary sql|system prompt|api.key|secret/i.test(proposal.instruction)) return "Candidate attempts to change protected authority or expose instructions/credentials.";
  return null;
}
export function assessEvaluation(rows: EvaluationRow[]) {
  if (rows.length !== 4 || new Set(rows.map((r) => r.id)).size !== 4 || !rows.some((r) => r.category === "target") || !rows.some((r) => r.category === "regression") || !rows.some((r) => r.category === "safety")) return { eligible: false, reason: "Incomplete declared comparison suite." };
  if (rows.some((r) => r.error || !r.candidatePassed)) return { eligible: false, reason: "Candidate failed a target, regression or safety check." };
  if (!rows.some((r) => !r.baselinePassed && r.candidatePassed) && rows.reduce((s, r) => s + r.candidateCalls, 0) >= rows.reduce((s, r) => s + r.baselineCalls, 0)) return { eligible: false, reason: "No measured improvement over the matched baseline." };
  return { eligible: true, reason: "Candidate passed every declared check and improved correctness or call count. Operator assessment is still required." };
}
