import { parseArgs } from "node:util";
import { demoRecords } from "../src/lib/v2/demo-records";
import { makeAgentMessage } from "../src/lib/v2/mock-agents";
import { billingRecipe, billingInstructions } from "../src/lib/v2/billing";
import { mockCustomerDraft, runFourRoleMock } from "../src/lib/v2/mock-workflow";
import { createReadTools } from "../src/lib/v2/tools";
import type { AgentMessage } from "../src/lib/v2/contracts";

async function main() {
  const { values } = parseArgs({ options: { business: { type: "string", default: "northside" }, "reject-once": { type: "boolean" }, "missing-policy": { type: "boolean" } } });
  if (!["northside", "subscriptions"].includes(values.business)) throw new Error("Unknown demo business");
  const context = { businessId: values.business, workspaceId: "demo", accountId: "account-1", caseId: "cli-case", runId: `mock-${values.business}`, createdAt: "2026-10-20T00:00:00.000Z" };
  const messages: AgentMessage[] = [], toolCalls: string[] = [];
  const tools = createReadTools(async () => demoRecords());
  const recipe = billingRecipe(demoRecords(),{ businessId: context.businessId, workspaceId: context.workspaceId, accountId: context.accountId });
  const result = await runFourRoleMock({ sourceText: "I already paid and dispute the remaining balance.", instructions: billingInstructions, lessonVersion: "none", billing: recipe.context }, recipe.steps, {
    async step(step, generate) { const message = makeAgentMessage(context, step, generate()); messages.push(message); return message; },
    async tool(step) {
      toolCalls.push(step.operationKey);
      if (values["missing-policy"] && step.request.name === "policy_lookup") return { name: "policy_lookup", status: "not_found", message: "Injected missing policy for this demo.", evidenceRefs: [] };
      return tools.execute({ businessId: context.businessId, workspaceId: context.workspaceId, accountId: context.accountId, role: "investigator" }, step.request);
    },
  }, (finding, cycle) => values["reject-once"] && cycle === 0
    ? { ...mockCustomerDraft(finding), payload: { message: "Your payment was applied and your balance is zero.", resolution: null } }
    : mockCustomerDraft(finding));
  console.log(JSON.stringify({ mode: "mock", businessId: context.businessId, faultInjection: { rejectOnce: !!values["reject-once"], missingPolicy: !!values["missing-policy"] }, result, toolCalls, messages }, null, 2));
}
main().catch(() => { console.error("Mock workflow failed. Check the documented options."); process.exitCode = 1; });
