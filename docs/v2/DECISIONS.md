# V2 implementation decisions

## Phase 1: contracts and boundaries (October 19, 2026)

Status: foundational contracts implemented. Authentication, HTTP routes, records, worker execution, model-backed roles, and UI are later phases. No new dependency, credential, hosted service, or paid model call is needed for this phase.

### Execution agreement

Work one phase at a time: write behavioral tests, implement, run checks, review, add tests for findings, fix, then review/check again. Report the result and stop for the user before the next phase. The user requested this process on October 19. Self-review is identified as such; do not label it an independent external model review. Later on October 19 the user authorized committing/pushing the verified completed phase whenever they say "move ahead", before starting the next phase. Do not force-push or implicitly publish a V2 release.

Superpowers was identified in the plugin directory but was not installed when Phase 1 started. The implementation follows the user's requested loop without claiming to have invoked unavailable plugin skills.

### Contracts delivered

- Exactly four role IDs: `customer`, `coordinator`, `investigator`, and `reviewer`.
- Strict, versioned internal envelopes with addressed routes, bounded text/arrays, task context, and scoped evidence.
- Read-tool request shapes and two proposal types: allocate a simulated payment or credit a cancelled invoice line. Financial proposals require operator approval and versioned invoice/payment/cancellation/policy references. This validates structure, not the existence or truth of a record; Task 2 supplies evidence lookup, and Task 6 validates and commits effects.
- Case/task transitions and a pure authorization check using a principal supplied by a verified server session. Parsing a principal is not authentication. Nothing accepts a principal or actor from an HTTP client or model in this phase.
- Existing V1 app boundaries stay unchanged, including its live endpoint exception. An import-graph regression check prevents V1 routes, including that exception, from reaching V2 modules. Explicit authenticated V2 route boundaries will be introduced with the actual routes, not bypassed now.

### Authentication decision for Task 3

