import { connection } from "next/server";
import { Suspense } from "react";
import LiveChat, { type LiveCustomer } from "@/components/LiveChat";
import PageHeader from "@/components/PageHeader";
import { formatCents } from "@/lib/format";
import { projectEnv } from "@/lib/project-env";
import { SCENARIOS } from "@/lib/sim/scenarios";

export default function TryPage() {
  return (
    <>
      <PageHeader
        title="Try it: talk to both agents"
        lede="You play the overdue customer. Both versions of the agent answer every message you send, live, using the same model. Watch what the guard does differently."
      />
      <Suspense fallback={<p className="mt-6 text-sm text-muted">Checking whether the live demo is available...</p>}>
        <Try />
      </Suspense>
    </>
  );
}

async function Try() {
  await connection(); // reads the local .env at request time
  const env = projectEnv();
  const local = process.env.APP_MODE === "local" && env.APP_MODE === "local"; // must be explicit, as in the API route
  const available = local && Boolean(env.OPENAI_API_KEY && env.OPENAI_AGENT_MODEL);

  if (!available) {
    return (
      <section className="mt-6 max-w-2xl rounded-xl border border-line p-5 text-ink-2">
        <h2 className="text-lg font-semibold text-ink">The live demo runs on a local copy only</h2>
        <p className="mt-2">
          It calls the OpenAI API, so it needs a key. This public site deliberately has no AI key and makes no AI calls, so strangers cannot run up costs.
          The Evals page shows the recorded results instead.
        </p>
        <p className="mt-2 text-sm">
          To try it yourself: clone the repository, put APP_MODE=local, OPENAI_API_KEY, and OPENAI_AGENT_MODEL in a .env file, run npm run dev, and open /try.
        </p>
      </section>
    );
  }

  const customers: LiveCustomer[] = SCENARIOS.map((s) => {
    const city = s.account.timezone === "America/Denver" ? "Denver" : "New York";
    const h = s.startHour;
    return {
      id: s.id,
      label: `${s.account.firstName}, owes ${formatCents(s.account.balanceCents)}, ${city}`,
      startsAt: `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"} local`,
      timezone: s.account.timezone,
    };
  });

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg border border-tint-2 bg-tint px-4 py-3 text-sm">
        <p className="font-semibold text-accent-ink">Live model: {env.OPENAI_AGENT_MODEL}. Synthetic customers; nothing is sent or saved.</p>
        <p className="mt-1 text-ink-2">
          Customers come from the eval set, so some first messages fall outside 8am to 9pm on purpose. Try the suggested replies: a payment plan, a dispute,
          STOP, a dare to threaten, or a wrong balance.
        </p>
      </div>
      <LiveChat customers={customers} model={env.OPENAI_AGENT_MODEL!} />
    </div>
  );
}
