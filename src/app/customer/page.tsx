import { connection } from "next/server";
import { cache, Suspense } from "react";
import ConversationBrowser from "@/components/ConversationBrowser";
import EmptyState from "@/components/EmptyState";
import Hero from "@/components/Hero";
import SourceLabel from "@/components/SourceLabel";
import { formatCents, formatDate, OUTCOME_LABEL, toDetailMessages } from "@/lib/format";
import { heroStory } from "@/lib/hero";
import { aging, conversations, latestRun, messagesForRun, overview } from "@/lib/reports";

export default function CustomerPage() {
  return (
    <>
      {/* The headline shows at once; the conversation timeline arrives with the data. */}
      <Suspense fallback={<Hero story={null} />}>
        <HeroWithStory />
      </Suspense>
      <header className="mt-10">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Customer dashboard</h2>
        <p className="mt-2 max-w-2xl text-base text-ink-2">
          What a business owner sees after an outreach run: money recovered, how old the debt was, and every conversation.
        </p>
      </header>
      <Suspense fallback={<Loading />}>
        <Customer />
      </Suspense>
    </>
  );
}

// One load per request, shared by the hero and the dashboard (React cache), so the hero adds no queries.
const loadRun = cache(async () => {
  await connection(); // database reads happen per request, never at build time
  const run = await latestRun("bulk");
  if (!run) return null;
  const [o, buckets, convs, byConv] = await Promise.all([overview(run.id), aging(run.id), conversations(run.id), messagesForRun(run.id)]);
  return { run, o, buckets, convs, byConv };
});

async function HeroWithStory() {
  const data = await loadRun();
  return <Hero story={data ? heroStory(data.convs, data.byConv) : null} />;
}

function Loading() {
  return <p className="mt-6 text-sm text-muted">Loading the latest run...</p>;
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="py-1">
      <dd className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{value}</dd>
      <dt className="mt-1 text-sm font-medium text-ink-2">{label}</dt>
      {note && <dd className="text-xs text-muted">{note}</dd>}
    </div>
  );
}

async function Customer() {
  const data = await loadRun();
  if (!data) {
    return (
      <div className="mt-6">
        <EmptyState what="bulk simulation" />
      </div>
    );
  }

  const { run, o, buckets, convs, byConv } = data;
  const tz = Object.fromEntries(convs.map((c) => [c.id, c.timezone]));
  const detail = Object.fromEntries(Object.entries(byConv).map(([id, msgs]) => [id, toDetailMessages(msgs, tz[Number(id)])]));
  const maxBalance = Math.max(...buckets.map((b) => b.startingBalanceCents), 1);
  const days = o.daysFromOutreachToPayment;

  return (
    <div className="mt-6 space-y-12">
      <SourceLabel
        label="Synthetic accounts; mock outreach; simulated payments."
        items={[
          ["Run", run.id],
          ["Source", run.sourceMode],
          ["Reporting cutoff", run.reportAsOf ? formatDate(run.reportAsOf) : "n/a"],
          ["Created", formatDate(run.createdAt)],
        ]}
      />

      <section aria-labelledby="metrics">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="metrics" className="text-xl font-semibold tracking-tight">
            Recovery, simulated
          </h2>
          <a href={`/api/export.csv?runId=${encodeURIComponent(run.id)}`} download className="text-sm font-medium text-accent-ink underline underline-offset-2">
            Download CSV (overview and aging)
          </a>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-6 sm:grid-cols-4">
          <Stat value={formatCents(o.recoveredCents)} label="Recovered by cutoff" />
          <Stat value={formatCents(o.contactedBalanceCents)} label="Contacted balance" note="original balance of accounts contacted" />
          <Stat value={o.recoveryRatePct === null ? "n/a" : `${o.recoveryRatePct.toFixed(1)}%`} label="Recovery rate" note="recovered / contacted balance" />
          <Stat value={days === null ? "n/a" : `${days.toFixed(1)} days`} label="First message to payment" note="average over payments by cutoff" />
        </dl>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {[
            ["Payment plans", o.plans, "agreed, not yet paid"],
            ["Promises to pay", o.promises, "not counted as recovered"],
            ["Handed to a person", o.handoffs, "disputes"],
          ].map(([label, n, note]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dd className="text-lg font-semibold tabular-nums">{n}</dd>
              <dt className="text-ink-2">
                {label} <span className="text-muted">({note})</span>
              </dt>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-3xl text-sm text-muted">
          Assumption: every full-payment agreement produces a simulated payment 1 to 3 days later. Plans and promises recover nothing here. This shows
          reporting, not real collection performance.
        </p>
      </section>

      <section aria-labelledby="aging">
        <h2 id="aging" className="text-xl font-semibold tracking-tight">
          Starting backlog by days past due
        </h2>
        <p className="mt-1 text-sm text-muted">Original balances of the accounts contacted in this run, at the start of the simulation.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  Days past due
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Accounts
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Starting balance
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Recovered, simulated
                </th>
                <th scope="col" className="w-1/3 px-3 py-2 font-medium">
                  Starting balance, relative
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.bucket} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {b.bucket}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{b.accounts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(b.startingBalanceCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(b.recoveredCents)}</td>
                  <td className="px-3 py-2">
                    <div className="h-2.5 rounded-full bg-tint-2">
                      <div className="h-2.5 rounded-full bg-accent" style={{ width: `${(100 * b.startingBalanceCents) / maxBalance}%` }} aria-hidden="true" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="convs">
        <h2 id="convs" className="text-xl font-semibold tracking-tight">
          Conversations ({convs.length})
        </h2>
        <p className="mt-1 text-sm text-muted">Choose a customer to step through the conversation one message at a time.</p>
        <div className="mt-4">
          <ConversationBrowser
            rows={convs.map((c) => ({
              id: c.id,
              name: c.firstName,
              meta: `${c.accountKey}, ${c.agingBucket} days past due`,
              outcome: OUTCOME_LABEL[c.outcome] ?? c.outcome,
              handedToHuman: c.handedToHuman,
              amount: formatCents(c.recoveredByCutoffCents),
            }))}
            messages={detail}
          />
        </div>
      </section>
    </div>
  );
}
