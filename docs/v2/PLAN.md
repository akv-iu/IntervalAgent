# Recovery Lab Version 2: implementation plan

Status: Phase 12 is complete and verified for the user-requested push to `v2`. It adds the single-attempt OpenAI SDK adapter with fake-HTTP verification; the default worker remains mock. Work is paused at the user's request until usage resets and they resume. Live four-role integration, active lessons, operator approval/actions and UI remain planned; Task 3/4 release gates stay open. Start with [product status](STATUS.md); see [model-step contract](MODEL-STEPS.md) and [verification](DECISIONS.md).
Date: October 20, 2026.
Build contract: [SPEC.md](SPEC.md). V2 requirement IDs in this plan refer to that document.

## 1. Intended result

Deliver a four-agent case-resolution portfolio project: Customer Agent, Coordinator, Investigator, and Reviewer. Agents exchange structured tasks and evidence, use scoped synthetic business tools, carry cases through human review, and improve through evaluated, versioned lessons. The existing chat remains the customer's entry point.

Build additive vertical slices alongside V1. Each task must leave a working, reviewable increment, with tests for its material failure modes. Completion of these planning documents does not authorize a deployment, create paid model calls, or claim any implementation task is complete.

## 2. Architecture decisions

| Decision | V2 approach | Reason |
| --- | --- | --- |
| Agent count | Exactly four runtime roles; Reviewer also proposes lessons offline | Preserves clear responsibilities without adding a separate learning agent |
| Model use | Reuse the installed provider and a configured model; independent prompts/contracts per role | Makes role specialization measurable without provider migration |
| Orchestration | Model Coordinator proposes tasks; code validates and executes transitions | Allows evidence-dependent delegation with enforced limits |
| Agent communication | Persisted, typed, addressed envelopes associated with a case and task | Makes collaboration inspectable, resumable, and replayable |
| Background work | PostgreSQL jobs with leases, handled by an explicitly hosted Node worker | Fits the existing database and survives web request completion |
| Business tools | Validated server functions, scoped to business/workspace | Enables investigation while keeping SQL and mutations under application control |
| Data | Connected deterministic synthetic records; hidden evaluation oracles kept separate | Enables evidence-based tasks and repeatable scoring |
| Customer chat | Reuse useful UI/guard logic; move V2 history and case truth to the server | Supports persistent investigations and trustworthy state |
| Learning | Feedback -> candidate -> paired evaluation -> eligibility -> activation/rollback | Makes improvement testable and reversible |
| Financial changes | Typed proposal, authorized human approval, idempotent simulated action | Demonstrates complete business workflow with auditable effects |
| Extension proof | Two fictional billing businesses using one runtime | Tests concrete extensibility without building a general-purpose platform |
| Evidence | V1 unchanged; V2 mock/live/replay and instruction versions explicit | Preserves existing portfolio evidence and honest comparisons |

## 3. Current code to reuse or extend

| Existing area | Planned treatment |
| --- | --- |
| `src/components/LiveChat.tsx`, `Thread.tsx`, existing page/UI components | Reuse suitable chat/presentation pieces in the V2 workspace; do not mix internal agent messages into the customer transcript |
| `src/lib/agent/guard.ts`, `money.ts`, `time.ts` | Reuse tested hard rules, integer arithmetic, and timezone behavior; give V2 separate policy context where semantics differ |
| `src/lib/sim/loop.ts`, `live.ts` | Retain V1 behavior; create a V2 orchestration path rather than expanding the single-agent function into every responsibility |
| `src/lib/llm/types.ts`, `openai.ts`, `mock.ts`, `budget.ts` | Reuse provider foundations; add V2 contracts/budget context without invalidating V1 request keys |
| `src/lib/llm/recording.ts`, `fixtures/recordings/` | Preserve V1 sets and keys; introduce explicit V2 model/tool/transition replay contracts |
| `src/lib/lessons.ts`, `lessons-store.ts` | Reuse concepts/validation where appropriate; store V2 role/business/version-scoped candidates separately from public V1 lessons |
| `db/migrations/`, DB role scripts | Add scoped V2 entities, permissions, and job storage; leave V1 historical data intact |
| `tests/`, `.github/workflows/ci.yml` | Preserve existing checks and add meaningful V2 behavior, DB, and independent replay coverage |

