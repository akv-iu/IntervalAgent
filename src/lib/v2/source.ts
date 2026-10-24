import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { CaseFacts, Investigation } from "./contracts";

export type SourceScope = { businessId: string; caseId: string };
export type SourceAdapter = "fixture" | "postgresql";
export type SourceFailure = "unavailable" | "invalid_record" | "scope_mismatch" | "reconciliation_required";
export type SourceResult =
  | { status: "missing"; scope: SourceScope; provenance: "synthetic"; adapter: SourceAdapter }
  | { status: "unavailable"; scope: SourceScope; provenance: "synthetic"; adapter: SourceAdapter; reason: SourceFailure }
  | { status: "available"; scope: SourceScope; provenance: "synthetic"; adapter: SourceAdapter; version: string; asOf: string; references: string[]; facts: CaseFacts };
export interface AccountSource { readAccount(scope: SourceScope): Promise<SourceResult> }

const Money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Id = z.string().min(1).max(100);
export const AccountFacts = z.object({
  id: Id, businessId: Id, businessName: z.string().min(1).max(160), customer: z.string().min(1).max(160), invoiceId: Id,
  balanceCents: Money, balanceAsOf: z.iso.datetime({ offset: true }), sourceVersion: z.string().min(1).max(1024), timezone: z.literal("America/Denver"),
  phone: z.string().min(1).max(80).nullable(), email: z.string().min(1).max(254).nullable(),
  recognitionPolicy: z.enum(["business_confirmation", "operator_review"]).optional(),
  scenario: z.enum(["late_payment", "partial_payment", "conflicting_reference", "cancellation_overlap", "affordability", "pending_payment"]).optional(),
  accountNotes: z.array(z.string().min(1).max(500)).max(20).optional(),
  payments: z.array(z.object({ id: Id, invoiceId: Id, amountCents: Money, date: z.iso.date(), status: z.enum(["settled", "pending"]), includedInBalance: z.boolean(), provenance: z.literal("business_confirmation").optional(), businessMessageId: Id.optional(), requestId: Id.optional(), reference: z.string().max(80).nullable().optional() }).strict()).max(100),
}).strict() satisfies z.ZodType<CaseFacts>;

const SourceMeta = { scope: z.object({ businessId: Id, caseId: Id }).strict(), adapter: z.enum(["fixture", "postgresql"]), provenance: z.literal("synthetic") };
const SourceEnvelope = z.discriminatedUnion("status", [
  z.object({ ...SourceMeta, status: z.literal("missing") }).strict(),
  z.object({ ...SourceMeta, status: z.literal("unavailable"), reason: z.enum(["unavailable", "invalid_record", "scope_mismatch", "reconciliation_required"]) }).strict(),
  z.object({ ...SourceMeta, status: z.literal("available"), version: z.string().min(1).max(1024), asOf: z.iso.datetime({ offset: true }), references: z.array(Id).max(101), facts: AccountFacts }).strict(),
]);

export function sourceRecord(scope: SourceScope, adapter: SourceAdapter, record: unknown): SourceResult {
  const parsed = AccountFacts.safeParse(record);
  const meta = { scope: { ...scope }, adapter, provenance: "synthetic" as const };
  if (!parsed.success || new Set(parsed.data.payments.map((p) => p.id)).size !== parsed.data.payments.length) return { ...meta, status: "unavailable", reason: "invalid_record" };
  const facts = parsed.data;
  if (facts.id !== scope.caseId || facts.businessId !== scope.businessId) return { ...meta, status: "unavailable", reason: "scope_mismatch" };
  return { ...meta, status: "available", version: facts.sourceVersion, asOf: facts.balanceAsOf, references: [facts.invoiceId, ...facts.payments.map((p) => p.id)], facts };
}

export class AccountSourceError extends Error {
  constructor(public reason: SourceFailure | "missing") {
    super({ missing: "The scoped account is missing from this source.", unavailable: "The account source is unavailable. No fallback account was substituted.", invalid_record: "The account source returned an invalid record.", scope_mismatch: "The account source returned a different account or obligation.", reconciliation_required: "This source snapshot differs from locally committed payment evidence. Reconciliation is required before switching." }[reason]);
  }
}

export async function loadSourceInput(input: Investigation, source: AccountSource, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const scope = { businessId: input.facts.businessId, caseId: input.facts.id };
  let snapshot: SourceResult;
  try { snapshot = await source.readAccount(scope); } catch { throw new AccountSourceError("unavailable"); }
  signal?.throwIfAborted();
  const envelope = SourceEnvelope.safeParse(snapshot);
  if (!envelope.success) throw new AccountSourceError("invalid_record");
  snapshot = envelope.data;
  if (snapshot.scope.businessId !== scope.businessId || snapshot.scope.caseId !== scope.caseId) throw new AccountSourceError("scope_mismatch");
  if (snapshot.status !== "available") throw new AccountSourceError(snapshot.status === "missing" ? "missing" : snapshot.reason);
  const checked = sourceRecord(scope, snapshot.adapter, snapshot.facts);
  if (checked.status !== "available") throw new AccountSourceError(checked.status === "unavailable" ? checked.reason : "missing");
  if (snapshot.version !== checked.version || snapshot.asOf !== checked.asOf) throw new AccountSourceError("invalid_record");
  if (!Number.isFinite(Date.parse(input.now)) || Date.parse(checked.asOf) > Date.parse(input.now)) throw new AccountSourceError("invalid_record");
  if (checked.facts.invoiceId !== input.facts.invoiceId) throw new AccountSourceError("scope_mismatch");
  const saved = AccountFacts.safeParse(input.facts);
  if (!saved.success) throw new AccountSourceError("invalid_record");
  if ((saved.data.payments.some((p) => p.provenance === "business_confirmation") || input.caseUpdates?.some((u) => u.kind === "payment_recognized")) && !isDeepStrictEqual(saved.data, checked.facts)) throw new AccountSourceError("reconciliation_required");
  return { input: structuredClone({ ...input, facts: checked.facts }), source: checked };
}

export function syntheticSource(records: CaseFacts[]): AccountSource {
  return { async readAccount(scope) {
    const facts = records.find((r) => r.businessId === scope.businessId && r.id === scope.caseId);
    if (!facts) return { status: "missing", scope: { ...scope }, provenance: "synthetic", adapter: "fixture" };
    return sourceRecord(scope, "fixture", facts);
  } };
}
