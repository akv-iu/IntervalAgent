// Home page hero: what this is, where to go next, and one real conversation from the run told as a timeline.
// No hooks: a server component. The events rise in once (CSS only) and stay still when reduced motion is set.
import Link from "next/link";
import type { HeroEvent, HeroStory } from "@/lib/hero";

const MARK: Record<HeroEvent["kind"], string> = {
  sent: "bg-accent",
  checks: "bg-pass",
  reply: "bg-ink-2",
  paid: "bg-pass",
};

export default function Hero({ story }: { story: HeroStory | null }) {
  return (
    <section aria-labelledby="hero-title" className="grid items-center gap-10 border-b border-line pb-12 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
      <div className="min-w-0">
        <h1 id="hero-title" className="max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          An AI collections agent, tested like production software
        </h1>
        <p className="mt-5 max-w-xl text-base text-ink-2 sm:text-lg">
          A live model writes past-due payment messages for a fictional gym. Code checks every draft, scripted customers try to break it, and every
          number on this site comes from a recorded run.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/try" className="rounded-md bg-accent-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#00529f]">
            Try the agent
          </Link>
          <Link href="/evals" className="rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent">
            See the evals
          </Link>
        </div>
      </div>

      {story && (
        <figure className="min-w-0 rounded-2xl border border-tint-2 bg-tint p-5 sm:p-6">
          <figcaption className="text-sm text-ink-2">
            <span className="font-semibold text-ink">{story.title}</span>, one conversation from the latest run
          </figcaption>
          <ol className="relative mt-5 space-y-4 border-l-2 border-tint-2 pl-6">
            {story.events.map((e, i) => (
              <li key={e.kind} className="hero-event relative" style={{ animationDelay: `${150 + i * 350}ms` }}>
                <span aria-hidden="true" className={`absolute -left-[31px] top-3 size-3 rounded-full ring-4 ring-tint ${MARK[e.kind]}`} />
                <div className="rounded-lg border border-line bg-white px-3.5 py-2.5 shadow-[0_1px_0_rgba(43,40,39,0.04)]">
                  <p className={`text-sm font-semibold ${e.kind === "paid" ? "text-pass" : "text-ink"}`}>{e.title}</p>
                  <p className="mt-0.5 break-words text-sm text-ink-2">{e.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs text-muted">
            Synthetic customer, mock agent, simulated payment.{" "}
            <a href="#convs" className="font-medium text-accent-ink underline underline-offset-2">
              Find {story.firstName} in the conversations below
            </a>
            .
          </p>
        </figure>
      )}
    </section>
  );
}
