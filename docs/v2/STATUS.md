# Where V2 stands

Updated October 20, 2026. This page tracks product progress; numbered implementation phases are smaller steps inside the ten-task plan.

| Milestone | Current state |
| --- | --- |
| Records and reliable case processing | Built and tested in code: two synthetic businesses, scoped tools, saved cases, sessions, jobs, recovery, cancellation and budget accounting. Hosted setup and real OAuth browser acceptance remain open. |
| Four agents collaborating | The deterministic mock workflow investigates and reviews a pending billing proposal. The OpenAI adapter and durable output checkpoints are tested with fake HTTP responses; the four roles are not connected to live models yet. |
| Complete application walkthrough | Customer workspace, visible agent activity, operator approval/rejection, simulated financial changes and confirmed customer replies remain to build. |
| Measured improvement | Evaluation fixtures exist. Comparable V2 evaluation/replay, candidate lessons, validation, promotion and rollback remain to build. |
| V2 release | Live evidence, performance measurements, browser acceptance and deployment remain open. |

## Current step

Phase 11 is pushed to `v2` as `73e86ac`. Phase 12 adds the single-attempt OpenAI adapter and is complete and verified for the user-requested push. Work is paused until usage resets and Akshay resumes. It does not enable live calls, change the default mock worker or deploy anything. [Contract and boundaries](MODEL-STEPS.md), [verification](DECISIONS.md).

## Decisions already agreed

Four roles: Customer, Coordinator, Investigator, Reviewer. OpenAI is the only live provider. Synthetic records remain the business evidence. Human approval precedes simulated financial changes. Improvement means evaluated, reversible lessons. V2 development stays on `v2`; `main` is reserved for V1 maintenance.

## Decisions to review with Akshay

Before UI implementation, choose whether the first visible walkthrough centers on the customer's dispute or the operator's review. Customer-first is the recommendation because it makes investigation progress and evidence visible from the entry point. This recommendation has not been accepted as a UI decision.

Review the screens, what the visitor may inspect, and the separation between internal agent activity and customer messages before building. Live model choice, actual spend controls and hosted worker setup also need an explicit bounded setup before any paid demonstration.

## How each next step will work

Before coding: explain the user-visible result, meaningful choices, recommendation, deferred scope and verification. After coding: show the behavior, test/review evidence and remaining limits. "Move ahead" pushes the previously verified phase to `v2` and starts one bounded next step; live calls, application migrations and deployment are separate actions.

[Full plan](PLAN.md) and [specification](SPEC.md) remain the build contract. This page does not replace their acceptance gates.
