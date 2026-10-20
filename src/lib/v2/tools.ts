import { z } from "zod";
import { EvidenceRef, ToolName, ToolRequest } from "./contracts";
import { Account, AccountScope, Allocation, Cancellation, Credit, Invoice, Payment, Policy, Records, activePolicy, evidenceFor, invoiceBalance, sameAccount } from "./records";

const Context = z.strictObject({ ...AccountScope.shape, role: z.literal("investigator") });
const refs = z.array(EvidenceRef).max(200);
const found = { status: z.literal("found"), evidenceRefs: refs };
const balance = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ToolResult = z.union([
  z.strictObject({ ...found, name: z.literal("invoice_details"), data: z.strictObject({ invoice: Invoice, balanceCents: balance, allocations: z.array(Allocation).max(50), credits: z.array(Credit).max(50) }) }),
  z.strictObject({ ...found, name: z.literal("payment_search"), data: z.strictObject({ payments: z.array(Payment).max(50), allocations: z.array(Allocation).max(50) }) }),
  z.strictObject({ ...found, name: z.literal("account_history"), data: z.strictObject({ account: Account, invoices: z.array(z.strictObject({ invoiceId: z.string(), dueDate: z.iso.date(), balanceCents: balance })).max(50) }) }),
  z.strictObject({ ...found, name: z.literal("adjustment_history"), data: z.strictObject({ cancellations: z.array(Cancellation).max(50), credits: z.array(Credit).max(50) }) }),
  z.strictObject({ ...found, name: z.literal("policy_lookup"), data: Policy }),
  z.strictObject({ status: z.enum(["not_found", "unavailable"]), name: ToolName, message: z.string().max(200), evidenceRefs: refs }),
]);
export type ToolResult = z.infer<typeof ToolResult>;

export function createReadTools(loadRecords: () => Promise<unknown>) {
  return {
    async execute(rawContext: unknown, rawRequest: unknown): Promise<ToolResult> {
      const context = Context.parse(rawContext);
      const request = ToolRequest.parse(rawRequest);
      if (request.accountId !== context.accountId) throw new Error("tool account mismatch");
      const unavailable = (): ToolResult => ({ status: "unavailable", name: request.name, message: "Records are unavailable. Try again later.", evidenceRefs: [] });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let data: Records;
      try {
        // shortcut: this stops waiting, not the loader; add query cancellation when loaders use external I/O.
        const timedOut = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("tool timeout")), 5000); });
        data = Records.parse(await Promise.race([loadRecords(), timedOut]));
      } catch {
        return unavailable();
      } finally { clearTimeout(deadline); }
      const config = data.businesses.find((b) => b.businessId === context.businessId);
      if (!config || !config.tools.includes(request.name)) throw new Error("tool not allowed for this business");
      const notFound = (): ToolResult => ({ status: "not_found", name: request.name, message: "No matching records.", evidenceRefs: [] });
      const account = data.accounts.find((a) => sameAccount(a, context));
      if (!account) return notFound();
      const invoices = data.invoices.filter((r) => sameAccount(r, context));
      const payments = data.payments.filter((r) => sameAccount(r, context));
      const allocations = data.allocations.filter((r) => sameAccount(r, context));
      const cancellations = data.cancellations.filter((r) => sameAccount(r, context));
      const credits = data.credits.filter((r) => sameAccount(r, context));
      const evidenceRefs: z.infer<typeof EvidenceRef>[] = [];
      const add = (type: z.infer<typeof EvidenceRef>["recordType"], rows: Parameters<typeof evidenceFor>[2][]) => {
        evidenceRefs.push(...rows.map((r) => evidenceFor(context, type, r)));
      };
      let result: unknown;
      switch (request.name) {
        case "invoice_details": {
          const invoice = invoices.find((i) => i.id === request.invoiceId);
          if (!invoice) return notFound();
          const applied = allocations.filter((a) => a.invoiceId === invoice.id);
          const adjusted = credits.filter((c) => c.invoiceId === invoice.id);
          add("invoice", [invoice]); add("allocation", applied); add("credit", adjusted);
          result = { invoice, balanceCents: invoiceBalance(data, context, invoice.id), allocations: applied, credits: adjusted };
          break;
        }
        case "payment_search":
          if (!payments.length) return notFound();
          add("payment", payments); add("allocation", allocations);
          result = { payments, allocations };
          break;
        case "account_history":
          add("account", [account]); add("invoice", invoices); add("allocation", allocations); add("credit", credits);
          result = { account, invoices: invoices.map((i) => ({ invoiceId: i.id, dueDate: i.dueDate, balanceCents: invoiceBalance(data, context, i.id) })) };
          break;
        case "adjustment_history":
          if (!cancellations.length && !credits.length) return notFound();
          add("cancellation", cancellations); add("credit", credits);
          result = { cancellations, credits };
          break;
        case "policy_lookup": {
          const policy = activePolicy(data, context);
          if (!policy) return notFound();
          add("policy", [policy]); result = policy;
          break;
        }
      }
      const parsed = ToolResult.safeParse({ status: "found", name: request.name, data: result, evidenceRefs });
      return parsed.success ? parsed.data : unavailable();
    },
  };
}
