export type RunFailure = { kind: string; message: string; status?: number; code?: string };

// Publish classifications, never raw provider messages, request bodies, credentials or headers.
export function describeFailure(error: unknown): RunFailure {
  const outer = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const value = outer.status === undefined && outer.cause && typeof outer.cause === "object" ? outer.cause as Record<string, unknown> : outer;
  const status = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : undefined;
  const code = typeof value.code === "string" && /^[a-z_]{1,70}$/.test(value.code) ? value.code : undefined;
  const metadata = { ...(status ? { status } : {}), ...(code ? { code } : {}) };
  if (value.message === "Agent context limit reached") return { kind: "context_limit", message: "The conversation exceeded the agent context limit. Your messages are saved; no unreviewed reply or financial update was published." };
  if (value.message === "Agent call/deadline limit reached") return { kind: "run_limit", message: "The agent reached its call or time limit. Your messages are saved; no unreviewed reply or financial update was published." };
  if (value.type === "insufficient_quota" || code && ["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"].includes(code))
    return { ...metadata, kind: "quota", message: "OpenAI rejected the call because of account credits or a provider-side spending/usage limit. Check the OpenAI project billing and limits before retrying." };
  if (status === 401 || status === 403) return { ...metadata, kind: "access", message: "OpenAI rejected the API credentials or project/model access. Check the local API configuration before retrying." };
  if (status === 429) return { ...metadata, kind: "rate_or_quota", message: "OpenAI returned HTTP 429. Check the error code for a rate limit or account-quota issue before retrying. No automatic retry was made." };
  if (status === 400 || status === 404 || status === 422) return { ...metadata, kind: "request", message: "OpenAI rejected the model request. Check the model and tool configuration before retrying." };
  if (value.name === "AbortError" || value.name === "TimeoutError" || value.name === "APIConnectionTimeoutError") return { ...metadata, kind: "timeout", message: "The run was cancelled or timed out. No unreviewed reply was published. Inspect saved evidence before retrying." };
  if (value.name === "APIConnectionError") return { ...metadata, kind: "connection", message: "The app could not connect to OpenAI. Check the connection before retrying." };
  if (status && status >= 500) return { ...metadata, kind: "provider", message: "OpenAI could not complete the request. Inspect the saved run and retry explicitly later." };
  return { ...metadata, kind: "unknown", message: "The agent run failed before completion. No unreviewed reply was published. Inspect saved evidence and retry explicitly." };
}
