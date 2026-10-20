# Four-role model transport test

Phase 13 connects six role tasks to durable model checkpoints and scoped tools through an injected transport. Tests use the actual OpenAI SDK with scripted HTTP responses. This is an internal `model_test` harness, not a live worker or model-performance demonstration. The default CLI/worker still runs the deterministic [mock workflow](WORKFLOW.md).

Requirement coverage: partial V2-FR-07/08/09/12/13/36/37 and V2-NFR-01/02/04/05/06/07/08/10/11/16. Task 4 remains open.

## One internal pass

| Step | Sender / recipient | Work |
| --- | --- | --- |
| 1 | Customer / Coordinator | Summarize the accepted dispute as a task. |
| 2 | Coordinator / Investigator | Choose necessary requests from the pinned read-tool allowlist. |
| 3 | Investigator / Coordinator | Reconcile the actual selected tool results and cite their evidence. |
| 4 | Coordinator / Customer | Request a pending proposal from the finding. |
| 5 | Customer / Reviewer | Return a proposal with mandatory human approval and pending wording. |
| 6 | Reviewer / Coordinator | Approve internally, request revision or escalate. |

Customer and Coordinator each run twice; there are still exactly four roles. Independent selected reads overlap. Code rejects duplicate/unassigned requests before tool dispatch. The role-task kind is checked before an output checkpoint; a schema correction needs a separately counted reservation. Existing model/tool, run/daily, deadline and lease limits still apply.

The deterministic billing guard checks the finding, proposal, evidence, policy/arithmetic and exact pending wording independently of the model review. A model approval cannot override that guard. Any non-approval ends this one-pass harness with an internal escalation result and no pending proposal. Reviewer-requested model reinvestigation and revision loops are not implemented in this slice; the existing mock workflow retains its bounded correction behavior.

The guard is deliberately conservative: it requires canonical finding/pending language and reference ordering. The prompt supplies that format. There is no claim that these prompts, the 600-token output cap or this policy are effective with a live model; that requires bounded live compatibility/quality evaluation before activation.

## Requests, provenance and scope

`runCheckpointedModelTest(pool, claimedJob, model, send)` opens a fresh `model-billing-test-1` run with `mode: model_test`, an explicit model and all six full `billing-role-1` prompt strings pinned in the immutable snapshot. Existing runs cannot switch model or mode. Individual original/corrective requests, usage and completed envelopes retain the [model-step contract](MODEL-STEPS.md). No SQL migration or grant change is required for the additional validated snapshot fields.

Model-test runs cannot write mock role messages, run through the default mock worker or complete through the mock job-completion API. The default mock recipes, including legacy in-flight versions, remain supported. A successful return is an internal result only: the job remains running and case investigating. This harness does not publish a reply, move a case to human review, approve an action or change a ledger. Caller lifecycle integration and persisted final guard decisions remain future work.

Role inputs contain the source text, scoped evidence and only necessary message bodies. Runtime envelope IDs/timestamps are excluded. Parent context must have the expected kind. Shared body schemas validate nested proposals/tool arguments, and nested references, tool arguments and tool record data must match the actual scope. The stored source text and tool allowlist are checked against the pinned run before dispatch. Customer/record/agent text stays in the user-data channel and cannot redefine developer instructions, recipients or permissions. This follows the [official guidance on untrusted agent inputs](https://developers.openai.com/api/docs/guides/agent-builder-safety). JSON mode still needs [application-side schema validation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

There is no live-mode switch, credential loader, hosted worker, new HTTP route or public timeline API. The transport is a trusted injection point; tests pass fake HTTP explicitly. It must not be connected to real credentials under a test label.

## Verification and next boundary

`npm test` covers both businesses, response-selected tools, unsupported approvals and role-input validation. `npm run test:db` covers the actual SDK/checkpoint path, cached recovery, known usage on wrong-kind correction, rejected tool requests, provenance separation, STOP and budget denial. Scripted responses use existing development helpers; they are not independent evaluation answers or evidence of model reasoning. Final counts and both self-reviews are recorded in [DECISIONS.md](DECISIONS.md).

The next runtime boundary is model-directed revision/escalation and case/job completion with persisted guard results. Then the customer/operator walkthrough must be reviewed with Akshay before UI implementation. Live credentials/spend controls, activation, browser acceptance, financial effects, evaluated lessons and deployment remain separate work.
