// GET /api/export.csv?runId= : the Customer dashboard numbers for one completed bulk run (FR-54). Read-only.
import { toCsv } from "@/lib/csv";
import { aging, isCompletedBulkRun, overview } from "@/lib/reports";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/; // same rule as the runs table
const plain = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const usd = (cents: number) => (cents / 100).toFixed(2);
const oneDecimal = (n: number | null) => (n === null ? null : n.toFixed(1)); // as the page shows it

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  if (!RUN_ID.test(runId)) return plain(400, "runId must be a run ID like bulk-20261015-1.");

  try {
    if (!(await isCompletedBulkRun(runId))) return plain(404, "No completed bulk run with that ID.");
    const [o, buckets] = await Promise.all([overview(runId), aging(runId)]);
    const csv = toCsv([
      {
        title: "Overview",
        header: ["metric", "value"],
        rows: [
          ["Recovered by cutoff (USD)", usd(o.recoveredCents)],
          ["Contacted balance (USD)", usd(o.contactedBalanceCents)],
          ["Recovery rate (%)", oneDecimal(o.recoveryRatePct)],
          ["First message to payment (days)", oneDecimal(o.daysFromOutreachToPayment)],
          ["Payment plans", o.plans],
          ["Promises to pay", o.promises],
          ["Handed to a person", o.handoffs],
        ],
      },
      {
        title: "Aging",
        header: ["bucket", "accounts", "starting balance (USD)", "recovered (USD)"],
        rows: buckets.map((b) => [b.bucket, b.accounts, usd(b.startingBalanceCents), usd(b.recoveredCents)]),
      },
    ]);
    return new Response(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="recovery-lab-${runId}.csv"` },
    });
  } catch {
    return plain(503, "The report database is unavailable. Try again shortly.");
  }
}
