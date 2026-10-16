// Runs the 12 scenarios for the chosen system versions and scores every conversation.
import { type EvalArtifact, SCENARIO_VERSION, SCHEMA_VERSION } from "../artifact";
import { messageChecks, scenarioChecks } from "../checks";
import type { LlmProvider } from "../llm/types";
import { createRng } from "../rng";
import { localToInstant, SIM_DATE } from "../time";
import { runConversation } from "./loop";
import { EVAL_SEED_BASE, SCENARIOS } from "./scenarios";

const SOURCE_MODE = { openai: "live", mock: "mock", "mock-bad": "mock", replay: "replay" } as const;

export async function runEval(o: {
  runId: string;
  createdAt: string;
  provider: LlmProvider;
  versions: ("baseline" | "guarded")[];
  limit?: number;
}): Promise<EvalArtifact> {
  const conversations = [];
  for (const [i, s] of SCENARIOS.slice(0, o.limit ?? SCENARIOS.length).entries()) {
    for (const version of o.versions) {
      const { llmCalls: _calls, ...c } = await runConversation({
        account: s.account,
        script: s.script,
        scenarioId: s.id,
        version,
        startAt: localToInstant(SIM_DATE, s.startHour, 0, s.account.timezone),
        provider: o.provider,
        rng: createRng(EVAL_SEED_BASE + i),
        channel: "sms",
        tone: "friendly",
      });
      void _calls;
      let agentSeen = 0;
      const messages = c.messages.map((m) => ({ ...m, checks: messageChecks(m, s.account, m.role === "agent" && agentSeen++ === 0) }));
      conversations.push({ ...c, messages, scenarioChecks: scenarioChecks({ ...c, messages }, s) });
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: o.runId,
    kind: "eval",
    createdAt: o.createdAt,
    status: conversations.some((c) => c.outcome === "failed") ? "failed" : "complete",
    sourceMode: SOURCE_MODE[o.provider.name],
    model: o.provider.model,
    ...(o.provider.recordingSetId ? { recordingSetId: o.provider.recordingSetId } : {}),
    scenarioVersion: SCENARIO_VERSION,
    metadata: {
      provider: o.provider.name,
      ...(o.provider.originalSourceMode ? { originalSourceMode: o.provider.originalSourceMode } : {}),
      ...(o.provider.recordingStats ? { recording: o.provider.recordingStats } : {}),
      ...(o.provider.name === "mock-bad" ? { testFixture: "deliberately bad agent, not live evidence" } : {}),
    },
    conversations,
  };
}
