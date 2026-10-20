import type { Pool } from "pg";
import { runStore } from "../src/lib/v2/run-store";

const lease = { businessId: "northside", workspaceId: "demo", caseId: "one", caseRevision: 2, workerId: "worker-1", token: "00000000-0000-4000-8000-000000000001" };
test("malformed leases, reservations and observed usage fail before database access", async () => {
  const pool = { connect: vi.fn(), query: vi.fn() }, runs = runStore(pool as unknown as Pool);
  await expect(runs.open({ ...lease, token: "forged" })).rejects.toThrow();
  for (const bad of [0, -1, 24000, 1.2, Number.NaN]) {
    await expect(runs.reserveModel(lease, { operationKey: "customer", role: "customer", inputTokens: bad, requestHash: "a".repeat(64) })).rejects.toThrow();
  }
  await expect(runs.reserveTool(lease, { operationKey: "read", request: { name: "arbitrary_sql", accountId: "account-1" } })).rejects.toThrow();
  await expect(runs.settleModel(lease, lease.token, { input: -1, output: 2 })).rejects.toThrow();
  expect(pool.connect).not.toHaveBeenCalled();
});
