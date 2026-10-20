import type { Pool } from "pg";
import type { ClaimedJob } from "./case-store";
import { executeModelStep, type ModelTransport } from "./model-step";
import { runModelWorkflow } from "./model-workflow";
import { createReadTools } from "./tools";
import { runStore } from "./run-store";

// Internal injected-transport harness only; no live activation or job/case completion.
export async function runCheckpointedModelTest(pool: Pool, job: ClaimedJob, model: string, send: ModelTransport) {
  const runs=runStore(pool), run=await runs.openModelTest(job.lease,model), workflow=run.snapshot.workflow;
  if (!workflow?.billing) throw new Error("billing workflow required");
  const tools=createReadTools(async()=>job.records);
  const context={ businessId: job.lease.businessId,workspaceId: job.lease.workspaceId,accountId: job.accountId,role: "investigator" };
  return runModelWorkflow(workflow.billing,workflow.sourceText,run.snapshot.steps,{
    model: (task,step,input)=>executeModelStep(pool,job.lease,{ task,step,input,model },send),
    async tool(step) {
      for (let attempt=0;attempt<2;attempt++) {
        const slot=await runs.reserveTool(job.lease,step);
        if (slot.kind==="cached") return slot.result;
        const result=await tools.execute(context,step.request);
        await runs.settleTool(job.lease,slot.attemptId,result);
        if (result.status!=="unavailable" || attempt===1) return result;
      }
      throw new Error("tool attempt limit");
    },
  });
}