Proposed module boundaries: `src/lib/v2/contracts`, `agents`, `runtime`, `tools`, `cases`, `learning`, and `eval`; business fixtures under `fixtures/v2/`; CLI/worker entry points under `scripts/`. Create files only when a task needs them, not as empty scaffolding.

## 4. Task sequence and completion gates

### Task 1: Lock contracts and deployment boundaries

Phase 1 scope: pure contracts, transition/access checks, deployment/auth decisions, and V1 isolation. No HTTP/session implementation, background worker, or model calls. Stop after testing and two self-review passes before moving to Task 2.

Completed October 19, 2026: 645 offline tests, V1 pinned replay gate, typecheck, lint, and production build passed after two self-review/fix passes. Authentication, worker execution, evidence lookup and financial commits remain in their later tasks; the contracts alone do not provide those features.

Requirements: V2-FR-03, 07-09, 23, 35-37; V2-NFR-06, 10-11, 15.

- Inventory V1 callers, dependency boundaries, migrations, tests, and current working changes.
- Read relevant installed Next.js documentation before any framework code.
- Define Zod contracts for cases, role outputs, internal envelopes, tools, proposals, and case/task transitions.
- Choose a maintained operator authentication solution, visitor workspace sessions, scoped credentials, and worker deployment arrangement. Document configuration and failure behavior.
- Record the V2 exception to V1-only endpoint/import rules in project guidance; retain V1 restrictions and test them independently.

Done when: example envelopes and transition tests pass; unauthorized routes and cross-scope IDs fail; a short decision record makes auth/worker setup concrete. No unimplemented success endpoints or empty agent stubs.

### Task 2: Build connected synthetic data and domain tools

This task is split into two reviewable phases. Phase 2 / Task 2A delivers connected development records, five scoped read tools, and a non-mutating proposal preview. Phase 3 / Task 2B separately authors and freezes evaluation families/splits and hidden expectations before persistence work starts. Development examples are not claimed as independent evaluation evidence.

Phase 2 completed October 19: two businesses, three accounts each, scoped record validation/read tools, policy-aware $14 preview, sanitized unavailable/not-found results, and two self-review passes. Final checks passed: 666 offline tests, V1 replay gate, typecheck, lint and build. Phase 1 was pushed as `936cdf2` when the user said to move ahead; Phase 2 remains local until the next such instruction. No manual browser check is required for these pure modules.

Phase 3 completed October 19: Phase 2 pushed as `3b04057`; frozen set `billing-20261019-1` contains 12 development, 12 validation and 12 holdout cases with distinct declared families and every mandatory category in each split. Inputs and evaluator-only expectations are separate, file/manifest hashes are pinned, holdout answers are locked by default, and import/deployment boundaries exclude evaluation assets from the runtime. `npm run fixtures:v2:check`, 680 offline tests, V1 replay, typecheck, lint and build passed after two self-review/fix passes. Holdout answers were not decoded/scored after authoring or used to tune any model. The cases were authored by Codex, not an independent external reviewer. Phase 3 remains local until the next "move ahead".

Requirements: V2-FR-14-17, 20, 32, 35-36; V2-NFR-07, 11, 13.

- Add deterministic invoices, lines, payments/allocations, cancellations, credits, and policy records.
- Implement read tools with explicit empty/error states, scoped arguments, and stable evidence references.
- Create two fictional billing-business configurations, including different allowed policies.
- Build and freeze the initial development/validation/final-holdout manifests, separating case families. Only development records and selected validation reports are used to shape implementation; final expectations remain evaluator-only.
- Keep hidden ground truth outside runtime-readable paths/storage.

Done when: reference arithmetic is $14; malformed/foreign evidence and over-allocation fail; same seed reproduces records; both business configurations pass the same tool contracts. Fixture categories and split counts satisfy SPEC section 7.

### Task 3: Deliver persistent cases and a resumable worker

Split into bounded phases: Phase 4 / Task 3A is case storage; Phase 5 / Task 3B adds durable mock jobs/worker execution; Phase 6 / Task 3C adds private visitor sessions and protected case/message APIs. Phase 7 / Task 3D adds operator GitHub OAuth, database memberships and protected read access. Operator mutations arrive with the human-review workflow, including transaction-time session/membership checks before any effect. Shared model budgets, instruction pinning and per-agent checkpoints arrive with the runtime before any live dispatch. Task 3 remains incomplete until its full completion gate passes.

