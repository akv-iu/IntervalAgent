import type { Pool } from "pg";
import { jobStore } from "../src/lib/v2/case-store";
import * as storage from "../src/lib/v2/case-store";
import { demoRecords } from "../src/lib/v2/demo-records";
import { mockInvestigation, runMockWorkerOnce, runMockWorker } from "../src/lib/v2/mock-worker";

test("worker identity and lease inputs fail closed before database access", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  const jobs = jobStore(pool as unknown as Pool);
  await expect(jobs.claim("../worker")).rejects.toThrow();
  await expect(jobs.complete({ token: "forged" }, {})).rejects.toThrow();
  await expect(jobs.fail({})).rejects.toThrow();
  expect(pool.connect).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
});

test("mock investigation uses scoped tools and reports mock evidence", async () => {
  const result = await mockInvestigation({ lease: { businessId: "northside", workspaceId: "demo", caseId: "case-1", caseRevision: 2, workerId: "worker-1", token: "00000000-0000-4000-8000-000000000001" }, accountId: "account-1", records: demoRecords() });
  expect(result.mode).toBe("mock");
  expect(result.evidenceRefs.length).toBeGreaterThan(1);
  expect(result.evidenceRefs.every((r) => r.businessId === "northside" && r.workspaceId === "demo" && r.accountId === "account-1")).toBe(true);
});

test("an already stopped worker never opens a database connection", async () => {
  const pool = { query: vi.fn(), connect: vi.fn() }, controller = new AbortController();
  controller.abort();
  await runMockWorker(pool as unknown as Pool, "worker-1", controller.signal);
  expect(pool.connect).not.toHaveBeenCalled();
});

test("a timed-out handler is retried and its late result cannot commit", async () => {
  const job = { lease: { businessId: "northside", workspaceId: "demo", caseId: "case-1", caseRevision: 2, workerId: "worker-1", token: "00000000-0000-4000-8000-000000000001" }, accountId: "account-1", records: demoRecords() };
  const result = await mockInvestigation(job);
  const complete = vi.fn(async () => true), fail = vi.fn(async () => "retry" as const);
  vi.spyOn(storage, "jobStore").mockReturnValue({ claim: async () => job, complete, fail, pause: async () => "failed" });
  vi.useFakeTimers();
  try {
    let resolve!: (value: typeof result) => void;
    const late = new Promise<typeof result>((done) => { resolve = done; });
    const pending = runMockWorkerOnce({} as Pool, "worker-1", () => late);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150_000);
    expect(await pending).toBe("retry");
    resolve(result);
    await Promise.resolve();
    expect(fail).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});
