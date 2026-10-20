# Four-role model transport test

Phases 13-14 connect six role tasks to durable model checkpoints and scoped tools through an injected transport, with bounded revision and saved case handoff. Tests use the actual OpenAI SDK with scripted HTTP responses. This is an internal `model_test` harness, not a live worker or model-performance demonstration. The default CLI/worker still runs the deterministic [mock workflow](WORKFLOW.md).

Requirement coverage: partial V2-FR-07/08/09/12/13/36/37 and V2-NFR-01/02/04/05/06/07/08/10/11/16. Task 4 remains open.

## Collaboration and bounded revision

| Step | Sender / recipient | Work |
| --- | --- | --- |
| 1 | Customer / Coordinator | Summarize the accepted dispute as a task. |
| 2 | Coordinator / Investigator | Choose necessary requests from the pinned read-tool allowlist. |
| 3 | Investigator / Coordinator | Reconcile the actual selected tool results and cite their evidence. |
| 4 | Coordinator / Customer | Request a pending proposal from the finding. |
| 5 | Customer / Reviewer | Return a proposal with mandatory human approval and pending wording. |
| 6 | Reviewer / Coordinator | Approve internally, request revision or escalate. |

Customer and Coordinator each run twice; there are still exactly four roles. Independent selected reads overlap. Code rejects duplicate/unassigned requests before tool dispatch. The role-task kind is checked before an output checkpoint; a schema correction needs a separately counted reservation. Existing model/tool, run/daily, deadline and lease limits still apply.

The deterministic billing guard checks the finding, proposal, evidence, policy/arithmetic and exact pending wording independently of the model review. A model approval cannot override that guard. Both must approve to retain a pending proposal. Either may immediately escalate missing evidence or a case requiring human judgement.

New `model-billing-test-2` snapshots allow one revision: steps 2-6 run again, with the actual Reviewer message as Coordinator's parent and both review/code-guard bodies supplied throughout the correction. Coordinator selects scoped reads again; new operation keys checkpoint fresh selected reads while earlier results remain available. Review tool names are feedback, not executable instructions. A second unsuccessful review escalates with a saved reason and no proposal. Six initial tasks plus five correction tasks fit the 12-request ceiling, leaving at most one schema-correction request. The existing mock workflow still permits up to two revisions. Legacy `model-billing-test-1` snapshots retain their original one-pass operation keys, inputs and no-revision behavior.

The guard is deliberately conservative: it requires canonical finding/pending language and reference ordering. The prompt supplies that format. There is no claim that these prompts, the 600-token output cap or this policy are effective with a live model; that requires bounded live compatibility/quality evaluation before activation.

## Requests, provenance and scope

`runCheckpointedModelTest(pool, claimedJob, model, send)` opens a fresh `model-billing-test-2` run with `mode: model_test`, an explicit model and all six full `billing-role-1` prompt strings pinned in the immutable snapshot. Existing runs cannot switch model or mode. Individual original/corrective requests, usage and completed envelopes retain the [model-step contract](MODEL-STEPS.md). No SQL migration or grant change is required. This low-level helper still returns without completing a job.

Model-test runs cannot write mock role messages, run through the default mock worker or complete through the mock job-completion API. The default mock recipes, including legacy in-flight versions, remain supported.

`processModelTestJob` processes an already claimed job with an explicitly injected test transport. During role preparation, an unexpired, matching lease is renewed to 60 seconds; renewal never revives an expired/stale lease or resets the 180-second run deadline. The wrapper completes verified outcomes, queues ordinary failures through existing bounded retries, pauses resource-limit failures for an operator, and reports stale ownership after cancellation/STOP.

`runStore.completeModelTest(lease)` accepts no caller-authored result. Under case/job/run locks it replays the workflow using only saved model pins, completed messages and settled tools. It checks operation ordering, exact parent/routing, pinned inputs/model/system/hash and complete message coverage, then recomputes the code guard. Missing, extra, unfinished or mismatched checkpoints fail closed. No SDK call or new tool read occurs during this reconstruction. The saved job result contains test provenance, review linkage, revision count, guard, reason, evidence and any pending proposal/preview. Job success, the case transition to `awaiting_human` and its audit event commit together. Completion rechecks lease/deadline before writing. Repeated or stale completion cannot duplicate the handoff. The low-level API rejects it; the lifecycle wrapper reports stale ownership.

Escalation is a persisted system handoff reason, not an invented model message. A succeeded job means processing finished; it does not mean a dispute was resolved. No customer reply is published, no human approval is granted and no ledger is changed.

Role inputs contain the source text, scoped evidence and only necessary message bodies. Runtime envelope IDs/timestamps are excluded. Parent context must have the expected kind. Shared body schemas validate nested proposals/tool arguments, and nested references, tool arguments and tool record data must match the actual scope. The stored source text and tool allowlist are checked against the pinned run before dispatch. Customer/record/agent text stays in the user-data channel and cannot redefine developer instructions, recipients or permissions. This follows the [official guidance on untrusted agent inputs](https://developers.openai.com/api/docs/guides/agent-builder-safety). JSON mode still needs [application-side schema validation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

There is no live-mode switch, credential loader, hosted worker, new HTTP route or public timeline API. The transport is a trusted injection point; tests pass fake HTTP explicitly. It must not be connected to real credentials under a test label.

## Verification and next boundary

`npm test` covers both businesses, response-selected tools, unsupported approvals, bounded correction/escalation and role-input validation. `npm run test:db` covers the SDK/checkpoint path, cached recovery, wrong-kind correction, rejected tool requests, provenance separation, STOP, budgets, lifecycle retries, atomic handoff and restricted worker permissions. Scripted responses use existing development helpers; they are not independent evaluation answers or evidence of model reasoning. Final evidence and both self-reviews are recorded in [DECISIONS.md](DECISIONS.md).

The next product boundary is reviewing the customer/operator walkthrough with Akshay before UI implementation. Live provenance/activation, credentials/spend controls, hosted polling, model quality/latency, browser acceptance, financial effects, evaluated lessons and deployment remain separate work. The test wrapper must not be wired to real credentials under a test label.
