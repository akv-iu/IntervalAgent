import { connection } from "next/server";
import { Suspense } from "react";
import LiveChat, { type LiveCustomer } from "@/components/LiveChat";
import PageHeader from "@/components/PageHeader";
import { formatCents } from "@/lib/format";
import { tryMode } from "@/lib/project-env";
import LessonsLog from "@/components/LessonsLog";
import type { Lesson } from "@/lib/lessons";
import { redact } from "@/lib/env";
import { lessonsLog } from "@/lib/reports";
import { PRESETS } from "@/lib/situations";
import { SCENARIOS } from "@/lib/sim/scenarios";

export default function TryPage() {
  return (
    <>
      <PageHeader
        title="Try it: talk to both agents"
        lede="You play the overdue customer. Both versions of the agent answer every message you send, live, using the same model. Watch what the guard does differently."
      />
      <Suspense
        fallback={
          <p className="mt-6 text-sm text-muted">
            Checking whether the live demo is available...
          </p>
        }
      >
        <Try />
      </Suspense>
    </>
  );
}

// Lessons come from PostgreSQL. Without a database the chat still works and lessons are off.
// Visitors on the public site see no database details; locally the reason helps fix the setup.
async function loadLessons(isPublic: boolean): Promise<{
  lessons: Lesson[];
  off: string | null;
}> {
  try {
    return { lessons: await lessonsLog(), off: null };
  } catch (e) {
    return {
      lessons: [],
      off: isPublic
        ? "Lessons are unavailable right now. The chat still works."
        : `Lessons are off: the database is not reachable (${redact(e instanceof Error ? e.message : String(e))}).`,
    };
  }
}

async function Try() {
  await connection(); // reads the local .env at request time
  const mode = tryMode(); // the same switch as the API route
  const isPublic = mode.kind === "public";
  const model = mode.kind === "public" ? mode.model : mode.kind === "local" && mode.agent === "live" ? mode.env.OPENAI_AGENT_MODEL : null;
  const { lessons, off } = await loadLessons(isPublic);

  if (mode.kind === "off") {
    return (
      <>
        <section className="mt-6 max-w-2xl rounded-xl border border-line p-5 text-ink-2">
          <h2 className="text-lg font-semibold text-ink">
            The live demo runs on a local copy only
          </h2>
          <p className="mt-2">
            It calls the OpenAI API, so it needs a key. This public site
            deliberately has no AI key and makes no AI calls, so strangers
            cannot run up costs. The Evals page shows the recorded results
            instead.
          </p>
          <p className="mt-2 text-sm">
            To try it yourself: clone the repository, put APP_MODE=local in a
            .env file, run npm run dev, and open /try. It starts with a scripted
            mock agent; to use the real model, also add OPENAI_API_KEY,
            OPENAI_AGENT_MODEL, and LIVE_DEMO_PROVIDER=live.
          </p>
        </section>
        <section className="mt-8 space-y-3" aria-label="Lessons learned">
          <h2 className="text-lg font-semibold">
            Lessons taught on a local copy
          </h2>
          <p className="max-w-2xl text-sm text-ink-2">
            On the local Try page a person can correct the guarded agent: write
            what it should have done, retry the same moment, and keep the lesson
            only if the new reply is right. The model never changes. Soft
            lessons are added to the instructions; hard lessons are checked by
            code. This is a read-only record of those corrections, with the
            reply before and after.
          </p>
          {off ? (
            <p className="text-sm text-muted">
              Lessons are not available right now.
            </p>
          ) : (
            <LessonsLog lessons={lessons} />
          )}
        </section>
      </>
    );
  }

  const customers: LiveCustomer[] = SCENARIOS.map((s) => {
    const city =
      s.account.timezone === "America/Denver" ? "Denver" : "New York";
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
        <p className="font-semibold text-accent-ink">
          {isPublic
            ? `Live model: ${model}. Synthetic customers; nothing is sent. Lessons you accept are saved and shown here to everyone.`
            : model
              ? `Live model: ${model}. Synthetic customers; nothing is sent. Only lessons you accept are saved.`
              : "Mock agent: scripted replies, no AI calls, no tokens spent. Synthetic customers; nothing is sent. Only lessons you accept are saved."}
        </p>
        {!model && (
          <p className="mt-1 text-ink-2">
            To use the real model, add LIVE_DEMO_PROVIDER=live to the .env file
            and restart the dev server.
          </p>
        )}
        <p className="mt-1 text-ink-2">
          Pick a situation and play the customer. The grey lines under each
          guarded reply show what the guard did.
        </p>
        <p className="mt-1 text-ink-2">
          Try &quot;I&apos;ll pay Friday&quot;, ask for three payments, or click
          &quot;Customer goes quiet&quot;. Then open &quot;What the agent
          knows&quot;.
        </p>
      </div>
      <LiveChat
        customers={customers}
        presets={PRESETS}
        model={model}
        initialLessons={lessons}
        lessonsOff={off}
        canDelete={!isPublic}
      />
    </div>
  );
}
