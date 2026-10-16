import { connection } from "next/server";
import { Suspense } from "react";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import SourceLabel from "@/components/SourceLabel";
import { formatDate, pct, pts } from "@/lib/format";
import { latestRun, pickerSummary } from "@/lib/reports";

const SEGMENTS = ["1-30", "31-60", "61-90", "91-120"] as const;
const HOURS = { morning: "10:00", evening: "18:00" } as const;
type Arm = { channel: "sms" | "email"; window: "morning" | "evening"; tone: "friendly" | "formal" };
const armText = (a: Arm) => `${a.channel === "sms" ? "SMS" : "Email"}, ${a.window} (${HOURS[a.window]} local), ${a.tone}`;

export default function PickerPage() {
  return (
    <>
      <PageHeader
        title="Picker: learned outreach choices"
        lede="A small learning system picks the channel, send time, and tone for each group of overdue accounts. It trains, freezes its choices, then is tested on new simulated customers against a fixed default."
      />
      <Suspense fallback={<p className="mt-6 text-sm text-muted">Loading picker results...</p>}>
        <Picker />
      </Suspense>
    </>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="mt-1 h-2 rounded-full bg-tint-2">
      <div className="h-2 rounded-full bg-accent" style={{ width: `${max > 0 ? (100 * value) / max : 0}%` }} aria-hidden="true" />
    </div>
  );
}

async function Picker() {
  await connection();
  const run = await latestRun("picker");
  if (!run) {
    return (
      <div className="mt-6">
        <EmptyState what="picker run" />
      </div>
    );
  }

  const rows = await pickerSummary(run.id);
  const m = run.metadata as {
    selected?: Record<string, Arm>;
    fixedArm?: Arm;
    trainSeed?: number;
    testSeed?: number;
    exploreSeed?: number;
    epsilon?: number;
    counts?: { trainPerSegment: number; testPerSegment: number };
  };
  const segments = [...SEGMENTS, "all"] as const;
  const get = (segment: string, strategy: "fixed" | "learned") => rows.find((r) => r.segment === segment && r.strategy === strategy);
  const maxPay = Math.max(...rows.map((r) => r.payRate), 0);
  const lowestPay = Math.min(...rows.filter((r) => r.segment !== "all").map((r) => r.payRate));

  return (
    <div className="mt-6 space-y-12">
      <SourceLabel
        label="Synthetic customers with made-up response and payment odds. One train/test split; illustrates the method, not real-world lift or statistical significance."
        items={[
          ["Run", run.id],
          ["Source", run.sourceMode],
          ["Seeds (train / test / explore)", `${m.trainSeed} / ${m.testSeed} / ${m.exploreSeed}`],
          ["Created", formatDate(run.createdAt)],
        ]}
      />

      <section aria-labelledby="how">
        <h2 id="how" className="text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5 text-ink-2">
          <li>
            <strong>Reward:</strong> 1 if the simulated customer pays, 0 otherwise. Replies are reported but not optimized.
          </li>
          <li>
            <strong>Training:</strong> {m.counts?.trainPerSegment ?? "n/a"} cases per group. Each of the 8 options is tried once, then the best so far is
            used, with a random option {m.epsilon !== undefined ? `${Math.round(m.epsilon * 100)}%` : "n/a"} of the time to keep exploring.
          </li>
          <li>
            <strong>Test:</strong> choices are frozen, then {m.counts?.testPerSegment ?? "n/a"} new cases per group are run with both the learned choice
            and the fixed default ({m.fixedArm ? armText(m.fixedArm) : "n/a"}), facing the same simulated customers. Only test cases count below.
          </li>
        </ul>
      </section>

      <section aria-labelledby="choices">
        <h2 id="choices" className="text-xl font-semibold tracking-tight">
          Frozen choices by days past due
        </h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-3 py-2">
                  Days past due
                </th>
                <th scope="col" className="px-3 py-2">
                  Learned choice
                </th>
              </tr>
            </thead>
            <tbody>
              {SEGMENTS.map((s) => (
                <tr key={s} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {s}
                  </th>
                  <td className="px-3 py-2">{m.selected?.[s] ? armText(m.selected[s]) : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="results">
        <h2 id="results" className="text-xl font-semibold tracking-tight">
          Held-out test results
        </h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-3 py-2">
                  Days past due
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Cases each
                </th>
                <th scope="col" className="px-3 py-2">
                  Paid: fixed
                </th>
                <th scope="col" className="px-3 py-2">
                  Paid: learned
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Difference
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Replied: fixed / learned
                </th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => {
                const f = get(s, "fixed");
                const l = get(s, "learned");
                if (!f || !l) return null;
                return (
                  <tr key={s} className={`border-b border-line last:border-0 ${s === "all" ? "font-semibold" : ""}`}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {s === "all" ? "All groups" : s}
                    </th>
                    <td className="px-3 py-2 text-right">{f.n}</td>
                    <td className="px-3 py-2">
                      {pct(f.payRate)}
                      <Bar value={f.payRate} max={maxPay} />
                    </td>
                    <td className="px-3 py-2">
                      {pct(l.payRate)}
                      <Bar value={l.payRate} max={maxPay} />
                    </td>
                    <td className="px-3 py-2 text-right">{pts(100 * (l.payRate - f.payRate))}</td>
                    <td className="px-3 py-2 text-right">
                      {pct(f.respondRate)} / {pct(l.respondRate)} ({pts(100 * (l.respondRate - f.respondRate))})
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-3xl text-sm text-muted">
          Differences are in percentage points (learned minus fixed). With payment rates as low as {pct(lowestPay)} in some groups, a few hundred
          cases are not enough to be sure the learner found the best option; the result is reported as it came out.
        </p>
      </section>
    </div>
  );
}
