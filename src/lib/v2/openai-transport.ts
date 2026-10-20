import OpenAI from "openai";
import { ModelRequest, ModelUsage } from "./model-contracts";
import { ModelStepError, type ModelTransport } from "./model-step";

// Worker-only: construction does not enable live mode or read an API key from the environment.
export function openAITransport(apiKey: string, fetch?: typeof globalThis.fetch): ModelTransport {
  if (typeof apiKey !== "string" || !apiKey || /\s/.test(apiKey)) throw new Error("explicit OpenAI API key required");
  if (process.env.OPENAI_CUSTOM_HEADERS) throw new Error("V2 OpenAI transport rejects ambient custom headers");
  const client = new OpenAI({
    apiKey, adminAPIKey: null, organization: null, project: null, baseURL: "https://api.openai.com/v1",
    maxRetries: 0, timeout: 30000, logLevel: "off", ...(fetch ? { fetch } : {}),
  });
  return async (raw, options) => {
    try {
      const request = ModelRequest.parse(raw);
      if (options.maxRetries !== 0 || options.timeoutMs !== 30000) throw new Error("invalid transport options");
      options.signal.throwIfAborted();
      const result = await client.chat.completions.create({
        model: request.model,
        messages: [{ role: "developer", content: request.system }, { role: "user", content: request.input }],
        response_format: { type: "json_object" }, max_completion_tokens: request.maxOutputTokens, n: 1, store: false,
      }, { maxRetries: 0, timeout: 30000, signal: options.signal });
      const usage = ModelUsage.safeParse(result?.usage ? { input: result.usage.prompt_tokens, output: result.usage.completion_tokens } : null);
      const choice = Array.isArray(result?.choices) && result.choices.length === 1 ? result.choices[0] : undefined;
      const text = choice?.finish_reason === "stop" && !choice.message?.refusal && !choice.message?.tool_calls?.length && typeof choice.message?.content === "string"
        ? choice.message.content : "";
      return { text, usage: usage.success ? usage.data : null };
    } catch { throw new ModelStepError("transport_failed"); }
  };
}
