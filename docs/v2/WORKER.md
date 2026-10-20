# V2 mock worker

This is a deterministic background-work demonstration. Four mock roles exchange persisted messages, reconcile five scoped billing tools and review a pending proposal before moving the case to `awaiting_human`. These are not model-backed agents; Reviewer verifies the proposal but cannot grant human financial approval. The worker publishes no customer reply and changes no balance. See the [workflow and offline demo](WORKFLOW.md).

## Running

Use a separately prepared V2 development database with migrations 001-011 applied by its migration owner. Migration 006 queues the latest eligible customer message in existing investigating cases; migration 009 adds private run accounting/checkpoints and migration 010 adds internal agent messages and migration 011 adds private model-step pins. Closed and contact-suppressed cases are excluded. The worker never runs migrations itself. Existing worker logins need the new grants before running this version, including model-step read/insert/narrow completion updates, append-only agent messages and selected customer-message read columns.

Create the dedicated login with [v2_worker_role.sql](../../db/ops/v2_worker_role.sql), supplying its password outside source control. The script grants only the V2 reads/updates/audit inserts needed by this mock worker. It cannot access V1 tables, edit case facts, enqueue jobs, insert customer messages, delete cases or change the schema. Worker credentials are trusted server credentials across the configured businesses, not a visitor or operator session.

Set `V2_WORKER_DATABASE_URL` in the process environment to that login's connection URL. Optionally set `V2_WORKER_ID` to a slug such as `mock-worker-local`; otherwise it includes the process ID. These commands do not read `.env` and never fall back to the migration owner's `DATABASE_URL`.

```sh
npm run worker:v2:mock
npm run worker:v2:mock -- --once
```

The first command polls until SIGINT/SIGTERM. The second makes one claim attempt and reports `completed`, `idle`, `retry`, `failed` or `stale`; `idle` means no step was claimed, which can include cleaning up expired/exhausted work. Messages can be accepted through the [default-off visitor API](API.md); direct visitor store writes require an active persisted session. [Operator login/scoped reads](OPERATORS.md) are separately available; the V2 workspace is still a later phase. No new browser interface is available yet.

## Persistence and recovery

- One ordinary accepted message creates one job in the same transaction as its message, event and case revision. Identical retries create no additional job. A newer message or operator transition cancels earlier pending work; STOP also suppresses contact and queues nothing.
- Workers lock the case before its job, skip locked cases, and recheck eligibility after locking. Each claim has a fresh token and a 60-second database-timed lease. Valid mock role checkpoints renew that lease atomically; they cannot revive expired ownership or reset the run deadline. Completions require that token, worker identity, current case revision and an unexpired lease. They validate evidence against stored scoped record versions.
- A mock handler has a 180-second deadline, matching the persisted run ceiling. Ordinary failure requeues after five seconds; the third failed or expired claim leaves a `failed` job and an `awaiting_human` case. Run resource exhaustion pauses immediately without spending the remaining claim attempts. Reasons are fixed codes, not raw exception text.
- A crash leaves the lease in PostgreSQL. A restarted process can reclaim it after expiry. Execution can repeat, but only the current owner can commit the result and case event once. The integration tests simulate expiry directly rather than waiting a minute.
- Shutdown stops claiming new work and finishes the claimed step. A database error that prevents recovery exits the CLI; restart the process or use a process supervisor after restoring the database. No worker host or supervisor is provisioned by this phase.

## Limits

This is one persisted mock workflow per message with [run accounting and checkpoints](RUNS.md). Its mock instructions, source text, business context, empty lesson set, policy, record hash and limits are pinned; successful tools and role outputs are reused after recovery. New runs use the billing recipe; both prior recipe versions remain supported for in-flight work. Pending proposals live in internal messages/job results, not an approval/action ledger or exposed timeline API. There is no background heartbeat, live provider integration, active learning, customer publication or financial action. A separate [model-step dispatcher](MODEL-STEPS.md) and its OpenAI adapter are tested with injected fake HTTP responses; the default worker does not call them yet. The timeout fences late results but cannot cancel arbitrary handler I/O; cooperative cancellation and full usage integration are required before external model calls. Fixed limits have not been load tested. Injected custom handlers are a trusted testing hook; the CLI always uses the checkpointed default.

Automated checks use isolated schemas in `TEST_DATABASE_URL`, including an abruptly exited child process, a restarted CLI, rollback/concurrency tests and temporary restricted database roles. No application-database migration or production login provisioning is part of those checks.

A separate [model-test harness](MODEL-WORKFLOW.md) now exercises all four roles through fake HTTP and durable checkpoints. Its `model_test` runs are rejected by this mock worker and the mock completion API; its separate internal processor can finish guarded test jobs and hand cases to an operator, but is not a hosted or CLI-enabled live worker.