Use Better Auth for operator login with GitHub OAuth and database-backed sessions. It is listed in the installed Next.js authentication guide and has a documented [Next.js integration](https://better-auth.com/docs/integrations/next). Add/pin the dependency when implementing authentication, after checking its installed-version requirements; do not add it for a pure-contract phase.

Operator identity comes from a validated server session; business membership comes from the database. Public registration does not grant operator membership. Every protected handler/data operation verifies session and membership; a cookie's presence alone is insufficient. Missing/expired/revoked sessions fail closed. Mutations validate origin and use the authentication library's applicable CSRF/session protections.

Visitor workspaces use an opaque 32-byte random session token in an HttpOnly, Secure, SameSite=Lax, path `/` cookie with a 24-hour absolute expiry; store only a token hash plus business/workspace/expiry on the server. Use a production `__Host-` cookie. Local HTTP development uses a separate cookie name only in explicit local mode. Client-supplied business/workspace IDs never establish access. Visitor sessions can read/post in their own workspace; authenticated operators can review/manage only their businesses.

Future environment configuration will include the auth secret, canonical application origin, GitHub OAuth client credentials, and dedicated V2 database credentials. No credential values belong in documentation, logs, or client bundles. Add actual validated environment names when that code is implemented.

### Worker and database deployment decision for Task 3

Keep the Next.js web app and PostgreSQL. Run a separate long-lived Node process for V2 work; use a Render Background Worker for the hosted deployment, which supports processes without incoming HTTP traffic ([worker documentation](https://render.com/docs/background-workers)). Local development runs that process in a separate terminal. Hosting is not provisioned in this phase and may have compute costs independent of model usage.

The web request transaction stores the accepted message and queued task, then returns. The worker polls PostgreSQL, claims expiring leases, validates case revisions, checkpoints each step, and handles graceful shutdown. It requires access to the same database and a scoped worker login. Do not rely on Vercel continuing a request after responding. If no worker is available, queued work stays queued and the UI must say so.

Separate credentials: existing V1 reader and lessons writer remain unchanged; V2 web access can manage authorized case/chat/auth records; V2 worker access can manage tasks, evidence, usage and proposals; the guarded action transaction receives only the additional grants required for simulated ledger changes. Owner/migration credentials are never used by deployed web or worker processes.

### Token policy

OpenAI remains the only live model provider. No live calls are required for Phase 1. Later phases use mock/replay by default, bounded relevant context, short outputs, shared per-run limits including retries, and recorded usage. All four roles may use the same model/key. Learning evaluation is offline/replay first; fresh live evidence is a separately bounded run.

### Contract behavior that later phases must preserve

The runtime builds message context from the persisted task and validates it with `parseAgentMessage`; a valid schema alone grants no execution permission. Tool dispatch must also enforce the selected business's allowlist and read actual scoped records. Approvals must recheck current record/policy versions and financial invariants. Case transitions require a trusted system/operator/customer event supplied by the server and an atomically checked revision; the pure transition function does not replace database concurrency control.

STOP closes the case and permanently preserves the contact-suppressed flag across operator reopening. Reopening allows internal work, not renewed customer contact. Resolved cases can close or accept new evidence; closed cases require an explicit operator reopen. A new-evidence run must be created by the later runtime before work resumes.

### Phase 1 verification result

- Tests were written first; both new suites initially failed because the modules did not exist. Initial implementation passed 34 new tests.
- Self-review pass 1 found five gaps: tool requests on the wrong route; missing financial record evidence; mixed record versions/scopes; duplicate financial actions; and closing a resolved case. Added regression tests, observed five failures, then fixed them. Added effective-policy evidence validation as part of the financial contract check.
- Self-review pass 2 found conflicting evidence versions between the outer envelope and nested proposal. A new test failed, then passed after checking both together. Positive collaboration examples cover the remaining message kinds. Verification of that fix found no further in-scope issue.
- Final checks: `npm test` passed 645 tests across 38 files, including 45 new V2 tests and one new V1 import-boundary regression; `npm run eval:replay` passed the pinned guarded gate with full coverage; `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- Build retains two warnings from unchanged `src/lib/project-env.ts` about dynamic filesystem tracing. No V2 UI, database connection, migration, live model call, or browser flow was exercised. No separate reviewer model was invoked; the two passes above were self-review.
- Phase 1 is complete at the contract boundary. Task 2 (synthetic records and executable domain tools) is not started. Implementation waits for the user's next instruction.

## Phase 2: connected records and read tools (October 19, 2026)

The user authorized moving ahead and asked that each future "move ahead" push the completed phase first. Scanned tracked/proposed files for secret patterns, excluding a verified existing test URI on the reserved `db.example` host; committed/pushed Phase 1 as `936cdf2` to `origin/main` and verified the remote hash. Phase 2 is left local for review, to be pushed at the next instruction.

### Scope and delivered behavior

Split Task 2 into 2A (this phase: development records/tools) and 2B (next phase: independent evaluation families, frozen splits and hidden expectations). This keeps fixture design reviewable and avoids presenting development examples as held-out evidence. Task 2 as a whole is not complete yet.

- `demoRecords(seed)` generates deterministic records for Northside Fitness and Harbor Subscriptions, three accounts each. Both businesses intentionally reuse external-style record IDs; business/workspace/account scope distinguishes them. Changing the seed also changes record/policy versions.
- Connected invoices/lines, settled payments, allocations, cancellations, historical credits and effective policies are validated for scoped parentage, unique identities, safe integer totals, allocation/credit limits and dates. No hidden answer keys or scenario labels are stored in these records.
- The Investigator's five read tools return validated data and actual record/version evidence. Wrong roles/accounts/tool names are rejected before loading; business allowlists are enforced; valid empty results are `not_found`, while unavailable/invalid/oversized backing data or a five-second loader timeout returns a sanitized `unavailable` result. No raw connection errors reach the tool result.
- `previewProposal` verifies current scoped evidence and effective policy, then computes a pending result without mutating the snapshot. The reference $84 invoice minus $50 allocation and $20 eligible credit leaves $14. Harbor's one-day cancellation window rejects that three-day-late credit; Northside allows seven elapsed 24-hour days.
- Preview logic also accounts for existing allocations/credits, unsettled payments, cumulative proposal use and invoice limits. Applying approved effects remains Task 6. The tool context must still come from a verified, authorized server-side case; these pure functions do not implement sessions or HTTP authentication.
- Read results are cloned snapshots; changing a returned result cannot alter its backing records. Timeout currently stops waiting but cannot cancel an arbitrary loader promise; external database statement/query cancellation must accompany the persistent loader implementation.

### Tests, reviews and remaining work

Tests first failed because the modules did not exist. Initial integration caught extra actor metadata leaking into a strict evidence envelope; evidence construction now selects only its required scope fields. Initial 16 tests then passed.

Self-review pass 1 found two policy issues: string timestamp comparisons could misread equal instants with different precision, and a proposal could cite an expired policy with the same version. Both were reproduced with failing tests and fixed by timestamp comparison and effective-policy identity checks. Additional checks cover previously allocated/credited funds. Self-review pass 2 confirmed the fixes and found no further in-scope issue; backing-data isolation and invalid-source sanitization were also checked. No independent reviewer model was invoked.

Final verification: 21 new tests; `npm test` passed 666 tests across 40 files; pinned V1 guarded replay/full-coverage gate passed; typecheck, lint and production build passed. The same two build tracing warnings remain in unchanged `project-env.ts`. No live API calls, database access/migrations, or browser testing occurred. There is no V2 user-facing change to test yet.

Next: Phase 3 / Task 2B evaluation fixtures and split manifests. Runtime agents, persistent cases, worker execution, auth and UI are not implemented by this phase.

## Phase 3: frozen evaluation inputs and separate answer keys (October 19, 2026)

On "move ahead", scanned tracked/proposed files for secret patterns, committed/pushed Phase 2 as `3b04057`, and verified `origin/main`. Phase 3 stays local for review until the next instruction.

### Delivered and frozen

- Set `billing-20261019-1`: 36 manually specified cases, with 12 development, 12 validation and 12 final holdout cases. All eight required categories appear in every split, with distinct declared case families. Relationships and decision conditions differ across splits; no cosmetic paraphrase generator or application-generated answer oracle is used.
- Public inputs contain only scope, customer text and connected records. Evaluator-only oracles contain explicit actions, balances, evidence requirements and short rationale. Fault injection/repeated-submission controls live only in the manifest/harness. The agent runtime must not receive the full fixture metadata or answer keys.
- Manifest SHA256 is `9d5195aec6cf2cb5465fadf8a4aa6030e94e9c477bdf3b596c1704a1860c3414`; it pins every input/oracle hash. Editing a frozen file fails closed. Intentional fixture revisions require a deliberate new set/pin, not replacing data silently.
- `npm run fixtures:v2:check` validates coverage, public record schemas and file integrity, plus development/validation oracle schemas. It hashes raw holdout oracle bytes without decoding or scoring them. `loadExpectation` refuses holdout access unless explicitly passed literal `allowHoldout: true` by a future final-evaluation runner.
- Fault injection uses the existing tools' real sanitized failure path. Fixture tool access is bound to the case scope, including cases containing another account as a distractor. Duplicate-submission controls are defined but cannot be run end to end until persistent submission/idempotency is implemented.
- Import-graph tests prohibit runtime imports of the evaluator/assets. Next.js tracing excludes the fixture tree and evaluator scripts; the production build's nine server tracing manifests contain neither these assets nor private environment files.

### Review and actual verification

Tests first failed on the missing harness. Initial fixture checks and non-holdout financial-consistency checks passed. Self-review 1 found two bugs: failure controls on a non-failure category and fixture tool access switching to another account in a snapshot. Both were reproduced in failing tests and fixed. Holdout opt-in was also restricted to literal `true`.

Self-review 2 found that the oracle schema allowed financial actions with missing/wrong affected-invoice balances or missing evidence. A failing test reproduced it; the schema now requires exactly the affected balances and policy/record evidence. The existing files did not need alteration; all fixes changed validation, not frozen case answers.

Final checks: 13 new fixture tests and one import-boundary regression; `npm test` 680 tests/41 files, fixture integrity command, pinned V1 guarded replay/full coverage, typecheck, lint and build all passed. The unchanged V1 filesystem reader still emits two build tracing warnings. No model calls, database access/migrations or browser checks were performed. Nothing requires manual UI testing yet.

### Measurement limits and next phase

These cases and their expected values were authored by Codex, which also implemented the application. They are separately specified families/expected values, not independent external review or evidence of model effectiveness. Family distinctions were manually reviewed; hashes detect exact copies/edits, not all semantic similarity. No agent outputs, prompt choices or lesson promotions were scored against the holdout. Once final answers are used for tuning, retire that holdout before claiming a fresh final evaluation.

Task 2 is complete at the data/fixture boundary. Next is Task 3: persistent case storage and resumable work, delivered in bounded phases. Authentication, live agent collaboration, learning and UI remain future work.

## Phase 4: transactional case storage (October 19, 2026)

On "move ahead", scanned the completed phase for secret patterns, committed/pushed Phase 3 as `3b1d948`, and verified `origin/main`. Phase 4 remains local for review until the next instruction. Task 3 is split: this phase delivers storage only; durable jobs/worker execution and verified sessions/HTTP integration remain required before Task 3 can be complete.

### Storage behavior and boundaries

- Migration `005_v2_cases.sql` adds three private tables: cases with scoped immutable record snapshots, revisioned audit events, and customer/agent message storage. Composite scope keys and foreign keys prevent orphan messages/events; database checks reject invalid states, unsafe revisions and malformed identifiers. No V1 table is altered and existing public reader/lessons-writer grants are not widened.
- `caseStore(pool)` requires an explicitly supplied pool and a principal obtained from a verified server session. It reads no credentials and introduces no HTTP route, auth provider or default owner connection. Principal parsing/access checks are authorization primitives, not authentication. The later web/worker integration must supply least-privilege credentials and trusted identities.
- Creation validates and filters server records to the case account/business/workspace, stores the snapshot once and writes the creation event atomically. An identical retry returns the existing case; changed identity/facts conflict rather than resetting it. Facts reads validate and reapply scope even if stored records are unexpectedly broader.
- Appending locks the case row, checks the expected revision and idempotency key, and commits the new case state, audit event and customer message in one transaction. Same key/body returns the original accepted message; changed content conflicts. Concurrent same-key submissions commit once, and different submissions racing one revision cannot overwrite each other. Operator-only transitions use the same revision protection.
- STOP is recorded immediately using the locked current revision even if the client's revision is stale. It closes the case and sets contact suppression; operator reopening preserves suppression. This phase has no worker or outbound publisher to cancel; those paths must recheck the flag and revision when implemented.
- Audit events record the verified visitor session record ID or operator ID, the actor type, reason, revision and timestamp. Message role describes transcript content; an operator testing a customer message remains identified as an operator in the audit. Session IDs here are internal record IDs, never cookie tokens. History uses bounded revision-cursor pagination and includes only messages associated with the returned event page.
- Transactions set five-second lock and ten-second statement timeouts. A write failure rolls back all related records; a failed rollback discards that pool connection while preserving the original error. These per-statement limits are not a measured end-to-end performance guarantee.

### Tests, self-review and actual checks

Three offline boundary tests and the initial twelve integration tests were written before the store existed and failed on the missing module. The first DB run passed eleven; its rollback fault-injection constraint incorrectly matched existing test rows. Narrowing that constraint to its own case corrected the test without changing the store.

Self-review 1 found stale STOP rejection, missing audit actor identity (including an operator mislabeled as a customer), and facts reads that trusted an already-scoped snapshot. Three new database regressions failed before fixes, then passed. Self-review 2 checked these fixes, transaction boundaries, concurrent retry/revision behavior, scope checks and V1 grants; no further in-scope issue was found. The orphan-event test asserts the actual foreign-key error, so a missing required field cannot disguise a broken relationship. No separate reviewer model was invoked.

Final checks passed: 683 offline tests across 42 files; 50 database tests across four files (including all 15 new case-store integration tests); fixture integrity; pinned V1 guarded replay/full coverage; typecheck; lint; production build; and `git diff --check`. Existing V1 dynamic filesystem tracing warnings, Vitest configuration warnings and PostgreSQL SSL compatibility warnings remain unchanged.

Database checks used only the configured dedicated test database after verifying it differed from the application endpoint/database. Each suite created and dropped an isolated random test schema. Migration 005 was not applied to the application database, and no deployed credentials/grants changed. No live model calls, browser test, user-facing V2 flow or deployment was performed; nothing requires manual browser testing yet.

### Next bounded phase

Add durable jobs and a resumable mock worker, extending the message transaction to enqueue work atomically. Cover competing claims, lease expiry/restart, retries, stale completion and STOP cancellation before running model-backed roles. Current stored messages do not create tasks, and reopening/new evidence does not start an agent. Later approved actions must use current ledger records rather than treating the original snapshot as mutable financial truth.

## Phase 5: durable mock jobs and worker (October 19, 2026)

On "move ahead", checked the completed phase for secrets, committed/pushed Phase 4 as `f59b066`, and verified `origin/main`. This phase delivers Task 3B: durable execution of one mock investigation step per accepted message. Verified visitor/operator sessions and HTTP integration remain the next phase; Task 3 and model-backed agent execution are not complete. Phase 5 stays local until the next "move ahead".

### Delivered behavior

- Migration 006 adds scoped jobs linked to their accepted message revision and backfills only eligible pending Phase 4 messages. Acceptance, cancellation of older jobs and enqueue now share the case/message/event transaction. STOP and operator transitions cancel pending work; identical submission retries cannot enqueue twice.
- Claims lock cases before jobs, skip locked cases, recheck eligibility under the locks and issue fresh UUID lease tokens. Leases use the database clock, last 60 seconds and count a maximum of three claims. Stale revisions, expired/replaced leases and wrong worker/scope cannot commit results. Cleanup of an old revision affects only that job.
- The deterministic handler uses the existing account-history and policy tools. A validated result labeled `mock`, its actual scoped record/version references, the case's `awaiting_human` transition and audit event commit atomically. Nothing is published to customer chat or applied to a ledger.
- Handler failure/timeout requeues after five seconds; three failures or expiration of the last attempt leaves the job failed and the case awaiting human review. Stored reasons are fixed codes, never raw handler errors. A ten-second handler deadline fences late results. Arbitrary I/O cannot be cancelled by that timer; cooperative cancellation and usage accounting are required before live provider integration.
- `npm run worker:v2:mock` polls once a second between attempts and finishes its claimed step on SIGINT/SIGTERM. `-- --once` performs one claim attempt. It requires process-only `V2_WORKER_DATABASE_URL`, accepts an optional slug `V2_WORKER_ID`, never reads `.env`/owner credentials or migrates, and emits sanitized configuration/connection errors. A database failure that cannot be recovered exits; a supervisor/restarted process must resume after recovery.
- `db/ops/v2_worker_role.sql` grants only the required V2 reads, case/job column updates and audit inserts. Tests exercise that script with a temporary role and prove processing works while V1 access, facts edits, new jobs, customer messages and deletion are denied. The original public reader also cannot read the jobs table. No production login or grants were created.

### Two self-review/validation passes

The initial offline/database tests failed on the missing worker module. After implementation, three worker unit tests and all 29 initial DB tests (14 new jobs plus 15 existing cases) passed. Self-review 1 found two claim-path bugs: eligibility was trusted from the initial candidate query, and discarding an old candidate cancelled newer work. Two integration regressions reproduced the bugs before fixes. The latter test's ordering fixture was corrected to use a fixed past timestamp so database latency could not select the newer job first; it then reproduced the precise unwanted cancellation. Eligibility is now rechecked after locking, and stale cleanup targets its source revision. Both regressions passed after the fixes.

Self-review 2 confirmed both fixes and checked lock order, transaction rollback, evidence validation, bounded retries, shutdown, grants and migration behavior. Additional verification covers a child process that exits immediately after a committed claim, a fresh CLI process recovering its expired lease and committing once, migration backfill/repeatability, expired or invalid evidence, and a timed-out handler whose late result cannot commit. No further in-scope issue was found and no separate reviewer model was invoked.

Final verification passed: 688 offline tests/43 files; the full DB run's 69 tests/five files; and the subsequently added dedicated worker-role integration test (20 new DB scenarios exercised in total). Typecheck, lint, fixture integrity, pinned V1 guarded replay/full coverage, production build, missing-config CLI failure, and local-link/secret-pattern/whitespace checks passed. All nine production tracing manifests exclude private environment and evaluation assets. The full DB run took about seven minutes against the remote test database; this is verification duration, not a measured application latency claim. The worker-role test was run separately after its addition rather than claiming it was part of that earlier full run.

Tests use isolated schemas only in the verified distinct `TEST_DATABASE_URL`; child processes inherit that isolated search path. Temporary roles are removed after checks. Neither migration 005 nor 006 was applied to the application database, and no hosted worker, browser flow or live model call was run. Existing build tracing, Vitest configuration and PostgreSQL SSL compatibility warnings remain.

This is a persisted single-step mock, not four-agent orchestration or model-budget reservation. No heartbeat, per-role checkpoints, prompt/model version pins, UI, customer publication or financial effects are claimed. [WORKER.md](WORKER.md) records the actual commands and upgrade boundaries. Next: verified sessions and protected V2 HTTP integration, before model-backed workflows.

## Phase 6: private visitor sessions and protected case APIs (October 19, 2026)

On "move ahead", secret-checked the completed changes, committed/pushed Phase 5 as `55e28bc`, and verified `origin/main`. Authentication was split into two bounded slices: this phase is visitor sessions/customer APIs (Task 3C); Phase 7 is operator GitHub OAuth, membership and operator boundaries (Task 3D). The Better Auth decision remains for operator login; no dependency or fake operator identity endpoint was added here. Phase 6 remains local until the next instruction, and Task 3 is not complete.

### Delivered boundaries

- Migration 007 stores only SHA-256 hashes of 32-byte random visitor tokens, with absolute database-clock 24-hour expiry, revocation and unique server-generated workspace IDs. Each workspace receives scoped copies of the existing development records. Repeated valid session starts do not reset expiry; switching businesses requires ending the old session. Expired sessions deny access but do not delete accepted case/history records.
- The four explicitly enumerated route files support session start/read/logout, case creation/read and customer messages. Public cookies use the planned `__Host-`/Secure/HttpOnly/SameSite=Lax/Path=/ configuration; local HTTP uses a different cookie name only in explicit local mode. Malformed/duplicate/local-only cookies cannot authenticate public requests. Client-supplied scope, principals, actors and roles cannot establish authority.
- The API is off by default. Enabled configuration requires a canonical origin and its own `V2_WEB_DATABASE_URL`; public mode requires HTTPS, and local HTTP is restricted to loopback origins. There is no owner/reader/worker credential fallback. Writes check exact Origin and canonical incoming Host; forwarded-host headers are ignored. Responses are private/no-store and include only case state/customer transcript fields, not raw facts, internal audit notes/IDs, tokens or worker results.
- JSON bodies are UTF-8, at most 4096 actual bytes and bounded by a five-second read deadline. Schemas reject unknown fields. DB-backed limits allow 200 new workspaces per UTC day globally and 120 ordinary authenticated requests per session per minute; competing reservations cannot exceed the cap. Authenticated STOP and logout bypass the ordinary counter so resource exhaustion cannot prevent suppression/revocation.
- Visitor case creation/message writes recheck and share-lock the active session inside the existing case transaction before case/job locks. Revocation during upload cannot become a later accepted write. Worker processing remains independent of visitor-cookie expiry and cannot read the session table through its dedicated grants.
- The shared transaction helper was moved unchanged into a V2-local module for reuse by session issuance. `v2_web_role.sql` grants only visitor/case reads, required inserts and narrow update columns; it cannot access V1 tables, update facts/scope/expiry/token hashes, complete worker results, delete data or change the schema. No production role or grants were provisioned.

### Tests, two self-review passes and integration fixes

Initial offline/DB tests failed on missing modules. The first implementation passed six boundary tests, typecheck and all 13 initial visitor integration tests. Self-review 1 found a revocation-during-upload write race and stored-record validation errors mislabeled as client 400s. Both regressions failed before fixes. Session checks now happen within the write transaction, and only explicitly parsed client inputs map to 400; invalid server data returns sanitized 503. Existing case/job tests now seed real visitor-session rows rather than bypassing this new write boundary.

Self-review 2 found unbounded waiting for a stalled upload. A failing fake-timer test reproduced it, then passed with the five-second deadline and cancellation. Additional checks cover route wiring, private DTOs, cursor behavior, concurrent quota reservations, local cookies, and reader/web/worker grant separation. No separate reviewer model was invoked.

Production-build/HTTP verification caught two framework integration errors: explicit `runtime='nodejs'` exports are incompatible with this installed Next.js Cache Components mode, and comparing the normalized internal request URL to the public origin rejected legitimate requests. The build failed before removing those exports; a new Host regression failed before using the incoming canonical Host while retaining exact Origin checks for writes. Installed runtime/route/connection guides were checked and the corrected build renders all four V2 routes dynamically. The initial built-server smoke failed readiness on 403; the corrected restricted-role flow passed.

A final critical resource-exhaustion check reproduced STOP being rejected by the ordinary 120-request counter (429). STOP now bypasses that counter after valid session verification, retains the transactional recheck and still cancels pending work. Logout also remains available. The complete 18-test visitor suite was rerun after this fix, including the earlier revocation regression, with all passing. Rate-limit failure also distinguishes a session revoked/expired during upload from ordinary exhaustion.

### Actual verification and remaining work

Passed: 700 offline tests/45 files; the full 87-test DB suite/six files; the updated 18-test visitor DB suite after the final STOP change (88 distinct DB tests exercised overall); typecheck; lint; fixture integrity; pinned V1 guarded replay/full coverage; production build. The full database run took about ten minutes against the remote dedicated test database, not a measurement of application latency. The final built-server HTTP smoke passed with a fresh isolated test schema and temporary restricted web role: session/case/message acceptance, mock-worker progress, origin rejection, STOP despite an exhausted counter/stale revision, logout and revoked-session rejection. Smoke servers, roles and schemas were cleaned up.

All database changes and temporary roles were confined to isolated schemas in the verified distinct `TEST_DATABASE_URL`; server processes were hidden and stopped after the check. Migrations 005-007 were not applied to the application database. No public V2 activation, hosted worker, browser UI, operator OAuth or paid model call occurred. Existing build tracing, Vitest configuration and PostgreSQL SSL compatibility warnings remain unchanged. No manual browser acceptance is needed yet.

Final artifact checks passed: all 13 server tracing manifests exclude private environment/evaluation assets; changed/proposed files passed secret-pattern, local-link and whitespace checks. The only connection URLs in new tests use a verified credential-free placeholder host.

The default-off API configuration/contract and resource/retention limits are documented in [API.md](API.md). Operator login with database-backed business membership is next. Model-backed agents, shared model budgets, per-role checkpoints, instruction pinning, V2 UI, evidence presentation and financial effects remain in their planned phases.

## Phase 7: GitHub operator identity and business-scoped reads (October 19, 2026)

On "go ahead", secret-checked and committed/pushed verified Phase 6 as `ccbf37e131927598667c7b01edf8de5b1a2cc8a3`, then verified HEAD against `origin/main`. Phase 7 implements Task 3D's operator login/membership/read boundary (V2-FR-23, 36-37; V2-NFR-06, 08, 13, 15). Operator mutations arrive with human review, including transaction-time session/membership checks before any effect. Shared model budgets, instruction pinning and per-role checkpoints remain runtime work; Task 3 is not complete. Phase 7 stays local until the next instruction.

### Delivered behavior

- Pinned Better Auth 1.7.11 after checking current official GitHub/PostgreSQL/session/configuration documentation and installed Next authentication/route guidance. It receives a dedicated pg pool and private table names; its transitive adapter uses Kysely internally, while application storage remains pg/SQL. Migration 008 is additive and never runs at request time.
- Separate `V2_OPERATOR_AUTH=true`, canonical origin, operator connection, random auth secret and GitHub credentials are mandatory. No owner/reader/lessons/visitor/worker credential fallback. Three enumerated route files expose allowlisted auth, sanitized session GET and scoped case/fact/history GET. V1 boundaries remain unchanged.
- Only GitHub sign-in, its state/cookie-bound callback and same-origin sign-out reach the library. Strict sign-in JSON cannot change provider, callback destination or identity. Password, registration, account linking, raw-session and admin/user-deletion endpoints are not exposed. Automatic linking is disabled; origin/CSRF checks remain enabled and forwarded authority headers are stripped. Existing bounded JSON parsing is reused.
- Eight-hour absolute database sessions have no refresh or cookie session cache. HTTPS cookies are Secure/HttpOnly/SameSite=Lax/Path=/, no Domain, distinct from visitors/local mode. Provider tokens are encrypted at rest; library session rows remain private. Custom responses omit auth tokens, email, provider IDs and auth-session IDs. Logging/telemetry are disabled; auth redirects suppress referrers.
- Login alone grants no operator access. Owner SQL enrolls an independently verified stable numeric GitHub account ID, never email/username, and does not re-enable disabled operators. Each protected request resolves the still-active database session, database-clock expiry and current business memberships together. Authorized operators read scoped facts and bounded internal audit history across that business's workspaces. No case updates, approvals or learning actions are exposed.
- The dedicated role manages private auth records, counters and case/history reads. It cannot grant/reactivate memberships, alter case facts/state, read V1/visitor sessions or perform financial effects. Shared DB limits allow 60 sign-in/callback requests globally per minute and 120 ordinary requests per operator per minute; logout bypasses both. Ingress throttling and owner-operated auth/profile retention are documented prerequisites before broad public scale.

### Tests and two self-review passes

Initial tests failed on missing modules, then a reserved SQL identifier was corrected. The temporary-role fixture needed explicit owner membership to remove its grants; its failed cleanup and the failed-migration schema were removed by exact name in the test database. Test setup now cleans its own schema/pools on migration failure, with an offline regression. The corrected initial seven operator DB tests passed.

Self-review 1 reproduced a session revoked between library validation and membership lookup still returning 200. A failing integration regression preceded resolving membership and the same active database session/expiry in one query. All eight then-existing operator DB tests passed after the fix. Library origin/CSRF options are explicit so they also remain enabled in tests.

Self-review 2 found callback failures forwarding provider descriptions into redirects, and callback navigation lacking a no-referrer policy. A failing regression preceded generic callback errors and the redirect header; successful redirects/cookies are retained. Additional checks exercise competing login quotas, the actual owner enrollment SQL, restricted-role case reads, V1-reader denial of the new auth tables, browser-style cross-site callbacks without Origin and one-time state replay rejection. No separate reviewer model was invoked.

### Verification and limits

The production build and hidden built-server smoke passed using the shipped grants with a temporary restricted login and fresh isolated schema. Smoke covers session identity, scoped facts, foreign-business/visitor-cookie/origin denial, blocked raw-session access, pending OAuth state, membership revocation and logout. Initial smoke attempts mismatched localhost configuration with a 127.0.0.1 connection whose fetch Host override was ignored; the harness origin was corrected to the actual host. No application check was relaxed.

Final checks passed: 710 offline tests/48 files; the complete 98-test database suite/seven files (656.56 seconds against the remote test database); a separate updated browser-style OAuth/replay check; typecheck; lint; pinned V1 guarded replay/full coverage; fixture integrity; production build; restricted-role built-server HTTP smoke. Database-suite duration is not an application-latency measurement. All 16 server tracing manifests exclude private environment/evaluation assets. Production dependency audit reports zero vulnerabilities; five pre-existing high-severity findings remain in the Next ESLint/fast-glob/micromatch/braces development chain, at the same locked versions as before this phase. No existing dependency version changed and no forced fix was applied. Secret-pattern, relative-link and whitespace checks passed; existing build tracing, Vitest and PostgreSQL SSL compatibility warnings remain.

The real library's GitHub exchange is tested with intercepted token/profile/email responses, not a real consent/private-window browser pass. That acceptance check needs OAuth credentials and an isolated local setup later; no manual UI test is needed for this API-only slice now. All DB migrations/grants/mutations ran only in isolated schemas/temporary roles in the distinct test database, and smoke processes/roles/schemas were removed. No application migration, public activation, real GitHub request, paid model call, UI, operator write, financial effect or four-agent execution is claimed. [OPERATORS.md](OPERATORS.md) records setup and remaining acceptance.

## Phase 8: shared run accounting and durable tool checkpoints (October 20, 2026)

On "move ahead", staged only the verified Phase 7 files, secret-checked and pushed `61b7ecebf3d71a705419fb9e8adf5770ca8bf362`, then verified the remote hash. The user's AGENTS/skill installation and autoskills dependency were preserved locally and excluded from that commit. An initial cold auth-import test timed out; its isolated and complete 710-test reruns passed without source changes before the push. The new antislop rule had no saved mode; the user selected during for this session. No global preference was saved. Phase 8 stays local until the next instruction.

This bounded Task 3E slice addresses V2-FR-12-13 and V2-NFR-01, 04-06, 08, 15 through the existing mock worker and resource-accounting primitives. It does not complete the four-role runtime, actual role prompts/lesson snapshots, model-output checkpoints, two-review-cycle control or live provider integration. Task 3 remains incomplete until those connected runtime gates pass.

### Delivered behavior

- Migration 009 adds private, scope-preserving run and attempt records plus a global UTC-day token ledger. A run belongs to its accepted message/job revision and pins a mock recipe, effective policy version, canonical record hash and fixed limits. The default worker consumes that stored recipe and reuses successful tool checkpoints after lease recovery, including legitimate empty results. Changed records fail closed.
- Reservations count every dispatch across worker instances/roles: at most 12 model requests, 16 tools, 24,000 tokens per run, 600 reserved output tokens per request and two attempts per operation. A separate conservative global allowance is 24,000 tokens/day. No model dispatcher uses this API yet; all model accounting in tests is simulated and mocks spend zero model tokens. A future dispatcher must derive input capacity from its actual request and honor output/retry limits before any live call.
- Exact observed settlement releases unused capacity once on the original funding day. Unknown/crashed outcomes keep their full reservations. Reported overages are retained honestly and block later dispatch instead of being hidden by a limit/constraint. Parallel duplicate reservations cannot dispatch twice under one lease; a replacement lease needs a separately counted attempt for unknown work. Allocation, counters and daily funding share a transaction.
- The 180-second deadline begins on first worker use and includes retry backoff/recovery downtime; it excludes the initial queue and later human waiting. This is deliberately stricter than exact active-time accounting. The mock handler deadline becomes 30 seconds to include checkpoint DB work within the existing 60-second lease. Each tool retains its five-second timeout. No heartbeat or cooperative external-I/O cancellation is claimed.
- Every operation rechecks current lease, worker, source revision, case state and suppression with case/job/run lock ordering. STOP/new evidence fence stale work. Resource denial persists a fixed reason, then pauses the job/case for human review without consuming remaining retries. Dedicated worker grants allow accounting/checkpoint writes but deny pinned-snapshot/capacity edits, deletion, V1/session access and facts changes. No new public/operator API or permission was added.

### Two self-review passes and integration corrections

Initial unit/DB tests failed on the missing module. The first implementation passed nine of ten database scenarios; PostgreSQL's JSONB key ordering made identical retried requests look different. Canonical fingerprints fixed that existing failing restart test, and all initial ten DB tests passed.

Self-review 1 added two failing regressions: crossing UTC midnight could associate the attempt with a different day than its reservation, and foreign-account input could obtain a dispatch slot. Attempts now retain the funding row's returned day, and account identity is checked before reservation. All twelve then-existing DB tests passed after those fixes.

Self-review 2 reproduced three failures before fixing them: foreign record data inside a checkpoint could pass with local evidence references; a missing funding row silently allowed a run refund; and tool output arriving after the run deadline was checkpointed. Stored record scopes are now checked alongside evidence/version scope, missing funding aborts the entire settlement, and late tool output persists a deadline block instead of a success. Known usage can still be reconciled without pretending a late result is publishable. The complete fifteen-test suite passed after these fixes. No separate reviewer model was invoked.

Three final scenarios verify honest overage accounting, rollback after attempt-insert failure and a reclaimed default worker reusing an existing checkpoint and pinned recipe. Pinning also rejects changed records; repeated settlement is idempotent. Existing migration replay and V1-reader tests were extended for the new tables.

The first full DB run passed 115/116 tests; the restricted-worker fixture reused one connection as a fake pool, causing parallel checkpoint transactions to overlap. It now uses a real pool with the same restricted role/search path; its targeted test passed and the entire suite was rerun. The permission checks were not relaxed. This fixes a test fixture, not a production grant failure.

### Actual verification and limits

Final verification passed: 711 offline tests/49 files; all 116 database tests/eight files in 301.99 seconds; typecheck; lint; pinned V1 guarded replay/full coverage; frozen-fixture integrity; production build. DB tests exercise the actual default worker, restricted grants and restarted CLI. No additional HTTP/browser smoke was required because this slice changes no route or UI. All 16 server manifests exclude private environment/evaluator assets; credential, changed-text punctuation, relative-link and whitespace checks pass. [Antislop delivery gate](PHASE8-REVIEW.md) records applicable checks and explicitly marks visual checks N/A. Existing tracing, Vitest and PG SSL compatibility warnings remain.

All migration/grant/mutation work was confined to isolated schemas and temporary roles in the dedicated test database. The application database was not migrated, no worker host or public V2 activation was provisioned, no dependency was added, and no OpenAI API call was made. Unknown reservations are retained without a cleanup/refund job; checkpoint outputs come only from the trusted scoped tools. There is no currency-cost guarantee, performance/load claim, customer publication or financial effect. [RUNS.md](RUNS.md) documents the actual worker/accounting contract. Next is the connected, budgeted four-role mock workflow with real role-specific prompt/output checkpoints, before live dispatch.

## Phase 9 / Task 3F: durable four-role mock workflow (October 20, 2026)

The user verified the existing application working and said "move ahead". Phase 8 and the branch-policy correction were committed/pushed to `v2` as `7914b5c`; remote HEAD was verified. `main` remains `61b7ece`. Earlier V2 commits still exist on `main`; this phase does not rewrite that history or change production settings. User skill/setup files and autoskills changes were preserved outside the commit. New Phase 9 work stays local until the next instruction.

### Implemented boundary

Four explicit deterministic role functions share one controller. Customer forwards accepted text as untrusted data; Coordinator assigns scoped account/policy tools; Investigator returns observed evidence/uncertainty; Customer drafts a pending acknowledgement; Reviewer checks its fixed wording/evidence. Rejection causes targeted policy reinvestigation, followed by at most two correction cycles. Missing evidence or unresolved review escalates. Six normal envelopes, eleven for one correction and seventeen for two corrections plus escalation are bounded by eighteen stored messages per run. All outcomes pause for human review.

Migration 010 adds private `v2_agent_messages` with scoped run/parent foreign keys, stable operation keys and bounded envelopes. Run storage checks current case/lease/deadline, allowed role routes, parent recipient and observed evidence, including nested proposal references, before insertion. Completion must reference the actual last review/escalation and its review count/evidence. Worker grants add append-only messages and only the customer-message columns needed to read the accepted source; V1/session access, message edits/deletion and customer writes remain denied.

New runs pin four mock instruction versions/texts, accepted source text and explicit `none` lesson version alongside policy/records/limits. Unsupported instruction manifests fail closed. Cached outputs retain their original step timestamps and are returned without rerunning the role; successful tools are reused across leases. Existing `mock-investigation-2` runs retain their recipe/summary. Unavailable tools receive one counted retry; valid missing results escalate without retry. Mock roles consume zero provider requests/tokens, while real accounting primitives remain disconnected from a provider.

`npm run workflow:v2:mock` is functional without a DB/key. CLI self-checks verify repeatable output, both businesses, rejected/corrected wording, missing-policy escalation and invalid options. Fault injection is explicitly labeled in output. The existing DB worker CLI uses the durable controller. No new HTTP route or UI is introduced. [Workflow contract](WORKFLOW.md).

### Test-first implementation and two self-review passes

Initial tests failed for the missing modules and all five missing DB behaviors. After implementation, eight targeted offline and 43 database tests passed across worker/run/workflow suites. One negative expectation initially required a particular error string; the forged operation was already rejected, so only that assertion was relaxed.

Self-review 1 reproduced two failures before fixing them: correct wording with dropped evidence was approved, and receiving only policy could imply a complete account investigation. Reviewer now requires the finding's evidence set, and Investigator requires both account and policy evidence. All six then-existing offline workflow tests passed.

Self-review 2 reproduced four DB failures before fixing them: nested proposal evidence bypassed observed-tool checks; an envelope could be inserted after the deadline; completion could name a nonexistent final review; and SQL null comparisons accepted a missing identity envelope. Nested evidence, insert-time deadline/lease checks, final-checkpoint binding and strict SQL truth checks fix these; all nine then-existing workflow DB tests passed. Verification of this pass also reproduced/fixed ignored instruction versions and envelopes repeating run creation time. Unknown instructions now fail before any step; each new envelope records its own time. These were self-reviews, not an independent reviewer-model invocation.

### Actual verification and limits

Passed: typecheck; lint; 718 offline tests/50 files; all 129 database tests/nine files in 435.15 seconds; V1 pinned guarded replay/full coverage; all 36 frozen input hashes; production build; deterministic CLI/both-business/error-path assertions. The full DB suite covers the actual restricted worker/CLI restart, cached roles, transient tool retry, eighteen-message ceiling, two persisted corrections, legacy runs and final-review binding. All 16 server manifests exclude private environment and evaluator assets. Text/link/credential/whitespace checks and the [backend antislop gate](PHASE9-REVIEW.md) pass; UI checks are N/A. A final read-only cleanup check confirms zero test schemas or temporary V2 test roles remain.

All DB mutations/migrations/grants use isolated test schemas and temporary roles in the dedicated test database. No application migration, hosting change, public activation, real GitHub/browser acceptance, dependency addition or OpenAI call was performed. Existing tracing/Vitest/PG compatibility warnings remain. This fixed mock routing/acknowledgement review does not demonstrate model-selected delegation, payment matching, a $14 proposal, customer publication, financial approval, self-improvement or model quality. Provider reservations/output checkpoints/actual prompt/lesson integration and substantive billing workflows remain required before claiming Task 3/4 complete.

## Phase 10 / Task 4 mock billing: evidence-based pending proposals (October 20, 2026)

On "move ahead", Phase 9 was committed/pushed to `v2` as `1af1f04`; remote HEAD was verified and `main` remains `61b7ece`. Only the new CLI script entry was staged from package.json; the user's autoskills dependency/lock and skill/setup files remain untouched outside the commit. Phase 10 stays local until the next instruction.

### Implemented boundary

New `mock-billing-1` runs pin the business/snapshot/invoice context and four billing instruction manifests. The same durable controller now gathers five independent scoped tool results, reconciles existing allocations/credits, identifies one available settled payment and one policy-eligible cancellation, and produces evidence-linked integer-cent facts. Customer builds a typed proposal and pending wording; Reviewer reconstructs observed records and reuses the existing proposal preview to verify policy, references, actions and arithmetic. Rejection names four relevant billing tools, bounded by the existing two correction cycles and shared sixteen-tool limit.

Northside's synthetic $84 case proposes a $50 allocation plus $20 credit, leaving $14 pending. Harbor Subscriptions has a one-day cancellation window, so its three-day cancellation is ineligible; the same code proposes only the $50 allocation, leaving $34 pending. Partial allocations/credits reduce new proposed amounts. Multiple invoices/payments/cancellations, missing evidence, contradictory data or an unsafe preview escalate instead of selecting a convenient match. Customer text is not used to assert a payment exists or grant permissions.

Pending proposals/projected balances are stored in internal envelopes/job results. Completion requires the actual last review and its proposal parent, exact reviewed proposal/text, matching evidence, and a fresh preview against scoped case facts. Altered/missing proposals, false projected amounts and completed-action wording cannot be stored as reviewed results. Cases remain awaiting_human; no financial effects or customer replies are committed. Prior `mock-workflow-1` and `mock-investigation-2` recipes retain their pinned behavior. No new migration, dependency, grant, HTTP route or UI is needed. [Workflow contract/demo](WORKFLOW.md).

### Tests and two self-review passes

Tests first failed for the absent billing module and two missing DB behaviors. Six initial pure billing tests then passed, including both business policies, missing/ambiguous evidence and rejected unsupported drafts. Typecheck required explicit discriminant checks for tool results. The first full workflow DB run passed 11/15; four completion paths exposed one caller passing extra case fields into strict AccountScope validation. The caller now passes only business/workspace/account. Targeted persistence and final-review tests passed after fixing; validation was not weakened.

Self-review 1 reproduced three failures before fixing them: floating-point formatting lost a cent near the safe-integer boundary, a contradictory finding was ignored when the draft happened to be correct, and an approved review could simultaneously request reinvestigation. Existing integer-cent formatCents, matching reconstructed finding payload/evidence, and stricter review validation fix these. All nine then-existing billing tests passed.

Self-review 2 reproduced two message-boundary failures: billing facts could name records absent from their evidence list and carry inconsistent projected arithmetic. Findings now require their invoice/payment/cancellation/policy references and exact integer-cent balance relationship. Existing partial allocation/credit handling is also verified. All twelve billing tests and seven prior workflow tests passed. These are self-reviews, not separate reviewer-model invocations.

### Actual verification and limits

Passed: 730 offline tests/51 files; typecheck; lint; V1 pinned guarded replay/full coverage; all 36 frozen input hashes; production build; deterministic offline CLI assertions for $14/$34, both businesses, rejected/corrected drafts, missing policy and invalid business. All sixteen server manifests exclude private environment and evaluator assets. [Scoped antislop gate](PHASE10-REVIEW.md) records applicable evidence; UI checks are N/A.

The full DB run passed 132/133 tests across nine files in 501.19 seconds. Its sole failure was the existing default-worker test expecting two tool calls from the prior recipe. Updated the count/status-array expectations to five; a first targeted rerun exposed the second stale array assertion, then the corrected test passed in 22.23 seconds, including both successful completion and immediate resource-limit pause. All seventeen workflow DB tests passed in the full run, including pending persistence, unchanged facts/transcript, cached roles, two review corrections, ambiguous evidence, legacy acknowledgement and tampered/missing proposals or completed-action wording. Runtime code did not change after the full run began. Only the affected fixture/test was rerun, not the full DB suite again. Final read-only cleanup verified zero temporary test schemas/V2 roles; source/credential/punctuation/whitespace checks and all 61 local documentation links pass.

This is deterministic mock billing, not language-model reasoning, independent evaluation, model-selected delegation or generalized payment matching. Initial proposals require one invoice, at most one available settled payment and one eligible cancellation. All outcomes pause for human review; no application migration, public activation, hosting change, real OAuth/browser check or OpenAI call was made. No active lesson is introduced. Provider dispatch/output checkpoints, live evidence, financial approval/action storage and V2 UI remain required. Existing tracing/Vitest/PG warnings remain.


## Phase 11: durable model-step reservation and output (October 20, 2026)

On "move ahead", pushed the verified Phase 10 work to `v2` as `7ac9372`. Remote `main` remains `61b7ece`. User skill/setup and autoskills dependency changes remain outside the commit. Phase 11 stays local until the next instruction.

This slice adds `executeModelStep` with an injected single-attempt transport and private migration 011. Role instructions, model, exact original/corrective requests and routing are pinned. Each dispatch reserves shared budget first; known usage and validated output/completion linkage commit together. Unknown outcomes retain the full charge. Cached output resumes without a call, while changed requests, duplicate dispatch, stale leases, STOP, invalid evidence and overrun fail closed. Existing accounting and envelope validation are reused. [Contract and limitations](MODEL-STEPS.md).

### Tests and two self-review passes

Initial offline tests failed for the missing module/store implementation. Four dispatcher tests then passed. Typecheck caught inferred optional output branches, fixed with explicit narrowing. Initial DB integration passed seven/eight; the first transport's test assertion used `customer-billing-1` instead of the actual pinned `customer-billing-mock-1` and was corrected. All eight then passed in 52.63 seconds.

Self-review 1 reproduced two gaps before fixing them: the transport could mutate its request after reservation, and the mock writer could fill a prepared model operation's message slot. An immutable request copy and model-pin guard fix both. Five offline dispatcher tests and the targeted DB regression passed afterward.

Self-review 2 checked those fixes, shared accounting/transaction boundaries, role grants and bounded retry/recovery behavior. Added verification for unobserved evidence, storage failure rollback, deadline crossing and exhausted daily capacity. The updated restricted worker really prepares/reserves/settles a fake model step while pin rewrite/deletion remain denied. Targeted grant/migration/model checks passed (four selected tests). The request JSON storage cap was aligned with two maximum-size admitted requests during review; this is a preventive bound adjustment, not a reproduced failure. These are self-reviews, not independent reviewer-model invocations.

### Actual verification and limits

Passed: all 735 offline tests/52 files; all 146 database tests/10 files in 590.40 seconds; typecheck; lint; V1 pinned guarded replay/full coverage; all 36 frozen input hashes; production build; and source/link/credential/whitespace checks. All sixteen server manifests exclude environment files and private V2 evaluation assets/scripts. The full DB run includes the actual restricted worker/CLI restart, legacy recipes, migration replay, V1 reader isolation and all thirteen new model-step cases. [Backend delivery gate](PHASE11-REVIEW.md). Final read-only cleanup confirmed zero temporary test schemas or V2 test roles remain. No application migration, deployed role change, OpenAI call, credential setup, browser/OAuth acceptance, hosted worker or UI change was performed. Fake transport results do not demonstrate model reasoning or live performance. The default worker stays mock. Live adaptation, role-specific provider prompts/controller integration, customer publication, financial approval/actions and active learning remain planned. Task 4 is not complete. Existing Next tracing, Vitest and PostgreSQL compatibility warnings remain. A packaging check initially also rejected traced test source files; that broader condition is not the private-evaluation exclusion. All sixteen manifests exclude environment files and private V2 evaluation assets/scripts; existing broad tracing still includes source/tests.


## Phase 12: single-attempt OpenAI SDK transport (October 20, 2026)

Pushed verified Phase 11 as `73e86ac` to `v2`; remote `main` remains `61b7ece`. Only its nineteen files were staged and credential-scanned. User skill/setup and autoskills dependency changes were excluded. Phase 12 stays local. Akshay asked for clearer product progress and more involvement, so [STATUS.md](STATUS.md) now separates built capabilities, current work, remaining milestones and decisions to review before UI work.

The adapter uses the installed SDK directly, with explicit credentials, a fixed OpenAI endpoint, no SDK retries, 30-second timeout, cancellation, JSON output, one choice, 600 completion tokens and no stored completion. It maps known/unknown usage and rejects incomplete/refused/tool-call output without losing valid usage. Error details and SDK logging are suppressed. The SDK's ambient custom-header feature is rejected at construction. The default worker and web routes remain disconnected; no live enablement or new dependency/configuration is introduced. [Contract](MODEL-STEPS.md).

### Tests and two self-review passes

Initial tests failed because the adapter module did not exist. The implementation passed nineteen offline tests, typecheck and two actual SDK-to-durable-store database tests, with fake HTTP injected below the SDK. One proves dispatch follows reservation, usage settles and output is reused; the other proves a retryable server error sends once and retains the unknown charge.

Self-review 1 found no confirmed implementation defect. Extended verification to SDK timeout, in-flight abort, refusal/tool-call responses, malformed choices/usage and malformed pinned requests; all twenty-nine adapter tests passed. No deliberate faulty implementation was introduced to manufacture findings.

Self-review 2 identified that import-boundary tests watched the old provider directory but did not recognize the new adapter. A probe import reproduced that gap before fixing it. A shared model-code path list now guards web components, V2 routes and the mock-worker entry point. All thirty-eight targeted adapter/import tests and typecheck passed afterward. No further in-scope defect was found. Both passes were self-reviews, not an independent reviewer-model invocation.

### Actual verification and limits

Passed: all 765 offline tests/53 files; typecheck; lint; production build; V1 pinned guarded replay/full coverage; all 36 frozen input hashes; source/local-link/credential/whitespace checks; and environment/private-evaluation exclusions in all sixteen server manifests. Final read-only cleanup confirmed zero temporary schemas or V2 test roles remain. [Backend delivery gate](PHASE12-REVIEW.md). The targeted model-step DB suite passed all fifteen tests in 82.48 seconds. The full ten-file database suite was not rerun this phase: SQL/grants and runtime storage behavior are unchanged; the prior Phase 11 full run passed all 146 cases. This phase adds two SDK integration cases. No paid OpenAI call, application-database migration, hosting/deployment change, real OAuth/browser check or UI work was performed. Live model compatibility, quality, latency, spend controls and four-role integration remain unverified. Task 4 remains open. Existing Next tracing, Vitest and PG compatibility warnings remain.


### Phase 12 push and pause checkpoint

Akshay requested pushing all completed work, then waiting for the hourly usage allowance to reset. Phase 12 is verified for this push; no next implementation phase starts in this turn. The assistant cannot observe the allowance reset, so continuation waits for Akshay to resume. Existing validation evidence above remains applicable; only status documentation changed after verification. User setup/dependency edits remain excluded.


## Phase 13: four-role model transport integration (October 20, 2026)

Akshay resumed after the usage pause. Phase 12 was already pushed as `913b0f9`; no new push was needed. Phase 13 stays local. [Product status](STATUS.md) and [workflow contract](MODEL-WORKFLOW.md) distinguish this internal test integration from a live application.

Six role tasks exercise Customer, Coordinator, Investigator and Reviewer through the existing SDK/checkpoint path. Coordinator output chooses a nonduplicate subset of pinned scoped requests; actual read results feed Investigator and the draft/review. A deterministic billing guard can override model approval. Both fictional business policies are exercised. `model_test` / `model-billing-test-1` pins the model and all six complete prompt strings. Existing runs cannot switch mode/model; mock messages, the mock worker and mock completion API reject these runs. A returned result remains internal; it does not finish the job/case, publish text or apply any action.

### Tests and two self-review passes

Initial role/workflow tests failed for absent modules, then seven pure tests and typecheck passed. Initial SDK/database integration passed six/seven cases in 124.45 seconds. The remaining provenance test supplied a mock result that failed the existing missing-evidence rule before reaching the new guard. Corrected the fixture to a valid escalation-shaped mock result; the targeted rerun passed three matching cases in 66.78 seconds, including both ordinary business cases.

Self-review 1 reproduced three input-boundary failures before fixing them: nested tool arguments could name another account; nested proposal references could name another business; and tool record data could be foreign despite an empty evidence list. Inputs now reuse the actual body schemas, validate nested scope, and share `toolResultInScope` with durable tool settlement. Ten then-existing pure tests passed after fixes.

Self-review 2 reproduced missing/wrong parent context being accepted for dependent role requests. Parent kinds now match the task before any dispatch; all eleven targeted role/workflow tests passed afterward. The finding prompt now uses the same canonical summary constant as the conservative code guard and asks for preserved evidence order. No live quality claim is inferred. Both passes were self-reviews, not independent reviewer-model invocations.

### Actual verification and limits

Passed: all 155 DB tests/11 files in 756.15 seconds, including all seven new model-workflow cases, legacy mock runs, process restart and restricted worker permissions. Final read-only cleanup confirmed zero temporary schemas or V2 test roles remain. Source/link/credential/whitespace checks and all sixteen environment/private-evaluation manifest exclusions passed. [Backend delivery gate](PHASE13-REVIEW.md). Typecheck, lint, build, pinned V1 guarded replay/full coverage and all 36 frozen input hashes passed. The first full offline run passed 775/776 while other checks/build ran concurrently; one existing operator-import test hit its five-second timeout. An unmodified standalone full rerun passed all 776 tests/55 files. No timeout or test behavior was changed to hide that failure. The complete DB run passed after the provenance/completion changes.

No paid OpenAI call, live activation, new dependency/migration/grant, application-database change, hosting/deployment, OAuth/browser acceptance or UI work was performed. Existing V1 routes and default mock CLI behavior stay separate. The returned model-test guard result is recomputed, not a persisted job-completion record. Model revision routing, lifecycle completion, customer publication, financial approvals/actions, evaluated learning and UI remain open; Task 4 is incomplete. Existing Next tracing, Vitest and PG compatibility warnings remain.