Phase 4 completed October 19: Phase 3 pushed as `3b1d948`; additive private tables and a pool-injected server store persist scoped case facts, messages and revisioned audit events. Transactions cover the case change, event and accepted message together. Retries, concurrent writes, operator changes, STOP, pagination, rollback and V1 reader isolation have explicit database tests. These are storage primitives, not authenticated endpoints or a running worker. Migration 005 was exercised only in isolated test schemas; the application database was not migrated. Phase 4 stays local until the next "move ahead".

Phase 5: Phase 4 pushed as `f59b066`; ordinary messages now queue one mock job atomically, with competing-worker claims, expiring leases, three-attempt retries, stale-result rejection, STOP cancellation and transactional result/audit completion. The mock worker reads scoped account/policy tools and pauses for human review. A dedicated worker grant script and process-only environment configuration support the functional CLI; no model calls or hosted worker are involved. Verification evidence is recorded in the decisions document. Phase 5 remains local until the next "move ahead"; verified sessions and HTTP boundaries are next.

Phase 6: Phase 5 pushed as `55e28bc`; visitor sessions now use opaque hashed tokens, absolute expiry/revocation and server-assigned isolated workspaces. Four explicitly enumerated route files expose session, case and message operations with origin checks, bounded JSON bodies, shared DB limits, scoped DTOs and a dedicated web-role script. Visitor writes recheck the session inside the transaction. STOP retains priority over stale revisions and the ordinary request counter. The API remains off by default; no operator auth, UI or application-database migration is included. Phase 6 remains local until the next "move ahead"; operator OAuth/memberships are next.

Phase 7: Phase 6 pushed as `ccbf37e`; Better Auth now provides GitHub-only login, database sessions, owner-provisioned memberships and scoped case/fact/history GETs through separate opt-in/cookies/credentials. Login never enrolls an operator. Session expiry/revocation and membership are resolved together; OAuth errors are sanitized and logout bypasses ordinary quotas. The runtime role cannot change cases or grant membership. See [operator setup](OPERATORS.md) and [verification evidence](DECISIONS.md). This phase stays local. Real GitHub browser acceptance and operator mutations remain pending; shared budgets/checkpoints precede expansion of the mock workflow to four roles.

Requirements: V2-FR-02-05, 12-13, 23-24, 36-37; V2-NFR-01-02, 05-06, 08, 13, 15.

Phase 8 / Task 3E: Phase 7 pushed as `61b7ece`. The default mock worker pins its recipe/policy/record hash/limits, reserves tool dispatches and reuses completed checkpoints after lease recovery. Private run/attempt/daily-usage tables support shared model token/request accounting, conservative unknown reservations, exact known settlement and immediate resource-limit escalation. No model adapter is connected. This phase stays local until the next instruction. Four-role orchestration, role prompts/output checkpoints and review-cycle enforcement are next; Task 3 remains incomplete until those runtime gates pass. [Run contract and limits](RUNS.md).

- Add non-destructive V2 migrations for cases, messages, runs, tasks/jobs, tool results, events, and access scope.
- Implement server-authoritative case read/message submission with authenticated scope and idempotency keys.
- Implement worker claiming, leases, bounded retries, task completion/checkpointing, cancellation, budget reservations, and stale-write protection.
- Make a queued mock task update real persisted case progress. Add new tables only as needed by this slice.

Done when: refresh preserves a case; duplicate submissions create one task; two workers cannot both commit a step; restart resumes work; cross-business reads/writes fail; case changes invalidate stale work. No dependence on a serverless request staying alive.

### Task 4: Run the four-agent workflow end to end

Phase 9 / Task 3F and mock foundation for Task 4: six normal role envelopes are persisted with scoped parent links and observed tool evidence. Unsupported mock wording triggers targeted policy reinvestigation; two unsuccessful revision cycles or missing evidence escalate. Instructions/source text and an explicit empty lesson version are pinned. Legacy runs keep their prior recipe. `npm run workflow:v2:mock` demonstrates both fictional businesses offline; the existing DB worker uses the same controller with durable checkpoints. This phase stays local until the next "move ahead". It does not complete Task 4: the Reviewer checks a fixed acknowledgement, no substantive resolution is proposed, no reply is published and no provider runs.

Requirements: V2-FR-01, 05, 07-15, 17-18, 21, 24; V2-NFR-04-08, 10.

