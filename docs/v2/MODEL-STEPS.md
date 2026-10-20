# Durable model-step checkpoints

Requirement coverage: foundations for V2-FR-07/08/12/13/36/37 and V2-NFR-01/02/04/05/06/08/16. Live model roles and the full Task 4 acceptance gate remain open.

Phase 11 adds a trusted worker primitive, `executeModelStep(pool, lease, spec, send)`. Tests inject a fake transport against PostgreSQL. The default worker and CLI still run deterministic mocks. Phase 12 adds the OpenAI adapter described below. There is no enabled live mode, model-selected routing, new HTTP endpoint or public UI in this slice.

`spec` contains a validated operation/role/recipient/parent, explicit model name and at most 8,000 characters of worker-selected input. Input is untrusted task data, not instructions. The run snapshot supplies versioned role instructions and the pinned `none` lesson set. Two complete requests are pinned before dispatch: original and a fixed schema-correction instruction. Invalid output is never copied into instructions. All steps in a run must use the same model. Reusing a key with changed input, model, routing or parent fails closed.

The immutable request pin is separate from the run snapshot, whose mode remains `mock`; a fake transport does not establish live provenance. Adding genuine model workflows requires explicit mode/provenance and role-specific prompts/contracts, not relabeling these tests as model evidence.

## Dispatch and accounting

1. Prepare the request pin under the current scoped lease. A completed pin returns its saved envelope without dispatch or another charge.
2. Commit a reservation before each transport call. Input capacity is the larger UTF-8 JSON request byte length plus 128; output capacity is 600. Oversized requests fail before dispatch. This conservative estimator is not a provider tokenization or dollar-spend guarantee.
3. Dispatch outside the transaction with an immutable request, a 30-second abort signal and `maxRetries: 0`. The injected transport must perform exactly one provider attempt and enforce the output cap. The [official OpenAI TypeScript reference](https://developers.openai.com/api/reference/typescript) documents default retries and configurable timeouts; a future adapter must explicitly disable those retries.
4. Settle known usage and validate/checkpoint the agent envelope plus its completion link in one transaction. The worker supplies identity/routing, and the existing contract, parent, observed-evidence, lease and deadline checks apply. The mock writer cannot supply a prepared model operation's output.
5. Invalid output retains its known usage and permits one separately funded corrective attempt. At most two reservations exist per operation, including attempts abandoned across leases. Corrections also consume shared run/daily capacity. There is no transport-error retry inside this call.

Usage unavailable after timeout/error retains the whole reservation. A stale lease or database failure also leaves the reservation charged. A deadline crossed during dispatch can settle known usage but cannot save output. An observed overrun is recorded honestly and durably blocks continuation. No cancellation/refund guarantee is made for a remote provider that ignores abort; late promise results cannot checkpoint after this dispatcher times out. A lease may expire between reservation and send, so a crash or replacement can cause repeated remote work, always bounded by separately counted reservations. This is not exactly-once provider execution.

## Storage and verification

Migration 011 adds private `v2_model_steps`, scoped to the exact run/source revision with foreign keys to the charged attempt and completed envelope. The [worker role](../../db/ops/v2_worker_role.sql) can insert/read pins and update only completion columns. It cannot rewrite requests, their hash, scope or role, or delete pins. V1 readers have no access. No application database migration or role provisioning was performed.

Checks use `npm test`, `npm run test:db`, typecheck/lint, replay, fixture integrity and build. Fake-transport tests cover timeout fencing, no dispatch on denied capacity, separate correction funding, pinned-request immutability, exact/unknown usage, restart reuse, concurrent duplicates, operation identity, two-attempt exhaustion, STOP, deadline, evidence rejection, overrun and atomic checkpoint failure. Existing default-worker and restricted-role tests remain required. [Phase evidence](DECISIONS.md) records actual results.

Live credentials/spending controls, provider token-estimator calibration, heartbeats, four-role provider integration and live evaluation remain future work. Customer publication, human financial approvals/actions and learning are separate later phases.


## Phase 12: single-attempt OpenAI adapter

`openAITransport(explicitKey, optionalTestFetch)` returns a transport for `executeModelStep`; it does not reserve budget on its own. Production callers must dispatch through `executeModelStep`. The default worker/CLI and all HTTP routes remain disconnected from the adapter. No live environment toggle or new credential variable is introduced.

The adapter uses the installed OpenAI SDK and the existing Chat Completions API. The pinned system text is sent as a developer message and pinned input as a user message. It requests one JSON-object completion with `max_completion_tokens: 600` and `store: false`, without provider-side tool execution. [Official request contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). JSON mode does not replace the worker's output validation; strict role-specific provider prompts/integration remain future work.

Client and per-request SDK retries are zero; client and request timeout are 30 seconds. The dispatcher signal is forwarded and already-aborted calls never dispatch. SDK errors become the fixed `transport_failed` code without raw response text or error causes. The adapter makes no local retry; schema correction remains a separately reserved dispatcher attempt.

Successful usage maps prompt/completion counts into the existing accounting contract, including any reasoning tokens included by the API in completion usage. Missing/malformed usage stays unknown. Truncated, filtered, refused, tool-call or malformed-choice responses return empty text while retaining valid reported usage, so validation/correction cannot refund their cost.

The key must be explicitly supplied and contain no whitespace; there is no environment-key fallback. The endpoint is fixed to `https://api.openai.com/v1`, ambient organization/project/admin credentials are disabled, and SDK logging is off. The installed SDK also reads `OPENAI_CUSTOM_HEADERS`, so construction rejects that ambient setting rather than allowing hidden header overrides. These are adapter boundaries, not an activation or spend-control setup.

Verification uses the real installed SDK with injected fake HTTP responses, not a mocked SDK method. Tests cover request fields, no retries for HTTP/network errors, timeout/cancellation, credential/endpoint/logging behavior, refusal/incomplete output and usage mapping. Database cases confirm dispatch follows reservation, output is reused and a server failure retains one full reservation. No real OpenAI request was made; model compatibility, output quality and live latency remain unverified.

## Phase 13: scoped role tasks

`ModelStepSpec.task` optionally selects one of six versioned role tasks. It is required for the new `model_test` run mode and forbidden in ordinary mock runs; legacy generic checkpoint tests retain their old behavior. `openModelTest` pins the model and all six actual prompt strings before dispatch. `prepareModelStep` uses those saved prompts, checks task routing/source/scope/allowed tools, and pins the task discriminator in both requests. `finishModelStep` checks the assigned output kind and selected-tool allowlist inside the usage/output transaction. Invalid task output retains known usage and can use the existing single corrective attempt. Scope, nested body schemas and parent-kind checks run before dispatch.

This test provenance is distinct from live generation and cannot be converted to/from an existing mock run. [Workflow and lifecycle limits](MODEL-WORKFLOW.md).
