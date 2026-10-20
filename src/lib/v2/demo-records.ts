import { z } from "zod";
import { createRng, randInt } from "../rng";
import { Records } from "./records";
import { Scope } from "./contracts";

// Development records only. Evaluation cases and hidden answer keys are separate work.
export function demoRecords(seed = 42): Records {
  z.number().int().min(0).max(2147483646).parse(seed);
  const rng = createRng(seed);
  const data: Records = { schemaVersion: 2, snapshotAt: "2026-03-10T16:00:00.000Z", businesses: [], accounts: [], invoices: [], payments: [], allocations: [], cancellations: [], credits: [], policies: [] };
  for (const businessId of ["northside", "subscriptions"]) {
    const scope = { businessId, workspaceId: "demo" };
    const version = seed + 1;
    data.businesses.push({ businessId, displayName: businessId === "northside" ? "Northside Fitness" : "Harbor Subscriptions", currency: "USD", policyVersion: version, tools: ["invoice_details", "payment_search", "account_history", "adjustment_history", "policy_lookup"] });
    data.policies.push({ ...scope, id: "policy-1", version, effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null, cancellationWindowDays: businessId === "northside" ? 7 : 1, maxInstallments: businessId === "northside" ? 3 : 2 });
    for (let i = 1; i <= 3; i++) {
      const base = { ...scope, accountId: `account-${i}`, version };
      data.accounts.push({ ...base, id: base.accountId, firstName: ["Maya", "Jordan", "Priya", "Luis"][randInt(rng, 0, 3)], currency: "USD", timezone: "America/Denver" });
      const amount = i === 1 ? 6400 : randInt(rng, 6000, 16000);
      data.invoices.push({ ...base, id: `invoice-${i}`, issuedAt: "2026-03-01T12:00:00.000Z", dueDate: "2026-03-05", lines: [
        { id: "membership", description: "Monthly service", amountCents: amount, serviceAt: "2026-03-01T12:00:00.000Z" },
        ...(i === 1 ? [{ id: "extra-service", description: "Additional service", amountCents: 2000, serviceAt: "2026-03-01T12:00:00.000Z" }] : []),
      ] });
      data.payments.push({ ...base, id: `payment-${i}`, receivedAt: "2026-03-06T12:00:00.000Z", reference: `customer-transfer-${i}`, status: "settled", amountCents: i === 1 ? 5000 : 1000 });
      if (i === 1) data.cancellations.push({ ...base, id: "cancellation-1", invoiceId: "invoice-1", lineId: "extra-service", requestedAt: "2026-03-04T12:00:00.000Z" });
      else data.allocations.push({ ...base, id: `allocation-${i - 1}`, paymentId: `payment-${i}`, invoiceId: `invoice-${i}`, amountCents: 1000 });
      if (i === 3) {
        data.cancellations.push({ ...base, id: "cancellation-3", invoiceId: "invoice-3", lineId: "membership", requestedAt: "2026-03-02T12:00:00.000Z" });
        data.credits.push({ ...base, id: "credit-1", invoiceId: "invoice-3", cancellationId: "cancellation-3", amountCents: 500 });
      }
    }
  }
  return Records.parse(data);
}

// Each anonymous workspace gets its own scoped copy of the development records.
export function workspaceRecords(rawScope: unknown): Records {
  const scope = Scope.parse(rawScope), data = demoRecords();
  const tables = ["accounts", "invoices", "payments", "allocations", "cancellations", "credits", "policies"] as const;
  const scoped = Object.fromEntries(tables.map((name) => [name, data[name].filter((r) => r.businessId === scope.businessId).map((r) => ({ ...r, workspaceId: scope.workspaceId }))]));
  return Records.parse({ ...data, ...scoped, businesses: data.businesses.filter((b) => b.businessId === scope.businessId) });
}
