// One result contract shared by runners, replay verification, and the importer.
import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const SCENARIO_VERSION = 1;
export const CONTRACT_VERSION = 1;

export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be a simple slug");

const ts = z.iso.datetime();
const cents = z.number().int().nonnegative();
const Bucket = z.enum(["1-30", "31-60", "61-90", "91-120"]);
export const Outcome = z.enum(["agreed_to_pay", "payment_plan", "promise_to_pay", "disputed", "stopped", "no_response", "failed"]);
export type Outcome = z.infer<typeof Outcome>;

export const CheckItem = z.object({ name: z.string(), passed: z.boolean().nullable(), detail: z.string() });
export type CheckItem = z.infer<typeof CheckItem>;

export const PersonaState = z.object({
  disputed: z.boolean(),
  stopped: z.boolean(),
  agreed: z.enum(["full", "plan", "promise"]).nullable(),
  turn: z.number().int().nonnegative(),
});
export type PersonaState = z.infer<typeof PersonaState>;

export const Message = z.object({
  seq: z.number().int().positive(),
  role: z.enum(["agent", "customer", "system"]),
  text: z.string(),
  sentAt: ts,
  guardFlags: z.array(z.string()),
  checks: z.array(CheckItem),
  personaState: PersonaState.optional(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  accountKey: z.string(),
  scenarioId: z.string().nullable(),
  version: z.enum(["baseline", "guarded"]),
  channel: z.enum(["sms", "email"]),
  tone: z.enum(["friendly", "formal"]),
  startedAt: ts,
  outcome: Outcome,
  agreedAt: ts.nullable(),
  paidAt: ts.nullable(),
  recoveredCents: cents,
  handedToHuman: z.boolean(),
  messages: z.array(Message),
  scenarioChecks: z.array(CheckItem),
});
export type Conversation = z.infer<typeof Conversation>;

export const Arm = z.object({
  channel: z.enum(["sms", "email"]),
  window: z.enum(["morning", "evening"]),
  tone: z.enum(["friendly", "formal"]),
});
export type Arm = z.infer<typeof Arm>;

export const Trial = z
  .object({
    phase: z.enum(["train", "test"]),
    segment: Bucket,
    caseId: z.string(),
    strategy: z.enum(["fixed", "learned"]),
    arm: Arm,
    responded: z.boolean(),
    paid: z.boolean(),
  })
  .refine((t) => !t.paid || t.responded, "paid requires responded");
export type Trial = z.infer<typeof Trial>;

const Common = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: slug,
  createdAt: ts,
  status: z.enum(["complete", "failed"]),
  sourceMode: z.enum(["live", "mock", "replay", "synthetic"]),
  recordingSetId: slug.optional(),
  model: z.string().optional(),
  scenarioVersion: z.literal(SCENARIO_VERSION),
  // provenance (original source of replayed responses), token usage, notes
  metadata: z.record(z.string(), z.unknown()),
};

const EvalArtifact = z.object({ ...Common, kind: z.literal("eval"), conversations: z.array(Conversation) });
const BulkArtifact = z.object({ ...Common, kind: z.literal("bulk"), reportAsOf: ts, conversations: z.array(Conversation) });
const PickerArtifact = z.object({
  ...Common,
  kind: z.literal("picker"),
  trainSeed: z.number().int(),
  testSeed: z.number().int(),
  exploreSeed: z.number().int(),
  counts: z.object({ trainPerSegment: z.number().int(), testPerSegment: z.number().int() }),
  reward: z.string(),
  selected: z.record(Bucket, Arm),
  trials: z.array(Trial),
});

export const Artifact = z
  .discriminatedUnion("kind", [EvalArtifact, BulkArtifact, PickerArtifact])
  .refine(
    (a) => a.status === "failed" || a.kind === "picker" || a.conversations.every((c) => c.outcome !== "failed" && c.messages.length > 0),
    { message: "a complete run cannot contain failed or empty conversations" },
  )
  .refine((a) => a.sourceMode !== "replay" || (a.recordingSetId !== undefined && typeof a.metadata.originalSourceMode === "string"), {
    message: "replay runs need recordingSetId and metadata.originalSourceMode",
  });
export type Artifact = z.infer<typeof Artifact>;
export type EvalArtifact = z.infer<typeof EvalArtifact>;
export type BulkArtifact = z.infer<typeof BulkArtifact>;
export type PickerArtifact = z.infer<typeof PickerArtifact>;
