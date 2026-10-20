# Durable model-step checkpoints

Requirement coverage: foundations for V2-FR-07/08/12/13/36/37 and V2-NFR-01/02/04/05/06/08/16. Live model roles and the full Task 4 acceptance gate remain open.

Phase 11 adds a trusted worker primitive, `executeModelStep(pool, lease, spec, send)`. Tests inject a fake transport against PostgreSQL. The default worker and CLI still run deterministic mocks. There is no OpenAI adapter, enabled live mode, model-selected routing, new HTTP endpoint or public UI in this slice.

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

Live credentials/spending controls, SDK response mapping, provider token-estimator calibration, heartbeats, four-role provider integration and live evaluation remain future work. Customer publication, human financial approvals/actions and learning are separate later phases.
