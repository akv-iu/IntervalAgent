# Where V2 stands

Updated October 20, 2026. Goal: a resume-ready four-agent demonstration, not a product to launch or sell. Numbered implementation phases are smaller steps inside the plan. The [portfolio completion boundary](PLAN.md#portfolio-completion-boundary) is the stopping point; production launch work is deferred.

| Milestone | Current state |
| --- | --- |
| Records and reliable case processing | Built and tested in code: two synthetic businesses, scoped tools, saved cases, sessions, jobs, recovery, cancellation and budget accounting. Local demo setup remains; hosted operation is deferred. |
| Four agents collaborating | Mock collaboration is built. Model-test workflow connects all four roles to SDK/checkpoints with fake HTTP, selected scoped tools, one revision and guarded handoff. A small real-model recording remains; no hosted activation is required. |
| Complete application walkthrough | Customer chat/status and the latest investigation's activity/evidence/pending proposal are implemented. Activity has isolated DB/API/client/render verification; browser acceptance and actual local setup remain open. Operator review/actions, simulated financial changes and confirmed replies remain. |
| Repeatable learning | Fixtures exist. Multiple feedback/candidate/evaluation cycles, eligibility-controlled decisions, version history and rollback remain. Full architecture benchmark, automatic promotion and elaborate learning dashboard are deferred. |
| Resume demonstration | Selected real-model evidence/replay, user browser acceptance, architecture diagram and local walkthrough remain. Public deployment, load targets and commercial readiness are outside scope. |

## Current step

Phase 16 is pushed to `v2` as `3b9a2b2`; `main` remains unchanged at `61b7ece`. Phase 17 locally adds saved role handoffs, tool outcomes, scoped evidence, pending proposals and provenance/resource use to the case screen. Read-only activity views keep private prompts, requests and worker identities out of the web role. STOP/new input hides older proposals; a pending amount is not an applied financial change. OpenAI calls remain disabled and the default worker remains mock. Only disposable test schemas were migrated; no application database setup or deployment occurred. [Phase 17 evidence](PHASE17-REVIEW.md).

## Decisions already agreed

Four roles: Customer, Coordinator, Investigator, Reviewer. OpenAI is the only live provider. Synthetic records remain the business evidence. Human approval precedes simulated financial changes. Improvement means evaluated, reversible lessons. V2 development stays on `v2`; `main` is reserved for V1 maintenance.

## Decisions to review with Akshay

Akshay selected customer dispute, then agent activity, then operator review, confirmed the existing style and approved the activity/evidence/proposal slice from the 7:28 PM usage checkpoint. Customer chat/status and visitor-safe activity are implemented. Operator screen decisions remain open.

Next: separately approved isolated mock setup for Akshay's browser test. Provide a working URL and steps after that setup, rather than asking him to test a default-off API. Operator case review, approve/reject/request-information and lightweight case selection follow. A local worker is enough; elaborate admin features stay deferred. Explicit spend controls are required before selected paid demonstrations. Activity reads require migration 012 and the updated web-view SELECT grants; neither has been applied to the application database.

## How each next step will work

Before coding: explain the user-visible result, meaningful choices, recommendation, deferred scope and verification. After coding: show the behavior, test/review evidence and remaining limits. "Move ahead" pushes the previously verified phase to `v2` and starts one bounded next step; live calls, application migrations and deployment are separate actions.

Akshay owns browser/web testing by default. Provide a ready URL, concise steps and expected results, then wait for his report. Only automate browser testing when he explicitly selects the assistant for that pass. After results/fixes, confirm who runs the next browser pass. Automated tests, typecheck/lint/build and two self-review/fix passes continue as appropriate. Earlier assistant browser evidence remains historical; it does not authorize future browser runs.

Before every next implementation phase, report fresh account usage/reset information, summarize the task and wait for explicit approval. Once approved, execute that phase autonomously, then ask again at the next boundary. The one-time October 20, 7:28 PM Mountain checkpoint delivered and its Windows task returned 0. At 7:28:15 PM, allowance remaining was 100% five-hour (next reset October 21, 12:28:15 AM Mountain) and 69% weekly (reset October 27, 8:02:49 AM Mountain). Akshay replied "Move ahead" and approved Phase 17. This is historical usage, not the allowance for a future task. Phone messages now reach this chat; phone push notifications remain unconfirmed. The checkpoint was a Windows task, not a ChatGPT Scheduled entry.

## Remaining work and planning estimate

The earlier 12-20/30-50-hour figures described the larger plan and are superseded by Akshay's resume-only scope correction. They are not a remaining-time commitment for this smaller demonstration. Re-estimate after the next activity/evidence slice using its actual effort instead of inventing a precise reduced total.

| Remaining slice | Enough for the resume demonstration |
| --- | --- |
| Local test setup and acceptance | Activity/evidence/proposal code is built. Prepare an isolated mock setup, then Akshay follows all four roles and tests a working local URL. |
| Human decisions and outcomes | Varied cases, lightweight selection, approve/reject/clarify with reason, effects committed once and guarded replies matching state. |
| Repeatable learning | Multiple feedback-derived candidates/versions across role/situation contexts, declared validation/regression evidence, manual activation/rejection, history and rollback. |
| Evidence and finish | Small budget-approved real four-role recording, strict replay, diagram, local setup instructions and short walkthrough. |

Keep correctness, authorization, STOP, scope isolation, budget limits and duplicate/stale-action checks. Demonstrate verified/partial payments, ambiguity/missing evidence, policy differences and tool failures using existing synthetic fixture work. Depth comes from different decisions and repeatable learning, not a single scripted case/lesson. Public hosting, elaborate administration, general connector abstractions, scale benchmarks and automatic lesson promotion stay deferred. Report failed lessons honestly and respect declared evaluation/spend bounds.

Immediate prerequisite: the actual V2 test environment has not been prepared/activated in the application database. `/v2` against the default-off API cannot provide a complete acceptance test. Prepare an isolated mock setup before asking Akshay to test; provide steps/results rather than the earlier temporary fake HTTP proxy.

[Full plan](PLAN.md) and [specification](SPEC.md) remain the build contract. This page does not replace their acceptance gates.
