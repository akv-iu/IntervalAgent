# Where V2 stands

Updated October 20, 2026. Goal: a resume-ready four-agent demonstration, not a product to launch or sell. Numbered implementation phases are smaller steps inside the plan. The [portfolio completion boundary](PLAN.md#portfolio-completion-boundary) is the stopping point; production launch work is deferred.

| Milestone | Current state |
| --- | --- |
| Records and reliable case processing | Built and tested in code: two synthetic businesses, scoped tools, saved cases, sessions, jobs, recovery, cancellation and budget accounting. Local demo setup remains; hosted operation is deferred. |
| Four agents collaborating | Mock collaboration is built. Model-test workflow connects all four roles to SDK/checkpoints with fake HTTP, selected scoped tools, one revision and guarded handoff. A small real-model recording remains; no hosted activation is required. |
| Complete application walkthrough | Customer chat and case-status UI are built and tested with fake HTTP. Agent activity/evidence, operator review/actions, simulated financial changes and confirmed customer replies remain to build. Real V2 setup/browser acceptance remains open. |
| Repeatable learning | Fixtures exist. Multiple feedback/candidate/evaluation cycles, eligibility-controlled decisions, version history and rollback remain. Full architecture benchmark, automatic promotion and elaborate learning dashboard are deferred. |
| Resume demonstration | Selected real-model evidence/replay, user browser acceptance, architecture diagram and local walkthrough remain. Public deployment, load targets and commercial readiness are outside scope. |

## Current step

Phase 15 is pushed to `v2` as `168c354`; `main` remains unchanged at `61b7ece`. Phase 16 implements the first [screen-contract slice](UI-JOURNEY.md): `/v2` starts an isolated reference case and `/v2/cases/{caseId}` restores chat/status, submits messages and stops contact through the existing APIs. It is verified locally and awaits review. OpenAI calls remain disabled and the default provider remains mock. No database setup or deployment was performed. [Phase 16 evidence](PHASE16-REVIEW.md).

## Decisions already agreed

Four roles: Customer, Coordinator, Investigator, Reviewer. OpenAI is the only live provider. Synthetic records remain the business evidence. Human approval precedes simulated financial changes. Improvement means evaluated, reversible lessons. V2 development stays on `v2`; `main` is reserved for V1 maintenance.

## Decisions to review with Akshay

Akshay selected customer dispute, then agent activity, then operator review, confirmed the existing style and said to move ahead with the first slice. Customer chat/status is now implemented. Activity/evidence disclosure and operator screens remain to review before their implementation.

Next: scoped activity/evidence/proposal reads, keeping internal exchanges separate from customer messages, and isolated local setup for Akshay's test. Reusable case review with approve/reject/request-information and lightweight case selection follows. A local worker is enough; elaborate admin features stay deferred. Explicit spend controls are required before selected paid demonstrations. This phase did not change the V2 database setup.

## How each next step will work

Before coding: explain the user-visible result, meaningful choices, recommendation, deferred scope and verification. After coding: show the behavior, test/review evidence and remaining limits. "Move ahead" pushes the previously verified phase to `v2` and starts one bounded next step; live calls, application migrations and deployment are separate actions.

Akshay owns browser/web testing by default. Provide a ready URL, concise steps and expected results, then wait for his report. Only automate browser testing when he explicitly selects the assistant for that pass. After results/fixes, confirm who runs the next browser pass. Automated tests, typecheck/lint/build and two self-review/fix passes continue as appropriate. Earlier assistant browser evidence remains historical; it does not authorize future browser runs.

Before every next implementation phase, report fresh account usage/reset information, summarize the task and wait for explicit approval. Once approved, execute that phase autonomously, then ask again at the next boundary. Requested checkpoint: October 20 at 7:28 PM America/Denver. Phone pairing is confirmed. A one-time Windows task (`RecoveryLab-Approval-20261020-1928`) is saved and verified Ready for 7:28 PM Mountain to queue the usage/approval request into this existing conversation. Implementation remains pending explicit approval. Keep the computer awake, signed in and ChatGPT open; phone notification delivery is untested. This is not a ChatGPT Scheduled entry. Latest observed usage at October 20, 6:09 PM Mountain: five-hour window 100% used (reset 7:27:51 PM), weekly window 31% used. This is a historical snapshot, not the allowance for the next task.

## Remaining work and planning estimate

The earlier 12-20/30-50-hour figures described the larger plan and are superseded by Akshay's resume-only scope correction. They are not a remaining-time commitment for this smaller demonstration. Re-estimate after the next activity/evidence slice using its actual effort instead of inventing a precise reduced total.

| Remaining slice | Enough for the resume demonstration |
| --- | --- |
| Activity and local test setup | Follow the four roles, scoped evidence and pending proposal; Akshay tests a working local URL. |
| Human decisions and outcomes | Varied cases, lightweight selection, approve/reject/clarify with reason, effects committed once and guarded replies matching state. |
| Repeatable learning | Multiple feedback-derived candidates/versions across role/situation contexts, declared validation/regression evidence, manual activation/rejection, history and rollback. |
| Evidence and finish | Small budget-approved real four-role recording, strict replay, diagram, local setup instructions and short walkthrough. |

Keep correctness, authorization, STOP, scope isolation, budget limits and duplicate/stale-action checks. Demonstrate verified/partial payments, ambiguity/missing evidence, policy differences and tool failures using existing synthetic fixture work. Depth comes from different decisions and repeatable learning, not a single scripted case/lesson. Public hosting, elaborate administration, general connector abstractions, scale benchmarks and automatic lesson promotion stay deferred. Report failed lessons honestly and respect declared evaluation/spend bounds.

Immediate prerequisite: the actual V2 test environment has not been prepared/activated in the application database. `/v2` against the default-off API cannot provide a complete acceptance test. Prepare an isolated mock setup before asking Akshay to test; provide steps/results rather than the earlier temporary fake HTTP proxy.

[Full plan](PLAN.md) and [specification](SPEC.md) remain the build contract. This page does not replace their acceptance gates.
