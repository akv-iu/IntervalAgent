import { openAITransport } from "../src/lib/v2/openai-transport";

const request = { model: "test-model", system: "Pinned instruction. Return JSON.", input: "Untrusted customer data", maxOutputTokens: 600 as const };
const options = () => ({ signal: new AbortController().signal, timeoutMs: 30000 as const, maxRetries: 0 as const });
const completion = () => ({ choices: [{ finish_reason: "stop", message: { content: '{"kind":"task_request"}', refusal: null } }], usage: { prompt_tokens: 80, completion_tokens: 20 } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

test("uses the pinned request, one choice, JSON, no storage and the 600-token cap", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json(completion()));
  const send = openAITransport("test-key", fetch);
  expect(await send(request, options())).toEqual({ text: '{"kind":"task_request"}', usage: { input: 80, output: 20 } });
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
  expect(JSON.parse(init!.body as string)).toEqual({
    model: "test-model", messages: [{ role: "developer", content: request.system }, { role: "user", content: request.input }],
    response_format: { type: "json_object" }, max_completion_tokens: 600, n: 1, store: false,
  });
  expect(new Headers(init!.headers).get("authorization")).toBe("Bearer test-key");
});

test.each([400, 401, 408, 409, 429, 500, 503])("HTTP %i never retries or returns upstream details", async (status) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ error: { message: "private customer text and test-key", code: "test_error" } }, status));
  const send = openAITransport("test-key", fetch);
  await expect(send(request, options())).rejects.toThrow(/^Model step: transport_failed$/);
  expect(fetch).toHaveBeenCalledOnce();
});

test("network errors never retry", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error("private network detail"); });
  await expect(openAITransport("test-key", fetch)(request, options())).rejects.toThrow(/^Model step: transport_failed$/);
  expect(fetch).toHaveBeenCalledOnce();
});

test("does not inherit ambient credentials, endpoint, project or debug logging", async () => {
  vi.stubEnv("OPENAI_API_KEY", "ambient-key"); vi.stubEnv("OPENAI_ADMIN_KEY", "ambient-admin");
  vi.stubEnv("OPENAI_BASE_URL", "https://example.invalid/v1"); vi.stubEnv("OPENAI_ORG_ID", "ambient-org");
  vi.stubEnv("OPENAI_PROJECT_ID", "ambient-project"); vi.stubEnv("OPENAI_LOG", "debug");
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json(completion()));
  await openAITransport("test-key", fetch)(request, options());
  const [url, init] = fetch.mock.calls[0], headers = new Headers(init!.headers);
  expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
  expect(headers.get("authorization")).toBe("Bearer test-key");
  expect(headers.has("openai-organization")).toBe(false); expect(headers.has("openai-project")).toBe(false);
  expect(log).not.toHaveBeenCalled();
});

test.each(["", " ", "bad\nkey"])("requires an explicit valid key before SDK creation", (key) => {
  vi.stubEnv("OPENAI_API_KEY", "ambient-key");
  expect(() => openAITransport(key)).toThrow("explicit OpenAI API key required");
});

test("rejects ambient custom headers before a transport can be created", () => {
  vi.stubEnv("OPENAI_CUSTOM_HEADERS", "Authorization: Bearer ambient-key");
  expect(() => openAITransport("test-key")).toThrow("ambient custom headers");
});

test.each(["length", "content_filter", "tool_calls"])("finish reason %s cannot provide accepted output but retains usage", async (finish_reason) => {
  const res = completion(); res.choices[0].finish_reason = finish_reason;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json(res));
  expect(await openAITransport("test-key", fetch)(request, options())).toEqual({ text: "", usage: { input: 80, output: 20 } });
});

test("missing usage retains an unknown charge rather than inventing zero usage", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ choices: completion().choices }));
  expect(await openAITransport("test-key", fetch)(request, options())).toMatchObject({ usage: null });
});

test("already aborted work never dispatches", async () => {
  const controller = new AbortController(); controller.abort();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json(completion()));
  await expect(openAITransport("test-key", fetch)(request, { ...options(), signal: controller.signal })).rejects.toThrow("transport_failed");
  expect(fetch).not.toHaveBeenCalled();
});

test("SDK timeout aborts after 30 seconds without retrying", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    signal = init!.signal!;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const result = openAITransport("test-key", fetch)(request, options()).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(29999);
  expect(fetch).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal.aborted).toBe(true);
  expect(await result).toMatchObject({ code: "transport_failed" });
  expect(fetch).toHaveBeenCalledOnce();
});

test("caller cancellation propagates to an in-flight SDK request", async () => {
  const controller = new AbortController();
  let started!: () => void, signal!: AbortSignal;
  const dispatched = new Promise<void>((resolve) => { started = resolve; });
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    signal = init!.signal!; started();
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const result = openAITransport("test-key", fetch)(request, { ...options(), signal: controller.signal }).catch((e: unknown) => e);
  await dispatched; controller.abort();
  expect(await result).toMatchObject({ code: "transport_failed" });
  expect(signal.aborted).toBe(true); expect(fetch).toHaveBeenCalledOnce();
});

test.each([
  { finish_reason: "stop", message: { content: "{}", refusal: "refused" } },
  { finish_reason: "stop", message: { content: "{}", tool_calls: [{ type: "function" }] } },
])("refusals and unexpected tool calls cannot become an accepted message", async (choice) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ ...completion(), choices: [choice] }));
  expect(await openAITransport("test-key", fetch)(request, options())).toEqual({ text: "", usage: { input: 80, output: 20 } });
});

test.each([null, [], [{ message: null }], [completion().choices[0], completion().choices[0]]])("malformed choices retain known usage", async (choices) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ ...completion(), choices }));
  expect(await openAITransport("test-key", fetch)(request, options())).toEqual({ text: "", usage: { input: 80, output: 20 } });
});

test("malformed usage becomes unknown without inventing or refunding tokens", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ ...completion(), usage: { prompt_tokens: -1, completion_tokens: 20 } }));
  expect(await openAITransport("test-key", fetch)(request, options())).toMatchObject({ usage: null });
});

test("malformed pinned requests fail before SDK dispatch", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json(completion()));
  await expect(openAITransport("test-key", fetch)({ ...request, maxOutputTokens: 601 } as never, options())).rejects.toThrow("transport_failed");
  expect(fetch).not.toHaveBeenCalled();
});
