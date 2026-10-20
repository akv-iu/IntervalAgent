# V2 mock worker

This is a deterministic background-work demonstration. It reads account history and policy through the scoped tools, stores a result labeled `mock`, and moves the case to `awaiting_human`. It does not run the four model-backed agents, send a customer reply, approve a proposal or change a balance.

## Running

Use a separately prepared V2 development database with migrations 001-006 applied by its migration owner. Migration 006 queues the latest eligible customer message in existing investigating cases; closed and contact-suppressed cases are excluded. The worker never runs migrations itself.

Create the dedicated login with [v2_worker_role.sql](../../db/ops/v2_worker_role.sql), supplying its password outside source control. The script grants only the V2 reads/updates/audit inserts needed by this mock worker. It cannot access V1 tables, edit case facts, enqueue jobs, insert customer messages, delete cases or change the schema. Worker credentials are trusted server credentials across the configured businesses, not a visitor or operator session.

Set `V2_WORKER_DATABASE_URL` in the process environment to that login's connection URL. Optionally set `V2_WORKER_ID` to a slug such as `mock-worker-local`; otherwise it includes the process ID. These commands do not read `.env` and never fall back to the migration owner's `DATABASE_URL`.

```sh
npm run worker:v2:mock
npm run worker:v2:mock -- --once
```

The first command polls until SIGINT/SIGTERM. The second makes one claim attempt and reports `completed`, `idle`, `retry`, `failed` or `stale`; `idle` means no step was claimed, which can include cleaning up expired/exhausted work. Accepted messages are currently created through the server store; sessions, HTTP routes and the V2 workspace are still later phases. No new browser flow is available yet.

## Persistence and recovery

- One ordinary accepted message creates one job in the same transaction as its message, event and case revision. Identical retries create no additional job. A newer message or operator transition cancels earlier pending work; STOP also suppresses contact and queues nothing.
- Workers lock the case before its job, skip locked cases, and recheck eligibility after locking. Each claim has a fresh token and a 60-second database-timed lease. Completions require that token, worker identity, current case revision and an unexpired lease. They validate evidence against stored scoped record versions.
- A mock handler has a ten-second deadline. Failure requeues after five seconds; the third failed or expired attempt leaves a `failed` job and an `awaiting_human` case with an audit reason. Reasons are fixed error codes, not raw exception text.
- A crash leaves the lease in PostgreSQL. A restarted process can reclaim it after expiry. Execution can repeat, but only the current owner can commit the result and case event once. The integration tests simulate expiry directly rather than waiting a minute.
- Shutdown stops claiming new work and finishes the claimed step. A database error that prevents recovery exits the CLI; restart the process or use a process supervisor after restoring the database. No worker host or supervisor is provisioned by this phase.

## Limits

This is one persisted mock step per message, not multi-step agent checkpointing. There is no heartbeat, live provider dispatch, run/prompt version pinning, shared token reservation, customer publication or financial action. Add those with the respective runtime/action phases before claiming their specification requirements are complete. The timeout fences late results but cannot cancel arbitrary handler I/O; integrate cooperative cancellation and usage accounting before external model calls. Fixed limits have not been load tested.

Automated checks use isolated schemas in `TEST_DATABASE_URL`, including an abruptly exited child process, a restarted CLI, rollback/concurrency tests and temporary restricted database roles. No application-database migration or production login provisioning is part of those checks.
