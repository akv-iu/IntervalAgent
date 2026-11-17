import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { OpenAIProvider, type Model, type ModelRequest } from "@openai/agents";

export const MODEL = "gpt-6-luna";
export const RESERVATION_CENTS = 2;
export type ModelCall = { id: string; inputTokens: number; outputTokens: number; usageKnown: boolean; latencyMs: number; tools: string[]; role?: string };

export function boundedModel(options: {
  apiKey: string; reserve: (id: string) => Promise<void>; record: (call: ModelCall) => void | Promise<void>;
  start?: (call: Pick<ModelCall, "id" | "role">) => void | Promise<void>;
  model?: Model; signal?: AbortSignal;
  maxCalls?: 20 | 32;
}): Model {
  const delegate = options.model ?? new OpenAIProvider({ openAIClient: new OpenAI({ apiKey: options.apiKey, maxRetries: 0, timeout: 30_000 }), useResponses: true }).getModel(MODEL);
  let calls = 0;
  const deadline = Date.now() + 90_000;
  const maxCalls = options.maxCalls ?? 20;
  if (maxCalls !== 20 && maxCalls !== 32) throw new Error("Unsupported model-call bound");
  return {
    async getResponse(request: ModelRequest) {
      if (++calls > maxCalls || Date.now() > deadline) throw new Error("Agent call/deadline limit reached");
      options.signal?.throwIfAborted();
      request.signal?.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(request), "utf8") > 32_000) throw new Error("Agent context limit reached");
      // Reserve above the cost of 32 KB input plus 1,400 output tokens at the pinned model's standard rates.
      const id = randomUUID();
      await options.reserve(id);
      const role: unknown = request.modelSettings.providerData?.metadata?.agent_role;
      const agentRole = typeof role === "string" ? role : "unknown";
      await options.start?.({ id, role: agentRole });
      options.signal?.throwIfAborted();
      request.signal?.throwIfAborted();
      const start = Date.now();
      const result = await (await delegate).getResponse({ ...request, modelSettings: { ...request.modelSettings, maxTokens: 1400, store: false, preserveRawUsage: true, providerData: { ...request.modelSettings.providerData, service_tier: "default" }, retry: { maxRetries: 0 } }, signal: options.signal ?? request.signal });
      const raw = result.rawUsage;
      const usageKnown = !!raw && Number.isSafeInteger(raw.input_tokens) && Number.isSafeInteger(raw.output_tokens) && Number(raw.input_tokens) >= 0 && Number(raw.output_tokens) >= 0;
      await options.record({ id, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, usageKnown, latencyMs: Date.now() - start, tools: result.output.filter((item) => item.type === "function_call").map((item) => item.name), role: agentRole });
      return result;
    },
    async *getStreamedResponse() { throw new Error("Streaming is disabled for this bounded slice"); },
  };
}
