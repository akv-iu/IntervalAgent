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
