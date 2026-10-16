# Recovery Lab: product plan

Status: planning, revised October 15, 2026. These are requirements, not claims that the app exists.

## Purpose

Build a small, original collections simulation for Akshay's conversation with Connor Ashton at Interval.ai, based on the job description Akshay supplied. Show one working example of every main responsibility in TypeScript, Next.js, Node.js, and PostgreSQL.

Target a focused two-day build. Ship a narrow working loop with visible evidence, not unfinished breadth. Everything uses synthetic data and a fictional business. No real outreach, payments, or affiliation claims.

## Coverage of the role

| Responsibility | Required evidence | Boundary to explain |
| --- | --- | --- |
| AI outreach and conversation quality | Real LLM agent, 12 scripted scenarios, baseline versus guarded system, replayable checks | Small behavioral suite, not a measure of all conversation quality |
| ML for timing, channel, and messaging | Bandit choosing channel, window, and tone; fixed baseline; held-out evaluation | Synthetic rewards, not real collection-rate lift |
| Customer dashboard | Balances, simulated recovery, outcomes, conversation detail | One business, read-only demo |
| Reporting and metrics | PostgreSQL queries, explicit denominators, aging, CSV | Simulated payment events and fixed reporting cutoff |
| End-to-end ownership and AI-assisted work | Deployed app, tests, CI, real development notes | Explain actual contributions and checks |

Production experience, startup history, and availability to work in Pleasant Grove belong in the application and conversation, not in app features.

## Required scope

- One fictional business: Northside Fitness. 100 deterministic demo accounts and 12 separate eval accounts.
- One live provider: OpenAI. One agent model, selected and validated before live calls.
- Scripted customer personas in every mode. They respond to agent messages and expose expected state only to the simulator and evaluator, never to the agent or guard.
- Baseline prompt without guards versus improved prompt with code guards. This is a system comparison, not an isolated prompt experiment.
- Hard checks for selected prohibited wording, supported amounts, initial notice, quiet hours, dispute handoff, and stopping contact. Report plan offering and agreed outcomes separately.
- Saved live agent responses, pinned replay, and a CI test that detects an intentional guard regression.
- Minimal learning picker over channel, window, and tone. This is required, not stretch scope.
- Three pages: Customer, Evals, Picker. Shared conversation detail with Previous/Next message controls.
- PostgreSQL, plain SQL migrations, one overview/aging CSV download, and read-only public deployment.
- Concise README and a rehearsed two-minute demo. Video optional.

## Deferred depth

No second provider, LLM customer simulator, model-based tone judge, fine-tuning, real delivery, payment integration, authentication, multiple customer tenants, live-run UI on the public site, separate walkthrough wizard page, autoplay, historical run browser, or elaborate chart library.

Scope change (2026-10-16, Akshay): the Evals page includes a short guided walkthrough of five recorded cases (setup, baseline, guarded, what the checks found), built only from recorded data. It is part of the Evals page, not a separate wizard.

Scope change (2026-10-16, Akshay): a "Try it" page where the visitor plays the customer and both agents answer live, side by side. It runs only on a local copy (APP_MODE=local and a key in the project .env file). The deployed public site still has no AI key and no working live endpoint; there the page explains how to run it locally.

Scope change (2026-10-16, Akshay): Integration 16 makes the Try page teachable. It adds 13 realistic customer situations, live-only guard rules v2 (the pinned evals keep v1), human corrections saved as lessons (soft lessons go into the prompt, hard lessons are enforced by code, both only after the person accepts a retried reply), a read-only public log of lessons, and deeper conversations (10 messages, time jumps, promise dates, three-payment plans, a "what the agent knows" panel). The model itself never changes. Details: plan Part D.

Use accessible tables and simple bars. These cuts preserve one working example of every job responsibility.

## Browser flow

1. Customer: synthetic-data label, source mode, run ID, reporting date, recovery metrics, aging, and conversations.
2. Evals: compare systems, select a dispute/stop case, inspect messages and checks.
3. Picker: learned choices, reward definition, fixed versus learned held-out results.

