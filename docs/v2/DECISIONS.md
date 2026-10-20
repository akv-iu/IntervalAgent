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
