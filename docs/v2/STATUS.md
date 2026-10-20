# Where V2 stands

Updated October 20, 2026. This page tracks product progress; numbered implementation phases are smaller steps inside the ten-task plan.

| Milestone | Current state |
| --- | --- |
| Records and reliable case processing | Built and tested in code: two synthetic businesses, scoped tools, saved cases, sessions, jobs, recovery, cancellation and budget accounting. Hosted setup and real OAuth browser acceptance remain open. |
| Four agents collaborating | Mock collaboration is built. The separate model-test workflow connects all four roles to SDK/checkpoints with fake HTTP, selects scoped tools, permits one feedback-driven revision, and saves a guarded proposal or escalation with atomic operator handoff. Live models and hosted activation remain open. |
| Complete application walkthrough | Customer workspace, visible agent activity, operator approval/rejection, simulated financial changes and confirmed customer replies remain to build. |
| Measured improvement | Evaluation fixtures exist. Comparable V2 evaluation/replay, candidate lessons, validation, promotion and rollback remain to build. |
| V2 release | Live evidence, performance measurements, browser acceptance and deployment remain open. |

## Current step

Phase 13 is pushed to `v2` as `cb1f0c1`; `main` remains unchanged. Phase 14's internal model-test revision/completion lifecycle is verified locally and awaits review. OpenAI calls remain disabled and the default provider remains mock. Worker progress now renews valid leases; the mock handler ceiling matches the existing 180-second run budget. No deployment was performed. [Workflow contract](MODEL-WORKFLOW.md), [verification](DECISIONS.md).

## Decisions already agreed

Four roles: Customer, Coordinator, Investigator, Reviewer. OpenAI is the only live provider. Synthetic records remain the business evidence. Human approval precedes simulated financial changes. Improvement means evaluated, reversible lessons. V2 development stays on `v2`; `main` is reserved for V1 maintenance.

## Decisions to review with Akshay

Akshay selected the customer dispute, then agent activity, then operator review as the focus for the next UI discussion. That establishes the journey to discuss; individual screens and disclosure rules still need review before implementation.

Review the screens, what the visitor may inspect, and the separation between internal agent activity and customer messages before building. Live model choice, actual spend controls and hosted worker setup also need an explicit bounded setup before any paid demonstration.

## How each next step will work

Before coding: explain the user-visible result, meaningful choices, recommendation, deferred scope and verification. After coding: show the behavior, test/review evidence and remaining limits. "Move ahead" pushes the previously verified phase to `v2` and starts one bounded next step; live calls, application migrations and deployment are separate actions.

[Full plan](PLAN.md) and [specification](SPEC.md) remain the build contract. This page does not replace their acceptance gates.
