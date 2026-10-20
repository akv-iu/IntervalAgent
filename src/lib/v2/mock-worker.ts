import type { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { jobStore, type ClaimedJob, type MockResult } from "./case-store";
import { createReadTools } from "./tools";
import { RunLimit, runStore } from "./run-store";
import { runFourRoleMock } from "./mock-workflow";

export async function mockInvestigation(job: ClaimedJob): Promise<MockResult> {
  const context = { businessId: job.lease.businessId, workspaceId: job.lease.workspaceId, accountId: job.accountId, role: "investigator" };
  const tools = createReadTools(async () => job.records);
  const results = await Promise.all([
    tools.execute(context, { name: "account_history", accountId: job.accountId }),
    tools.execute(context, { name: "policy_lookup", accountId: job.accountId }),
  ]);
  if (results.some((r) => r.status !== "found")) throw new Error("mock records unavailable");
  return { mode: "mock", summary: "Mock account and policy lookup complete; human review required.", evidenceRefs: results.flatMap((r) => r.evidenceRefs) };
}

type Handler = (job: ClaimedJob) => Promise<MockResult>;
export async function runCheckpointedMock(pool: Pool, job: ClaimedJob, customer?: Parameters<typeof runFourRoleMock>[3]): Promise<MockResult> {
  const runs = runStore(pool), run = await runs.open(job.lease);
  if (run.snapshot.mode!=="mock") throw new Error("mock worker cannot execute a model-test run");
  const context = { businessId: job.lease.businessId, workspaceId: job.lease.workspaceId, accountId: job.accountId, role: "investigator" };
  const tools = createReadTools(async () => job.records);
  const attemptTool = async (step: (typeof run.snapshot.steps)[number]) => {
    const slot = await runs.reserveTool(job.lease, step);
    if (slot.kind === "cached") return slot.result;
    const output = await tools.execute(context, step.request);
    await runs.settleTool(job.lease, slot.attemptId, output);
    return output;
  };
  const tool = async (step: (typeof run.snapshot.steps)[number]) => {
    const output = await attemptTool(step);
    return output.status === "unavailable" ? attemptTool(step) : output;
  };
  if (run.snapshot.workflow) return runFourRoleMock(run.snapshot.workflow, run.snapshot.steps, {
    step: (step, generate) => runs.agentMessage(job.lease, step, generate), tool,
  }, customer);
  const results = await Promise.all(run.snapshot.steps.map(tool));
  if (results.some((r) => r.status !== "found")) throw new Error("mock records unavailable");
  return { mode: "mock", summary: run.snapshot.summary, evidenceRefs: results.flatMap((r) => r.evidenceRefs) };
}

export async function runMockWorkerOnce(pool: Pool, workerId: string, handler?: Handler) {
  const jobs = jobStore(pool), job = await jobs.claim(workerId);
  if (!job) return "idle" as const;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // shortcut: timeout fences late results, not arbitrary handler I/O; add cooperative cancellation with external providers.
    const timeout = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("mock step timeout")), 30_000); });
    const result = await Promise.race([handler ? handler(job) : runCheckpointedMock(pool, job), timeout]);
    return await jobs.complete(job.lease, result) ? "completed" as const : "stale" as const;
  } catch (error) {
    if (error instanceof RunLimit) return await jobs.pause(job.lease);
    return await jobs.fail(job.lease);
  } finally { clearTimeout(deadline); }
}

export async function runMockWorker(pool: Pool, workerId: string, signal: AbortSignal, handler?: Handler) {
  while (!signal.aborted) {
    await runMockWorkerOnce(pool, workerId, handler);
    if (!signal.aborted) await delay(1000, undefined, { signal }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    });
  }
}
