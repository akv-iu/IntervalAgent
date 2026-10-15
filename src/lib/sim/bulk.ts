// Bulk mock run over demo accounts. Fixed sms / friendly / 10:00 local; never uses picker choices.
import { type BulkArtifact, SCENARIO_VERSION, SCHEMA_VERSION } from "../artifact";
import { mockProvider } from "../llm/mock";
import { createRng } from "../rng";
import { localToInstant, SIM_DATE } from "../time";
import { type Persona, demoAccounts } from "./accounts";
import { runConversation } from "./loop";
import type { Script } from "./scenarios";

const SCRIPT_FOR: Record<Persona, Script> = {
  cooperative: "cooperative",
  needs_plan: "needs_plan",
  disputes: "dispute_cancelled",
  angry: "angry_objection",
  stop_contact: "stop_plain",
  silent: "silent",
};
const BULK_SEED = 42;
const SEND_HOUR = 10;
const REPORT_AS_OF = new Date(Date.parse(SIM_DATE) + 7 * 86400000).toISOString();

export async function runBulk(o: { runId: string; createdAt: string; limit?: number }): Promise<BulkArtifact> {
  const provider = mockProvider();
  const rng = createRng(BULK_SEED);
  const accounts = demoAccounts().slice(0, o.limit ?? 100);
  const conversations = [];
  for (const account of accounts) {
    const { llmCalls: _calls, ...c } = await runConversation({
      account,
      script: SCRIPT_FOR[account.persona],
      version: "guarded",
      startAt: localToInstant(SIM_DATE, SEND_HOUR, 0, account.timezone),
      provider,
      rng,
      channel: "sms",
      tone: "friendly",
    });
    void _calls;
    if (c.paidAt && c.paidAt > REPORT_AS_OF) throw new Error(`receipt after reporting cutoff for ${account.accountKey}`);
    conversations.push({ ...c, scenarioChecks: [] });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: o.runId,
    kind: "bulk",
    createdAt: o.createdAt,
    status: conversations.some((c) => c.outcome === "failed") ? "failed" : "complete",
    sourceMode: "mock",
    model: provider.model,
    scenarioVersion: SCENARIO_VERSION,
    reportAsOf: REPORT_AS_OF,
    metadata: { settings: { channel: "sms", tone: "friendly", localHour: SEND_HOUR }, settlementAssumption: "full-payment agreements settle 1 to 3 days later" },
    conversations,
  };
}
