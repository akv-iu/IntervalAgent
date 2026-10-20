import { demoRecords } from "../src/lib/v2/demo-records";
import { createReadTools } from "../src/lib/v2/tools";

const context = { businessId: "northside", workspaceId: "demo", accountId: "account-1", role: "investigator" };
const load = () => Promise.resolve(demoRecords());

test("all five tools return scoped, validated evidence with no hidden evaluation state", async () => {
  const tools = createReadTools(load);
  for (const name of ["invoice_details", "payment_search", "account_history", "adjustment_history", "policy_lookup"]) {
    const request = { name, accountId: "account-1", ...(name === "invoice_details" ? { invoiceId: "invoice-1" } : {}) };
    const result = await tools.execute(context, request);
    expect(result.status).toBe("found");
    expect(result.evidenceRefs.length).toBeGreaterThan(0);
    expect(result.evidenceRefs.every((e) => e.businessId === context.businessId && e.workspaceId === context.workspaceId && e.accountId === context.accountId)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/expectedOutcome|groundTruth|personaState|scenarioId/);
  }
});

test("wrong roles, malformed requests and forged account IDs are rejected before loading data", async () => {
  const source = vi.fn(load);
  const tools = createReadTools(source);
  for (const role of ["customer", "coordinator", "reviewer", "system"]) {
    await expect(tools.execute({ ...context, role }, { name: "payment_search", accountId: "account-1" })).rejects.toThrow();
  }
  await expect(tools.execute(context, { name: "execute_sql", accountId: "account-1" })).rejects.toThrow();
  await expect(tools.execute(context, { name: "payment_search", accountId: "account-2" })).rejects.toThrow();
  expect(source).not.toHaveBeenCalled();
});

test("matching external IDs in another business do not leak through lookup", async () => {
  const tools = createReadTools(load);
  const first = await tools.execute(context, { name: "policy_lookup", accountId: "account-1" });
  const second = await tools.execute({ ...context, businessId: "subscriptions" }, { name: "policy_lookup", accountId: "account-1" });
  expect(first).not.toEqual(second);
  expect((await tools.execute({ ...context, workspaceId: "other" }, { name: "payment_search", accountId: "account-1" })).status).toBe("not_found");
  expect((await tools.execute(context, { name: "invoice_details", accountId: "account-1", invoiceId: "invoice-2" })).status).toBe("not_found");
});

test("business tool allowlists are enforced even when the request schema is valid", async () => {
  const data = demoRecords();
  data.businesses[0].tools = ["invoice_details"];
  const tools = createReadTools(() => Promise.resolve(data));
  await expect(tools.execute(context, { name: "payment_search", accountId: "account-1" })).rejects.toThrow(/allowed/);
});

test("empty search results are different from service failure and do not expose errors", async () => {
  const tools = createReadTools(load);
  expect((await tools.execute({ ...context, accountId: "account-2" }, { name: "adjustment_history", accountId: "account-2" })).status).toBe("not_found");
  const broken = createReadTools(async () => { throw new Error("secret connection details"); });
  const result = await broken.execute(context, { name: "payment_search", accountId: "account-1" });
  expect(result.status).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("secret");
});

test("a timed-out loader returns unavailable and clears its deadline", async () => {
  vi.useFakeTimers();
  try {
    const tools = createReadTools(() => new Promise(() => {}));
    const pending = tools.execute(context, { name: "payment_search", accountId: "account-1" });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("tool results are snapshots and cannot mutate their backing records", async () => {
  const data = demoRecords();
  const original = structuredClone(data);
  const tools = createReadTools(() => Promise.resolve(data));
  const result = await tools.execute(context, { name: "invoice_details", accountId: "account-1", invoiceId: "invoice-1" });
  if (result.status !== "found" || result.name !== "invoice_details") throw new Error("expected invoice details");
  result.data.invoice.lines[0].amountCents = 1;
  result.evidenceRefs[0].version = 1;
  expect(data).toEqual(original);
});

test("malformed backing records fail closed without returning validation details", async () => {
  const data = demoRecords();
  data.invoices[0].accountId = "foreign-account";
  const result = await createReadTools(() => Promise.resolve(data)).execute(context, { name: "payment_search", accountId: "account-1" });
  expect(result.status).toBe("unavailable");
  expect(result.evidenceRefs).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("foreign-account");
});
