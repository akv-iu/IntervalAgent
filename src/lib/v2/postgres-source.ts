import type { Pool } from "pg";
import { z } from "zod";
import { AccountFacts, sourceRecord, type AccountSource } from "./source";

const MinorUnits = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
const Row = z.object({
  org_key: z.string(), display_name: z.string(), account_key: z.string(), contact_label: z.string(), invoice_code: z.string(), balance_minor: MinorUnits,
  snapshot_at: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()), revision_tag: z.string(), timezone: z.literal("America/Denver"),
  recognition_mode: z.enum(["owner_receipt", "operator_required"]).nullable(), phone: z.string().nullable(), email: z.string().nullable(),
  scenario_code: AccountFacts.shape.scenario.nullable(), source_notes: z.array(z.string()).nullable(),
  payment_rows: z.array(z.object({ tx_key: z.string(), invoice_code: z.string(), gross_minor: MinorUnits, posting_day: z.iso.date(), state: z.enum(["posted", "in_flight"]), reflected: z.boolean() }).strict()).max(100),
}).strict();

export function postgresSource(database: Pick<Pool, "query">): AccountSource {
  return { async readAccount(scope) {
    const meta = { scope: { ...scope }, adapter: "postgresql" as const, provenance: "synthetic" as const };
    try {
      // One parameterized statement keeps account and payment evidence in the same database snapshot.
      const result = await database.query<{ record: unknown }>(`SELECT jsonb_build_object(
        'org_key',o.org_key,'display_name',o.display_name,'account_key',a.account_key,'contact_label',a.contact_label,
        'invoice_code',a.invoice_code,'balance_minor',a.balance_minor::text,'snapshot_at',a.snapshot_at,'revision_tag',a.revision_tag,
        'timezone',o.timezone,'recognition_mode',o.recognition_mode,'phone',a.phone,'email',a.email,'scenario_code',a.scenario_code,'source_notes',a.source_notes,
        'payment_rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('tx_key',p.tx_key,'invoice_code',p.invoice_code,'gross_minor',p.gross_minor::text,'posting_day',p.posting_day,'state',p.state,'reflected',p.reflected) ORDER BY p.tx_key)
          FROM (SELECT * FROM v2_source_demo.payment_rows WHERE org_key=a.org_key AND account_key=a.account_key ORDER BY tx_key LIMIT 101) p),'[]'::jsonb)) AS record
        FROM v2_source_demo.accounts a JOIN v2_source_demo.organizations o ON o.org_key=a.org_key
        WHERE a.org_key=$1 AND a.account_key=$2 LIMIT 2`, [scope.businessId, scope.caseId]);
      if (!result.rows.length) return { ...meta, status: "missing" };
      if (result.rows.length !== 1) return { ...meta, status: "unavailable", reason: "invalid_record" };
      const parsed = Row.safeParse(result.rows[0].record);
      if (!parsed.success) return { ...meta, status: "unavailable", reason: "invalid_record" };
      const row = parsed.data;
      return sourceRecord(scope, "postgresql", { id: row.account_key, businessId: row.org_key, businessName: row.display_name, customer: row.contact_label, invoiceId: row.invoice_code,
        balanceCents: row.balance_minor, balanceAsOf: row.snapshot_at, sourceVersion: row.revision_tag, timezone: row.timezone, phone: row.phone, email: row.email,
        ...(row.recognition_mode ? { recognitionPolicy: row.recognition_mode === "owner_receipt" ? "business_confirmation" : "operator_review" } : {}),
        ...(row.scenario_code ? { scenario: row.scenario_code } : {}), ...(row.source_notes ? { accountNotes: row.source_notes } : {}),
        payments: row.payment_rows.map((p) => ({ id: p.tx_key, invoiceId: p.invoice_code, amountCents: p.gross_minor, date: p.posting_day, status: p.state === "posted" ? "settled" : "pending", includedInBalance: p.reflected })),
      });
    } catch { return { ...meta, status: "unavailable", reason: "unavailable" }; }
  } };
}
