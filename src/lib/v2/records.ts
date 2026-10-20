import { z } from "zod";
import { slug } from "../artifact";
import { BusinessConfig, EvidenceRef, Proposal, Scope } from "./contracts";

export const AccountScope = z.strictObject({ ...Scope.shape, accountId: slug });
export type AccountScope = z.infer<typeof AccountScope>;
const money = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const base = { ...AccountScope.shape, id: slug, version };
export const Account = z.strictObject({ ...base, firstName: z.string().min(1).max(80), currency: z.literal("USD"), timezone: z.enum(["America/Denver", "America/New_York"]) });
export const Invoice = z.strictObject({
  ...base, issuedAt: z.iso.datetime(), dueDate: z.iso.date(),
  lines: z.array(z.strictObject({ id: slug, description: z.string().min(1).max(200), amountCents: money, serviceAt: z.iso.datetime() })).min(1).max(100),
});
export const Payment = z.strictObject({ ...base, amountCents: money, receivedAt: z.iso.datetime(), reference: z.string().min(1).max(100), status: z.enum(["settled", "pending", "reversed"]) });
export const Allocation = z.strictObject({ ...base, paymentId: slug, invoiceId: slug, amountCents: money });
export const Cancellation = z.strictObject({ ...base, invoiceId: slug, lineId: slug, requestedAt: z.iso.datetime() });
export const Credit = z.strictObject({ ...base, invoiceId: slug, cancellationId: slug, amountCents: money });
export const Policy = z.strictObject({
  ...Scope.shape, id: slug, version, effectiveFrom: z.iso.datetime(), effectiveTo: z.iso.datetime().nullable(),
  cancellationWindowDays: z.number().int().min(0).max(365), maxInstallments: z.number().int().min(2).max(3),
});
const Shape = z.strictObject({
  schemaVersion: z.literal(2), snapshotAt: z.iso.datetime(),
  businesses: z.array(BusinessConfig).min(1).max(100), accounts: z.array(Account).max(1000),
  invoices: z.array(Invoice).max(2000), payments: z.array(Payment).max(2000),
  allocations: z.array(Allocation).max(2000), cancellations: z.array(Cancellation).max(2000),
  credits: z.array(Credit).max(2000), policies: z.array(Policy).max(1000),
});
type Snapshot = z.infer<typeof Shape>;
type Scoped = { businessId: string; workspaceId: string; id: string };
const key = (r: Scoped) => `${r.businessId}:${r.workspaceId}:${r.id}`;
export function sameAccount(r: AccountScope, scope: AccountScope): boolean {
  return r.businessId === scope.businessId && r.workspaceId === scope.workspaceId && r.accountId === scope.accountId;
}
function find<T extends Scoped>(rows: T[], scope: AccountScope, id: string): T | undefined {
  return rows.find((r) => r.businessId === scope.businessId && r.workspaceId === scope.workspaceId && r.id === id);
}
function effectiveAt(policy: z.infer<typeof Policy>, at: string): boolean {
  return Date.parse(policy.effectiveFrom) <= Date.parse(at) && (policy.effectiveTo === null || Date.parse(at) < Date.parse(policy.effectiveTo));
}
export function activePolicy(data: Snapshot, scope: AccountScope) {
  return data.policies.find((p) => p.businessId === scope.businessId && p.workspaceId === scope.workspaceId
    && effectiveAt(p, data.snapshotAt));
}

