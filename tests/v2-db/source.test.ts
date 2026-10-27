import { Pool } from "pg";
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { projectEnv } from "../../src/lib/project-env";
import { scriptedClaim } from "../helpers/v2-claim";
import { startingCases } from "../../src/lib/v2/fixtures";
import { postgresSource } from "../../src/lib/v2/postgres-source";
import { investigateFromSource } from "../../src/lib/v2/agents";
import { syntheticSource } from "../../src/lib/v2/source";
import { sourceContract } from "../helpers/v2-source-contract";
import type { Investigation } from "../../src/lib/v2/contracts";

const now = "2026-10-23T12:00:00.000Z";
const records = startingCases(new Date(now));
records.push({ ...structuredClone(records[6]), id: "late-payment" });
let database: Pool, reader: Pool;

beforeAll(async () => {
  const configured = projectEnv(".env.v2").V2_DATABASE_URL;
  if (!configured) throw new Error("Source tests require the isolated V2 setup");
  const url = new URL(configured);
  if (url.hostname !== "127.0.0.1" || url.port !== "55442" || url.pathname !== "/intervalagent_v2") throw new Error("Source tests refuse other database configuration");
  url.pathname = "/intervalagent_v2_test";
  database = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 3000 });
  reader = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 3000, options: "-c default_transaction_read_only=on -c statement_timeout=3000" });
  expect((await database.query("SELECT current_database() AS name")).rows[0].name).toBe("intervalagent_v2_test");
  await database.query(`CREATE SCHEMA IF NOT EXISTS v2_source_demo;
    CREATE TABLE IF NOT EXISTS v2_source_demo.organizations (org_key text PRIMARY KEY, display_name text NOT NULL, timezone text NOT NULL, recognition_mode text);
    CREATE TABLE IF NOT EXISTS v2_source_demo.accounts (org_key text REFERENCES v2_source_demo.organizations, account_key text, contact_label text, invoice_code text, balance_minor bigint, snapshot_at timestamptz, revision_tag text, phone text, email text, scenario_code text, source_notes text[], PRIMARY KEY(org_key,account_key));
    CREATE TABLE IF NOT EXISTS v2_source_demo.payment_rows (org_key text, account_key text, tx_key text, invoice_code text, gross_minor bigint, posting_day date, state text, reflected boolean, PRIMARY KEY(org_key,account_key,tx_key), FOREIGN KEY(org_key,account_key) REFERENCES v2_source_demo.accounts);`);
});
beforeEach(async () => {
  await database.query("TRUNCATE v2_source_demo.payment_rows,v2_source_demo.accounts,v2_source_demo.organizations");
  for (const facts of records) {
    await database.query("INSERT INTO v2_source_demo.organizations VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [facts.businessId, facts.businessName, facts.timezone, facts.recognitionPolicy === "business_confirmation" ? "owner_receipt" : "operator_required"]);
    await database.query("INSERT INTO v2_source_demo.accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [facts.businessId, facts.id, facts.customer, facts.invoiceId, facts.balanceCents, facts.balanceAsOf, facts.sourceVersion, facts.phone, facts.email, facts.scenario, facts.accountNotes]);
    for (const payment of facts.payments) await database.query("INSERT INTO v2_source_demo.payment_rows VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [facts.businessId, facts.id, payment.id, payment.invoiceId, payment.amountCents, payment.date, payment.status === "settled" ? "posted" : "in_flight", payment.includedInBalance]);
  }
});
afterAll(async () => { await reader?.end(); await database?.end(); });

sourceContract("postgresql", () => postgresSource(reader), records);

test.each(["negative", "unsafe", "null-money", "unknown-policy", "unknown-payment", "too-many-payments"])("%s database records remain invalid rather than guessed or truncated", async (kind) => {
  if (kind === "negative") await database.query("UPDATE v2_source_demo.accounts SET balance_minor=-1 WHERE org_key='northside' AND account_key='fresh-record'");
  if (kind === "unsafe") await database.query("UPDATE v2_source_demo.accounts SET balance_minor=9007199254740992 WHERE org_key='northside' AND account_key='fresh-record'");
  if (kind === "null-money") await database.query("UPDATE v2_source_demo.accounts SET balance_minor=NULL WHERE org_key='northside' AND account_key='fresh-record'");
  if (kind === "unknown-policy") await database.query("UPDATE v2_source_demo.organizations SET recognition_mode='automatic_credit' WHERE org_key='northside'");
  if (kind === "unknown-payment") await database.query("UPDATE v2_source_demo.payment_rows SET state='unverified' WHERE org_key='northside' AND account_key='fresh-record'");
  if (kind === "too-many-payments") await database.query("INSERT INTO v2_source_demo.payment_rows SELECT 'northside','fresh-record','overflow-'||n,'INV-102',1,'2026-10-22','posted',true FROM generate_series(1,101) n");
  expect(await postgresSource(reader).readAccount({ businessId: "northside", caseId: "fresh-record" })).toMatchObject({ status: "unavailable", reason: "invalid_record" });
});

test("unavailable SQL mapping yields a safe explicit failure with no fixture/model fallback", async () => {
  const modelCalls = vi.fn();
  const model: Model = { getResponse: modelCalls, async *getStreamedResponse() { throw new Error("unused"); } };
  await database.query("ALTER TABLE v2_source_demo.accounts RENAME TO accounts_unavailable");
  try {
    const source = postgresSource(reader), scope = { businessId: "northside", caseId: "late-payment" };
    expect(await source.readAccount(scope)).toEqual({ status: "unavailable", reason: "unavailable", adapter: "postgresql", provenance: "synthetic", scope });
    await expect(investigateFromSource({ facts: records[0], messages: [], now, verification: null }, source, model)).rejects.toMatchObject({ reason: "unavailable" });
    expect(modelCalls).not.toHaveBeenCalled();
  } finally { await database.query("ALTER TABLE v2_source_demo.accounts_unavailable RENAME TO accounts"); }
});

test("mapping retains current source version/date without reallocating another invoice's payment", async () => {
  await database.query("UPDATE v2_source_demo.accounts SET revision_tag='source-revision-2',snapshot_at='2026-10-23T11:00:00Z' WHERE org_key='northside' AND account_key='fresh-record'");
  await database.query("UPDATE v2_source_demo.payment_rows SET invoice_code='OTHER-INVOICE',reflected=false WHERE org_key='northside' AND account_key='fresh-record'");
  const source = await postgresSource(reader).readAccount({ businessId: "northside", caseId: "fresh-record" });
  expect(source).toMatchObject({ status: "available", version: "source-revision-2", asOf: "2026-10-23T11:00:00.000Z", facts: { balanceCents: 7900, payments: [{ invoiceId: "OTHER-INVOICE", includedInBalance: false }] } });
  expect((await reader.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
});

function output(value: unknown): ModelResponse {
  return { usage: new Usage({ requests: 1, inputTokens: 0, outputTokens: 0 }), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}

test.each(["direct", "verification"] as const)("the same %s investigation uses both sources without changing role definitions", async (journey) => {
  const facts = records[journey === "direct" ? 1 : 0];
  const input: Investigation = { facts, now, verification: null, messages: [{ id: "customer-1", channel: "customer", speaker: "customer", text: journey === "direct" ? "Is my $50 payment already reflected in INV-102?" : "I paid $129 today for INV-101. Please verify.", at: now }] };
  const outcomes = [], instructions: string[][] = [];
  for (const source of [syntheticSource(records), postgresSource(reader)]) {
    let customerCalls = 0;
    const seen: string[] = [];
    const model: Model = { async getResponse(request: ModelRequest) {
      seen.push(request.systemInstructions ?? "");
      expect(JSON.stringify(request.input)).not.toContain("connectionString");
      if (request.systemInstructions?.includes("Independently challenge")) return output({ accepted: true, reasons: [] });
      if (request.systemInstructions?.includes("Own the separate business")) return output({ claimMessageId: "customer-1", outcome: "awaiting_business", businessMessage: "Was today's $129 payment for INV-101 received and settled?", summary: "Awaiting business response", amountCents: 12900, paymentDate: "2026-10-23", invoiceId: "INV-101", reference: null, settlementStatus: "unknown", missingFacts: ["receipt"] });
      if (journey === "verification" && ++customerCalls === 1) return { usage: new Usage(), output: [{ type: "function_call", callId: "verify", name: "business_verification", arguments: JSON.stringify(scriptedClaim(input, { amountCents: 12900, date: "2026-10-23" })) }] };
      return output({ reply: journey === "direct" ? "The recorded $50 is included; $79 remains on the dated snapshot." : "I requested business verification; the payment is not yet confirmed.", needsOperator: false });
    }, async *getStreamedResponse() { throw new Error("unused"); } };
    const run = await investigateFromSource(input, source, model);
    expect(run.input).toEqual(input); expect(run.source.facts).toEqual(facts);
    outcomes.push(run.result); instructions.push(seen);
  }
  expect(outcomes[1]).toEqual(outcomes[0]); expect(instructions[1]).toEqual(instructions[0]);
  expect(instructions[0]).toHaveLength(journey === "direct" ? 2 : 4);
});
