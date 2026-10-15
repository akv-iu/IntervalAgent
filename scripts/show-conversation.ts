// Review aid: print one scenario conversation. npm run show -- --scenario S05 --version guarded --provider mock
import { parseArgs } from "../src/lib/env";
import { mockBadProvider, mockProvider } from "../src/lib/llm/mock";
import { createRng } from "../src/lib/rng";
import { runConversation } from "../src/lib/sim/loop";
import { SCENARIOS } from "../src/lib/sim/scenarios";
import { localToInstant, SIM_DATE } from "../src/lib/time";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const s = SCENARIOS.find((x) => x.id === String(args.scenario ?? "S01").toUpperCase());
  const version = args.version === "baseline" ? "baseline" : "guarded";
  if (!s) throw new Error(`unknown scenario; use one of ${SCENARIOS.map((x) => x.id).join(", ")}`);
  const provider = args.provider === "mock-bad" ? mockBadProvider() : mockProvider();
  const r = await runConversation({
    account: s.account,
    script: s.script,
    scenarioId: s.id,
    version,
    startAt: localToInstant(SIM_DATE, s.startHour, 0, s.account.timezone),
    provider,
    rng: createRng(1),
  });
  const local = new Intl.DateTimeFormat("en-US", { timeZone: s.account.timezone, dateStyle: "short", timeStyle: "short" });
  console.log(`${s.id} ${s.specificCheck} | ${version} | ${provider.name} | ${s.account.timezone}`);
  for (const m of r.messages) {
    const flags = m.guardFlags.length ? ` [${m.guardFlags.join(", ")}]` : "";
    console.log(`\n${local.format(new Date(m.sentAt))} ${m.role.toUpperCase()}${flags}\n  ${m.text}`);
  }
  console.log(`\noutcome: ${r.outcome} | recovered: ${r.recoveredCents} cents | handed to human: ${r.handedToHuman} | model calls: ${r.llmCalls}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