export const Records = Shape.superRefine((d, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(d.businesses.map((b) => b.businessId)).size !== d.businesses.length) invalid("duplicate business configuration");
  for (const rows of [d.accounts, d.invoices, d.payments, d.allocations, d.cancellations, d.credits, d.policies]) {
    if (new Set(rows.map(key)).size !== rows.length) invalid("duplicate scoped record ID");
  }
  for (const a of d.accounts) {
    if (a.id !== a.accountId) invalid("account identity mismatch");
    const config = d.businesses.find((b) => b.businessId === a.businessId);
    const policies = d.policies.filter((p) => p.businessId === a.businessId && p.workspaceId === a.workspaceId
      && effectiveAt(p, d.snapshotAt));
    if (!config || policies.length !== 1 || policies[0].version !== config.policyVersion) invalid("account needs one effective configured policy");
  }
  for (const rows of [d.invoices, d.payments, d.allocations, d.cancellations, d.credits]) {
    for (const r of rows) {
      const account = find(d.accounts, r, r.accountId);
      if (!account || !sameAccount(account, r)) invalid("missing scoped parent account");
    }
  }
  for (const p of d.policies) {
    if (p.effectiveTo !== null && Date.parse(p.effectiveTo) <= Date.parse(p.effectiveFrom)) invalid("invalid policy interval");
  }
  for (const invoice of d.invoices) {
    const total = invoice.lines.reduce((n, line) => n + line.amountCents, 0);
    if (!Number.isSafeInteger(total)) invalid("unsafe invoice total");
    if (new Set(invoice.lines.map((l) => l.id)).size !== invoice.lines.length) invalid("duplicate invoice line ID");
    if (Date.parse(invoice.issuedAt) > Date.parse(d.snapshotAt) || invoice.dueDate < invoice.issuedAt.slice(0, 10)) invalid("invalid invoice dates");
    const applied = [...d.allocations, ...d.credits].filter((r) => sameAccount(r, invoice) && r.invoiceId === invoice.id).reduce((n, r) => n + r.amountCents, 0);
    if (!Number.isSafeInteger(applied) || applied > total) invalid("invoice over-allocated or over-credited");
  }
  for (const payment of d.payments) {
    const allocated = d.allocations.filter((r) => sameAccount(r, payment) && r.paymentId === payment.id).reduce((n, r) => n + r.amountCents, 0);
    if (Date.parse(payment.receivedAt) > Date.parse(d.snapshotAt) || !Number.isSafeInteger(allocated) || allocated > payment.amountCents || (allocated > 0 && payment.status !== "settled")) invalid("invalid payment allocation or date");
  }
  for (const a of d.allocations) {
    const payment = find(d.payments, a, a.paymentId);
    const invoice = find(d.invoices, a, a.invoiceId);
    if (!payment || !invoice || !sameAccount(payment, a) || !sameAccount(invoice, a)) invalid("allocation has missing or foreign records");
  }
  for (const c of d.cancellations) {
    const invoice = find(d.invoices, c, c.invoiceId);
    if (!invoice || !sameAccount(invoice, c) || !invoice.lines.some((l) => l.id === c.lineId)
      || Date.parse(c.requestedAt) > Date.parse(d.snapshotAt) || Date.parse(c.requestedAt) < Date.parse(invoice.issuedAt)) invalid("invalid cancellation reference or date");
  }
  for (const c of d.credits) {
    const cancellation = find(d.cancellations, c, c.cancellationId);
    if (!cancellation || !sameAccount(cancellation, c) || cancellation.invoiceId !== c.invoiceId) invalid("credit has no matching cancellation");
  }
  for (const invoice of d.invoices) {
    for (const line of invoice.lines) {
      const cancelled = d.cancellations.filter((c) => sameAccount(c, invoice) && c.invoiceId === invoice.id && c.lineId === line.id);
      const credited = d.credits.filter((c) => sameAccount(c, invoice) && c.invoiceId === invoice.id && cancelled.some((r) => r.id === c.cancellationId)).reduce((n, c) => n + c.amountCents, 0);
      if (!Number.isSafeInteger(credited) || credited > line.amountCents) invalid("invoice line over-credited");
    }
  }
});
export type Records = z.infer<typeof Records>;

export function evidenceFor(scope: AccountScope, recordType: z.infer<typeof EvidenceRef>["recordType"], record: Scoped & { version: number; accountId?: string }) {
  if (record.businessId !== scope.businessId || record.workspaceId !== scope.workspaceId || (record.accountId !== undefined && record.accountId !== scope.accountId)) throw new Error("foreign evidence record");
  return EvidenceRef.parse({ businessId: scope.businessId, workspaceId: scope.workspaceId, accountId: scope.accountId, recordType, recordId: record.id, version: record.version });
}

