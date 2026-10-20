import type { Pool } from "pg";
import { caseStore } from "../src/lib/v2/case-store";

const key = { businessId: "northside", workspaceId: "demo", caseId: "case-1" };
const visitor = { kind: "visitor", sessionId: "session-1", businessId: "northside", workspaceId: "demo" };

test("absent or foreign principals fail before accessing the database", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const store = caseStore(pool as unknown as Pool);
  for (const principal of [null, {}, { ...visitor, workspaceId: "other" }]) await expect(store.get(principal, key)).rejects.toThrow();
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.connect).not.toHaveBeenCalled();
});

test("invalid IDs, pagination and forged message roles are rejected before database access", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const store = caseStore(pool as unknown as Pool);
  await expect(store.get(visitor, { ...key, caseId: "../other" })).rejects.toThrow();
  await expect(store.history(visitor, key, { limit: 1000 })).rejects.toThrow();
  await expect(store.append(visitor, key, { text: "Hello", idempotencyKey: "message-1", expectedRevision: 1, role: "agent" })).rejects.toThrow();
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.connect).not.toHaveBeenCalled();
});

test("visitors cannot invoke operator state changes or supply a forged event actor", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const store = caseStore(pool as unknown as Pool);
  await expect(store.transition(visitor, key, { type: "resolve", reason: "Mark paid", expectedRevision: 1 })).rejects.toThrow();
  await expect(store.transition(visitor, key, { type: "reopen", reason: "Open", expectedRevision: 1, actor: "operator" })).rejects.toThrow();
  expect(pool.connect).not.toHaveBeenCalled();
});