Phase 10 / substantive mock billing: new runs pin `mock-billing-1` and four billing instruction manifests. Five scoped tools provide invoice/payment/cancellation/policy facts. Customer proposes only a unique verified candidate and eligible credit; Reviewer independently recomputes the existing proposal preview and checks finding, evidence, amounts and pending wording. Completion rechecks the reviewed draft and source records. The reference proposal leaves $14 pending; the second business's stricter policy permits payment-only allocation leaving $34. Ambiguous/missing/contradictory evidence escalates. Prior run recipes remain supported. This phase stays local until the next "move ahead"; provider integration and actual financial approval/actions remain later work.

- Implement Customer, Coordinator, Investigator, and Reviewer prompts and output validation using the provider abstraction.
- Route structured requests/findings/reviews through persisted tasks. Investigator reads independent evidence concurrently where appropriate.
- Add targeted reinvestigation, bounded review revisions, and human escalation on unresolved evidence or resource exhaustion.
- Put existing hard guards and V2 policy checks immediately before response publication; check STOP and case revision again then.
- Pin prompt/policy versions per run and account for every provider/tool attempt.

Done when: a CLI mock case exercises all four roles; an injected unsupported claim causes review rejection and a successful targeted revision; a permanently ambiguous case pauses rather than inventing a result. Runtime limit, timeout, and STOP tests pass.

### Task 5: Make the collaboration visible in the case workspace

Requirements: V2-FR-01-06, 24, 37-38; V2-NFR-03, 08, 12, 16.

- Add the V2 workspace/case page with customer chat, durable status, agent activity, evidence, and proposed resolution.
- Show typed messages, tool statuses, concise decision summaries, and resource use; separate internal activity from customer chat.
- Add polling, pagination, accessible loading/error states, and clear mock/live/replay labels.
- Keep V1 evidence accessible with explicit version labels.

Done when: the user can submit the reference dispute, follow all four roles, inspect evidence and pending $14 proposal, refresh mid-run, and see an accurate recoverable error. User browser/keyboard acceptance is recorded.

### Task 6: Close the loop with human review and simulated actions

Requirements: V2-FR-03-04, 15, 17-19, 21-24; V2-NFR-01-02, 06, 08, 12-13.

- Add typed proposals, review/approval records, simulated ledger actions, and the operator inbox.
- Require appropriate operator permission, current record/policy versions, and an allowed proposal type before action.
- Commit action and audit trail atomically; resume customer communication with confirmed results.
- Support reject/request-information and ensure concurrent/stale approvals cannot apply conflicting effects.

Done when: the $50 payment allocation and $20 credit commit once after approval, balance is $14, customer wording reflects actual committed state, and rejection leaves balances unchanged. This is the first complete product milestone.

### Task 7: Establish comparable evaluation and V2 replay

Requirements: V2-FR-20, 31-34, 37; V2-NFR-04-05, 08-09, 16.

- Add a tool-enabled single-agent runner using the same records, permitted actions, and maximum budgets as the four-agent workflow.
- Record model responses, tool request/results, internal messages/transitions, human fixture decisions, and pinned versions. Keep V1 recordings immutable.
- Implement independent scoring from hidden expected facts/outcomes. Mandatory hard checks remain deterministic; subjective judgments are labeled and secondary.
- Report resolution accuracy, unsupported claims, escalation correctness, completion, latency, token use, and per-role breakdowns. Preserve failures in denominators.
- Add offline/mock evaluation and a V2 replay gate alongside V1 CI. Expose only functional documented commands.

Done when: replay runs without network/DB/keys; missing entries fail; a deliberately bad fixture is caught; comparison explains the V1 tool-access difference. Do not inspect/tune against the final holdout yet.

### Task 8: Implement the evaluated improvement loop

Requirements: V2-FR-25-30, 32-34, 36; V2-NFR-05-08, 14, 16.

- Capture source feedback and have the Reviewer propose role/business/situation-scoped candidate lessons offline.
- Add lifecycle/version storage, conflict checks, bounded lesson retrieval, paired active-versus-candidate evaluation, and eligibility reports.
- Add operator promotion, rejection, activation history, and rollback; pin instruction sets to runs.
- Add opt-in automatic promotion only inside the isolated synthetic sandbox after the same eligibility gates.
- Provide a learning view showing the observed failure, candidate, independent evidence, decision, and actual before/after results.

Done when: a genuine candidate improves independently authored validation cases without mandatory regressions and can be promoted/rolled back; an unsafe or overfitted candidate stays inactive; changing one business's lessons cannot affect the other. If no candidate qualifies, show that result and continue iteration without claiming improvement.