export function invoiceBalance(data: Records, scope: AccountScope, invoiceId: string): number {
  const invoice = data.invoices.find((i) => sameAccount(i, scope) && i.id === invoiceId);
  if (!invoice) throw new Error("invoice not found");
  return invoice.lines.reduce((n, l) => n + l.amountCents, 0)
    - [...data.allocations, ...data.credits].filter((r) => sameAccount(r, scope) && r.invoiceId === invoiceId).reduce((n, r) => n + r.amountCents, 0);
}

// Preview only. Approval, current-record revalidation and transactional effects arrive in Task 6.
export function previewProposal(rawData: unknown, rawScope: unknown, rawProposal: unknown) {
  const data = Records.parse(rawData);
  const scope = AccountScope.parse(rawScope);
  const proposal = Proposal.parse(rawProposal);
  const policy = activePolicy(data, scope);
  if (proposal.accountId !== scope.accountId || !policy || policy.version !== proposal.policyVersion) throw new Error("proposal account or policy mismatch");
  const tables = { account: data.accounts, invoice: data.invoices, payment: data.payments, allocation: data.allocations, cancellation: data.cancellations, credit: data.credits, policy: data.policies };
  for (const ref of proposal.evidenceRefs) {
    if (!sameAccount(ref, scope) || ref.recordType === "tool_result") throw new Error("unverifiable proposal evidence");
    const record = tables[ref.recordType].find((r) => key(r) === `${scope.businessId}:${scope.workspaceId}:${ref.recordId}`);
    if (!record || record.version !== ref.version || ("accountId" in record && record.accountId !== scope.accountId)) throw new Error("missing or stale proposal evidence");
    if (ref.recordType === "policy" && record.id !== policy.id) throw new Error("proposal must cite the effective policy");
  }
  const remaining = new Map<string, number>();
  const usedPayments = new Map<string, number>();
  const usedLines = new Map<string, number>();
  for (const action of proposal.actions) {
    const invoice = data.invoices.find((i) => sameAccount(i, scope) && i.id === action.invoiceId);
    if (!invoice) throw new Error("invoice not found");
    if (action.type === "allocate_payment") {
      const payment = data.payments.find((p) => sameAccount(p, scope) && p.id === action.paymentId);
      const applied = data.allocations.filter((r) => sameAccount(r, scope) && r.paymentId === action.paymentId).reduce((n, r) => n + r.amountCents, 0);
      const used = (usedPayments.get(action.paymentId) ?? 0) + action.amountCents;
      if (!payment || payment.status !== "settled" || used > payment.amountCents - applied) throw new Error("payment amount exceeds available funds");
      usedPayments.set(action.paymentId, used);
    } else {
      const cancellation = data.cancellations.find((c) => sameAccount(c, scope) && c.id === action.cancellationId && c.invoiceId === invoice.id);
      const line = invoice.lines.find((l) => l.id === cancellation?.lineId);
      if (!cancellation || !line || Date.parse(cancellation.requestedAt) - Date.parse(line.serviceAt) > policy.cancellationWindowDays * 86400000) throw new Error("credit is not eligible under policy");
      const lineKey = `${invoice.id}:${line.id}`;
      const credited = data.credits.filter((c) => sameAccount(c, scope) && c.invoiceId === invoice.id
        && data.cancellations.some((r) => sameAccount(r, scope) && r.id === c.cancellationId && r.lineId === line.id)).reduce((n, c) => n + c.amountCents, 0);
      const used = (usedLines.get(lineKey) ?? 0) + action.amountCents;
      if (used > line.amountCents - credited) throw new Error("credit exceeds cancelled line amount");
      usedLines.set(lineKey, used);
    }
    const balance = (remaining.get(invoice.id) ?? invoiceBalance(data, scope, invoice.id)) - action.amountCents;
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("proposal exceeds invoice balance");
    remaining.set(invoice.id, balance);
  }
  return [...remaining].map(([invoiceId, balanceCents]) => ({ invoiceId, balanceCents }));
}
