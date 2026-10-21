import { createVisitorCase, endVisitorSession, getVisitorSession, loadVisitorCase, mergeVisitorMessages, postVisitorMessage, startVisitorSession } from "../src/lib/v2/visitor-client";

const session = { businessId: "northside" as const, workspaceId: "ws-one", expiresAt: "2026-10-21T00:00:00.000Z" };
const record = { businessId: "northside", workspaceId: "ws-one", caseId: "reference-case", accountId: "account-1", state: "open" as const, revision: 1, contactSuppressed: false };
const message = { revision: 2, role: "customer" as const, text: "Check my invoice", createdAt: "2026-10-20T12:00:00.000Z" };
const fetcher = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetcher.mockReset()));
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200, headers = {}) => Response.json(body, { status, headers });

test("session reads never create a workspace and mutations use same-origin JSON without client principals", async () => {
  fetcher.mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ case: record })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  await getVisitorSession(); await startVisitorSession("northside"); await createVisitorCase(); await endVisitorSession();
  expect(fetcher.mock.calls.map(([path, init]) => [path, init.method, init.credentials])).toEqual([
    ["/api/v2/session", "GET", "same-origin"], ["/api/v2/session", "POST", "same-origin"], ["/api/v2/cases", "POST", "same-origin"], ["/api/v2/session", "DELETE", "same-origin"],
  ]);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ caseId: "reference-case", accountId: "account-1" });
});

test("history drains event pages, keeps messages and advances past events without messages", async () => {
  fetcher.mockResolvedValueOnce(json({ case: { ...record, revision: 5 }, messages: [message], nextRevision: 3 }))
    .mockResolvedValueOnce(json({ case: { ...record, revision: 6 }, messages: [{ ...message, revision: 5 }], nextRevision: null }));
  const result = await loadVisitorCase(session, "reference-case", 0);
  expect(result.cursor).toBe(6); expect(result.messages.map((m) => m.revision)).toEqual([2, 5]);
  expect(fetcher.mock.calls[1][0]).toBe("/api/v2/cases/reference-case?afterRevision=3&limit=100");
  expect(mergeVisitorMessages(result.messages, [message]).map((m) => m.revision)).toEqual([2, 5]);
});

test.each(["businessId", "workspaceId", "caseId"])("rejects a foreign %s before displaying a response", async (field) => {
  fetcher.mockResolvedValue(json({ case: { ...record, [field]: "foreign" }, messages: [], nextRevision: null }));
  await expect(loadVisitorCase(session, "reference-case", 0)).rejects.toMatchObject({ status: 0 });
});

test("rejects non-advancing pagination and malformed bodies without exposing server content", async () => {
  fetcher.mockResolvedValueOnce(json({ case: record, messages: [], nextRevision: 2 }));
  await expect(loadVisitorCase(session, "reference-case", 2)).rejects.toMatchObject({ status: 0 });
  fetcher.mockResolvedValueOnce(json({ secret: "private database failure" }));
  await expect(getVisitorSession()).rejects.toThrow("The request could not be completed.");
});

test("retrying an uncertain message preserves the caller's key and uses the current server revision; STOP is ordinary message transport", async () => {
  fetcher.mockRejectedValueOnce(new Error("private network details"))
    .mockResolvedValueOnce(json({ case: { ...record, revision: 2 }, message, duplicate: true }))
    .mockResolvedValueOnce(json({ case: { ...record, revision: 3, state: "closed", contactSuppressed: true }, message: { ...message, revision: 3, text: "STOP" }, duplicate: false }));
  await expect(postVisitorMessage(session, record, message.text, "stable-key")).rejects.toMatchObject({ status: 0 });
  await postVisitorMessage(session, { ...record, revision: 2 }, message.text, "stable-key");
  await postVisitorMessage(session, { ...record, revision: 2 }, "STOP", "stop-key");
  const sent = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(sent.map((m) => m.idempotencyKey)).toEqual(["stable-key", "stable-key", "stop-key"]);
  expect(sent.map((m) => m.expectedRevision)).toEqual([1, 2, 2]);
  expect(sent[2].text).toBe("STOP");
});

test("429 honors Retry-After while conflicts/expiry are distinct and raw errors stay private", async () => {
  const now = Date.now();
  fetcher.mockResolvedValueOnce(json({ error: "private" }, 429, { "Retry-After": "60" }));
  await expect(getVisitorSession()).rejects.toMatchObject({ status: 429, retryAt: expect.any(Number) });
  fetcher.mockResolvedValueOnce(json({}, 429, { "Retry-After": new Date(now + 120_000).toUTCString() }));
  try { await getVisitorSession(); } catch (error) { expect((error as { retryAt: number }).retryAt).toBeGreaterThanOrEqual(now + 119_000); }
  for (const status of [401, 404, 409, 503]) {
    fetcher.mockResolvedValueOnce(json({ error: "private database details" }, status));
    await expect(getVisitorSession()).rejects.toMatchObject({ status, message: expect.not.stringContaining("private") });
  }
});
