import type { CaseFacts } from "./contracts";

export type SourceScope = { businessId: string; caseId: string };
export type SourceResult =
  | { status: "missing"; scope: SourceScope; provenance: "synthetic" }
  | { status: "available"; scope: SourceScope; provenance: "synthetic"; version: string; asOf: string; references: string[]; facts: CaseFacts };
export interface AccountSource { readAccount(scope: SourceScope): Promise<SourceResult> }

export function syntheticSource(records: CaseFacts[]): AccountSource {
  return { async readAccount(scope) {
    const facts = records.find((r) => r.businessId === scope.businessId && r.id === scope.caseId);
    if (!facts) return { status: "missing", scope, provenance: "synthetic" };
    return { status: "available", scope, provenance: "synthetic", version: facts.sourceVersion, asOf: facts.balanceAsOf, references: [facts.invoiceId, ...facts.payments.map((p) => p.id)], facts: structuredClone(facts) };
  } };
}
