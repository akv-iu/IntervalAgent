// Live OpenAI adapter. All retrying happens here (SDK retries are off) so attempts never multiply.
import OpenAI, { APIConnectionError } from "openai";
import { redact } from "../env";
import { type Budget, estimateTokens, OUTPUT_ALLOWANCE } from "./budget";
import { TRANSPORT_ATTEMPTS } from "./limits";
import type { LlmProvider, LlmRequest } from "./types";

interface ChatBody {
  model: string;
  messages: { role: "developer" | "assistant" | "user"; content: string }[];
  response_format: { type: "json_object" };
  max_completion_tokens?: number;
}
interface ChatResult {
  choices: { message: { content: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}
export interface OpenAILike {
  chat: { completions: { create(body: ChatBody): Promise<ChatResult> } };
}

// Quota, billing, auth, and bad requests never get better by retrying.
const NO_RETRY_CODES = new Set(["insufficient_quota", "billing_hard_limit_reached", "billing_not_active"]);

function retryable(e: unknown): boolean {
  const err = e as { status?: number; code?: string | null };
  if (err.code && NO_RETRY_CODES.has(err.code)) return false;
  // The SDK names these "Error", so check the class (timeouts subclass APIConnectionError).
  if (err.status === undefined) return e instanceof APIConnectionError;
  return err.status === 429 || err.status >= 500;
}

export function openaiProvider(o: {
  apiKey: string;
  model: string;
  budget: Budget;
  client?: OpenAILike;
  sleep?: (ms: number) => Promise<void>;
  maxOutputTokens?: number; // when set, sent to the API and reserved in full instead of the default allowance
}): LlmProvider {
  // The SDK client's overloaded create() is wider than the slice we use; cast to that slice.
  const client = o.client ?? (new OpenAI({ apiKey: o.apiKey, maxRetries: 0 }) as unknown as OpenAILike);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    name: "openai",
    model: o.model,
    params: {},
    async complete(req: LlmRequest) {
      const body: ChatBody = {
        model: o.model,
        response_format: { type: "json_object" },
        ...(o.maxOutputTokens ? { max_completion_tokens: o.maxOutputTokens } : {}),
        messages: [
          { role: "developer", content: req.system },
          ...req.messages.map((m) => ({ role: m.role === "agent" ? ("assistant" as const) : ("user" as const), content: m.text })),
        ],
      };
      for (let attempt = 1; ; attempt++) {
        // Before every paid attempt, retries included.
        o.budget.reserve(estimateTokens(req) + (o.maxOutputTokens ? o.maxOutputTokens - OUTPUT_ALLOWANCE : 0));
        try {
          const res = await client.chat.completions.create(body);
          const usage = res.usage ? { input: res.usage.prompt_tokens, output: res.usage.completion_tokens } : undefined;
          if (usage) o.budget.record(usage.input + usage.output);
          return { text: res.choices[0]?.message.content ?? "", ...(usage ? { usage } : {}) };
        } catch (e) {
          const err = e as { status?: number; code?: string | null; message?: string };
          if (!retryable(e) || attempt >= TRANSPORT_ATTEMPTS) {
            throw new Error(redact(`OpenAI request failed (${err.status ?? "network"} ${err.code ?? ""}) after ${attempt} attempt(s): ${err.message ?? String(e)}`));
          }
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
    },
  };
}
