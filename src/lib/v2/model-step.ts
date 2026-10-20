import type { Pool } from "pg";
import type { z } from "zod";
import { ModelRequest, ModelStepSpec, ModelUsage } from "./model-contracts";
import { runStore } from "./run-store";

export type ModelTransport = (request: z.infer<typeof ModelRequest>, options: { signal: AbortSignal; timeoutMs: 30000; maxRetries: 0 }) => Promise<unknown>;
export class ModelStepError extends Error { constructor(public code: "transport_failed" | "timeout" | "invalid_output") { super(`Model step: ${code}`); } }

// shortcut: injected transport only; add the single-attempt OpenAI adapter with the live-worker phase.
export async function executeModelStep(pool: Pool, lease: unknown, rawSpec: unknown, send: ModelTransport) {
  const spec = ModelStepSpec.parse(rawSpec), runs = runStore(pool);
  const prepared = await runs.prepareModelStep(lease,spec);
  if (prepared.kind==="cached") return prepared.message;
  for (let correction = 0; correction<2; correction++) {
    const slot = await runs.reserveModelStep(lease,spec.step.operationKey);
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined, response: unknown;
    try {
      const timeout = new Promise<never>((_,reject) => { deadline = setTimeout(() => { controller.abort(); reject(new ModelStepError("timeout")); },30000); });
      response = await Promise.race([send(Object.freeze({ ...prepared.requests[slot.attemptNumber-1] }),{ signal: controller.signal,timeoutMs: 30000,maxRetries: 0 }),timeout]);
    } catch (error) {
      await runs.finishModelStep(lease,spec.step.operationKey,slot.attemptId,null,null);
      throw error instanceof ModelStepError ? error : new ModelStepError("transport_failed");
    } finally { clearTimeout(deadline); }
    const reply = response as { text?: unknown; usage?: unknown } | null;
    const parsedUsage = ModelUsage.safeParse(reply?.usage ?? null), usage = parsedUsage.success ? parsedUsage.data : null;
    let body: unknown = null;
    if (typeof reply?.text==="string" && Buffer.byteLength(reply.text,"utf8")<=16000 && parsedUsage.success) {
      try { body = JSON.parse(reply.text); } catch { body = null; }
    }
    const output = await runs.finishModelStep(lease,spec.step.operationKey,slot.attemptId,usage,body);
    if ("message" in output && output.message) return output.message;
  }
  throw new ModelStepError("invalid_output");
}