### Task 9: Verify isolation, reliability, and measured limits

Requirements: V2-FR-05, 12-13, 19, 23, 30, 35-37; V2-NFR-01-16.

- Run multi-worker race/restart, stale output/approval, duplicate action, budget exhaustion, tool/model failure, and malicious-record scenarios.
- Run both business configurations through the same runtime and verify visitor/operator/data/lesson isolation.
- Measure API responsiveness with the SPEC dataset/concurrency; measure live-case duration and actual usage separately.
- Rehearse additive migrations on a V1 database copy, worker/web restart, feature disable, and lesson rollback. Do not reverse financial history by deleting committed ledger entries.
- User completes keyboard/browser checks for ordinary, ambiguous, failed, and stopped cases.

Done when: hard correctness/security gates pass and measured performance is reported against targets. Document any unmet target; do not mark the corresponding release criterion complete.

### Task 10: Record live evidence and prepare the V2 release

Requirements: V2-FR-20, 28, 31-34, 37-38; V2-NFR-08-09, 14-16.

- Confirm configured live credentials/spend controls and a working worker host through the existing authorized setup process; continue mock/replay work if unavailable.
- Pin a small live four-agent collaboration/reinvestigation recording and a genuine learning before/after example. Record actual usage and limitations.
- Freeze selected prompts/lessons, then evaluate the locked final holdout once across the comparison setups. Report full results; retire/replace the holdout before tuning from its failures.
- Update README/runbook/demo notes with setup, actual commands, role architecture, learning boundaries, worker operation, provenance, and extension instructions.
- Complete typecheck, lint, offline tests, explicit DB integration tests, V1 and V2 replay, and production build. User performs the release browser pass.
- Prepare deployment configuration and release notes; publishing is a separate explicit action.

Done when: every applicable SPEC release checkbox has linked evidence, the three-minute demonstration is repeatable, and there are no claims of autonomous training or business effectiveness unsupported by results.

## 5. Dependencies and milestones

Order: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 9 -> Task 10. Contracts precede migrations/runtime; independent scoring precedes learned-change promotion. Reuse earlier fixture work rather than generating a new dataset in each phase.

| Milestone | Tasks | Observable result |
| --- | --- | --- |
| M1: Collaboration core | 1-4 | Four roles exchange evidence-backed tasks; execution survives restart and respects limits |
| M2: Complete business case | 5-6 | Customer chat, collaboration timeline, human review, and one committed simulated resolution |
| M3: Demonstrated learning | 7-8 | Comparable evaluation/replay and a versioned candidate evaluated, promoted or rejected, and rolled back |
| M4: Portfolio release | 9-10 | Two businesses, reliability evidence, recorded live demonstration, final holdout, and operating instructions |

No calendar estimate is committed before Task 1 validates auth, worker hosting, and implementation scope. Track completed acceptance criteria rather than treating agent count as progress.

## 6. Task execution and verification

- Implement one reviewable task at a time. Follow the repository's existing review and user browser-check process where applicable; do not infer permission to push or deploy from this plan.
- User instruction (October 19, branch clarified October 20): on "move ahead", commit/push the completed verified phase to `v2` before starting the next phase. Reserve `main` for V1 production maintenance. Leave the newly completed phase for review until the next such instruction; do not force-push, merge V2 into `main`, or publish a V2 release implicitly.
- Record actual changes/checks in DEVLOG and plain-language decisions in DECISIONS; keep V1/V2 evidence distinguishable.
- Test material behavior and failures. Run impacted checks per task, then the complete release checks at the end; documentation-only edits do not require model calls or application tests.
- Use mocks first. Database tests require the dedicated test database; live calls require configured spend controls. Never use missing credentials as a reason to fabricate passing evidence.
- Maintain requirement traceability through task IDs, behavioral tests, and release evidence. Reconcile specification changes before declaring a task complete.

## 7. Planning-document completion

- [x] Exactly four roles include the existing customer chat agent.
- [x] Agent communication, investigation, bounded review, and human decisions are specified.
- [x] Self-improvement has independent evaluation, activation controls, and rollback.
- [x] Synthetic evidence, business extension, isolation, and deployment boundaries are specified.
- [x] Functional/non-functional requirements have IDs and verification criteria.
- [x] An ordered implementation plan maps tasks to requirements and completion gates.
- [ ] Implementation tasks 1-10 completed and evidenced.