A single navigation bar and one explanation per page replace a separate guided tour.

## Honest measurement

The customer dashboard initially uses a deterministic mock-agent bulk run to avoid paying for 100 conversations. It always uses sms, friendly tone, and 10:00 local time; it does not consume the picker's choices. Label it "Synthetic accounts; mock outreach; simulated payments." Evals require a saved live-agent run, labeled "Live agent recording; scripted personas." Never combine these runs' recovery numbers or imply that customer metrics measure picker lift.

An agreement to pay is distinct from a simulated receipt. For this demo, every full-payment agreement produces a simulated receipt 1 to 3 days later. State the assumption beside recovery metrics and report at a fixed cutoff after those events. This demonstrates reporting, not collection effectiveness.

The picker trains, freezes its choices, then tests on new cases with a separate seed. Optimize payment and also report responses. Publish the actual comparison even if learned does not win. Never tune the test seed to manufacture lift.

Live baseline failures are not required. A deliberately bad test fixture proves the evaluator catches failures and is labeled as a test. Attribute improvements to the whole system because both prompt and guards change.

## Build sequence

| Slice | Deliverable | Completion boundary |
| --- | --- | --- |
| Day 1, first | Mock conversation core, one-account artifact, database import, basic Customer page | One real conversation and its metrics visible from PostgreSQL |
| Day 1, second | Complete scenarios/checks, live adapter, recording/replay, picker | Offline paths work; live evidence when credentials are ready |
| Day 2, first | Full dataset, remaining reports/pages, CSV, complete live evidence | All job responsibilities visible in browser |
| Day 2, second | Deployment, CI evidence, README, rehearsal | Release checks pass |

If time slips, reduce styling, chart complexity, and video polish. Keep evals, picker, SQL reporting, and deployed UI. Two days is a target, not permission to ship broken paths.

Request DB access during scaffold. Live access must not block database/UI work with mock artifacts; while DB access is pending, continue offline eval and picker work. Reuse the final schema/importer/page for the early slice instead of building a throwaway demo.

## Release checks

- [ ] Fresh clone runs mock evals and pinned live replay without keys or a database.
- [ ] All 12 scenarios run in both versions; 3 are adversarial; expected stop/dispute triggers are exercised.
- [ ] All applicable guarded-version hard checks pass in the selected live recording set. Do not weaken checks to obtain green.
- [ ] Actual baseline versus guarded results are visible, including ties or regressions.
- [ ] Establish green replay CI first, then remove the quiet-hours guard on a temporary branch. The independent replay job fails on quiet_hours, not missing recordings; save evidence, restore guard, confirm green.
- [ ] Picker shows held-out sample counts, payment/response rates, and percentage-point differences.
- [ ] Customer data excludes eval accounts; a manually checked sample agrees with SQL; CSV matches page.
- [ ] Offline tests stay database-free even when a test URL is set. The separate test:db command passes against the designated test DB; retain its result as release evidence.
- [ ] Three pages and conversation detail work on deployed site, narrow screens, and keyboard navigation.
- [ ] Public host has read-only DB credentials, no LLM key, and no write or live-run endpoint.
- [ ] README has tested setup, actual evidence, AI-assistance notes, limits, and no placeholders.

## Budget and setup

Target paid API spend below $10. Start with two scenarios. Do not rely on complimentary-token eligibility or unverified quotas. Record the chosen model and pricing before live calls. Configure a hard project spend limit below the target with margin for delayed enforcement; alerts alone do not stop spend. See [official OpenAI spend controls](https://developers.openai.com/api/docs/guides/spend-limits).

Local mock work needs no external account. Dashboard work needs PostgreSQL; prefer an existing accessible database. Vercel is the proposed web host. Ask for missing credentials or account actions only when needed, and continue independent local work.

See [DEMO-NOTES.md](DEMO-NOTES.md) for the pitch, future depth, and review of this revised plan.
