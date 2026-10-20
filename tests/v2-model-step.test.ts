import type { Pool } from "pg";
import * as storage from "../src/lib/v2/run-store";
import { executeModelStep, ModelStepError, type ModelTransport } from "../src/lib/v2/model-step";

const lease = { businessId: "northside", workspaceId: "demo", caseId: "one", caseRevision: 2, workerId: "worker-1", token: "00000000-0000-4000-8000-000000000001" };
const spec = { step: { operationKey: "customer-request", sender: "customer", recipient: "coordinator", parentMessageId: null }, model: "test-model", input: "Untrusted customer data" };
const request = { model: "test-model", system: "Pinned instruction; return JSON.", input: spec.input, maxOutputTokens: 600 as const };
const message = { messageId: "message-1" };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fakeStore() {
  const store = { prepareModelStep: vi.fn(async () => ({ kind: "dispatch", requests: [request,{ ...request,system: "Correct invalid JSON output." }] })),
    reserveModelStep: vi.fn(async () => ({ attemptId: lease.token, attemptNumber: 1 })), finishModelStep: vi.fn(async () => ({ message })) };
  vi.spyOn(storage,"runStore").mockReturnValue(store as unknown as ReturnType<typeof storage.runStore>);
  return store;
}

test("malformed step/model inputs fail before storage or transport", async () => {
  const store = fakeStore(), send = vi.fn();
  await expect(executeModelStep({} as Pool,lease,{ ...spec,model: "../bad" },send)).rejects.toThrow();
  expect(store.prepareModelStep).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});

test("capacity denial prevents transport dispatch", async () => {
  const store = fakeStore(), send = vi.fn();
  store.reserveModelStep.mockRejectedValue(new storage.RunLimit("tokens"));
  await expect(executeModelStep({} as Pool,lease,spec,send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test("a timed-out attempt aborts, retains unknown usage and cannot checkpoint a late response", async () => {
  const store = fakeStore(); vi.useFakeTimers();
  let resolve!: (v: unknown) => void, signal!: AbortSignal;
  const send = vi.fn<ModelTransport>((_request,options) => { signal = options.signal; return new Promise((done) => { resolve = done; }); });
  const pending = executeModelStep({} as Pool,lease,spec,send).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(30000);
  expect(await pending).toBeInstanceOf(ModelStepError);
  expect(signal.aborted).toBe(true);
  expect(store.finishModelStep).toHaveBeenCalledWith(lease,spec.step.operationKey,lease.token,null,null);
  resolve({ text: "{}",usage: { input: 1,output: 1 } }); await Promise.resolve();
  expect(store.finishModelStep).toHaveBeenCalledOnce();
});

test("invalid output gets one separately reserved corrective attempt", async () => {
  const store = fakeStore();
  store.finishModelStep.mockResolvedValueOnce({ invalid: true } as never);
  store.reserveModelStep.mockResolvedValueOnce({ attemptId: lease.token,attemptNumber: 1 }).mockResolvedValueOnce({ attemptId: lease.token,attemptNumber: 2 });
  const send = vi.fn<ModelTransport>(async () => ({ text: "{}",usage: { input: 30,output: 10 } }));
  expect(await executeModelStep({} as Pool,lease,spec,send)).toEqual(message);
  expect(send).toHaveBeenCalledTimes(2); expect(store.reserveModelStep).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toMatchObject({ system: "Correct invalid JSON output.",maxOutputTokens: 600 });
  expect(send.mock.calls[0][1]).toMatchObject({ maxRetries: 0,timeoutMs: 30000 });
});


test("transport receives an immutable copy of the pinned request",async()=>{
  fakeStore();
  const send=vi.fn<ModelTransport>(async(request)=>{
    expect(Object.isFrozen(request)).toBe(true);
    expect(Reflect.set(request,"input","changed after reservation")).toBe(false);
    return { text: "{}",usage: null };
  });
  await executeModelStep({} as Pool,lease,spec,send);
});
