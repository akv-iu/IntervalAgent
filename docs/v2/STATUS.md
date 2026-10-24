# V2 status

October 23, 2026. Work is local on `v2-rebuild` in `D:\Projects\IntervalAgent-v1-rebuild`.

Product direction update: Akshay is developing an independent project and is no longer preparing an Interval AI presentation. The medium scope and existing agent/evaluation requirements remain. He accepted the latest functional correction, finalized the UI preview and explicitly approved implementing the Daylight checkpoint with current Codex usage unknown. The Daylight UI is now implemented locally; the other two themes remain previews.

Current spending policy: Akshay explicitly chose **Remove the $2 cap for local testing** on October 23. The local aggregate dollar ceiling is removed from the app/database and checkpoint fallback. Historical usage and reservations remain; manual/live calls bill the configured OpenAI API account. Earlier $2 figures below are historical, not the current policy. Per-run, turn, workspace, STOP and financial-review guards remain enforced.

**Phase 1 and the Phase 2A Daylight checkpoint are accepted for continuation.** After replacing the invalid inherited API credential with a dedicated local key, Akshay reported that the app works and explicitly requested a push to the V2 branch and continuation. A read-only model-access check returned HTTP 200; no generation call was made for that check. This is user-reported acceptance, not an exhaustive browser test by the coding agent. The remaining Phase 2 dashboard/source work has not been implemented.

### October 23 accepted-checkpoint handoff

- Push scope: the completed V2 runtime, persistence, Daylight UI, regression tests, scripts and these documents on `v2-rebuild`. Keep `.env.v2`, generated results and unrelated local notes out of Git. Do not merge into `main` or deploy.
- Fresh verification before the push: 633 offline tests and 52 isolated PostgreSQL tests passed. The test database is separate from the demo workspace and V1.
- Next bounded checkpoint, Phase 2B: two-business/twelve-client selection and a dashboard of saved case status, promises, extension requests and planned contact events. Preserve existing histories and the four model-led roles. Source-adapter proof and richer operator corrections remain separate follow-up checkpoints within Phase 2.
- Current Codex usage is unknown: the latest available rate-limit metadata is from 11:06 AM Mountain, too old for the 7:00 PM check. The user's usage-report-and-approval checkpoint remains required before implementation of Phase 2B. Browser/manual testing remains Akshay's.

Historical statements below describe earlier local checkpoints; this handoff supersedes their pending-acceptance/no-push status. Local generated trace paths are evidence references from development, not artifacts included in the Git checkout. No V1 database modification or production deployment is authorized.

## Implemented

- Four actual model-backed roles using OpenAI Agents SDK `0.21.0`: customer orchestrator, business verification, account resolution and Reviewer. Specialists are SDK agent tools; no separate orchestration framework was introduced.
- Three synthetic clients for one business, including a direct-read alternative. The two-business/twelve-client dashboard and second adapter remain Phase 2.
- A typed synthetic account-source contract with dated evidence, separate customer/business threads, claim/request correlation, business follow-up, operator packets and takeover/resume.
- PostgreSQL-backed private workspaces, raw messages, reviewed case updates, planned events and versioned review/audit links. Prior business replies cannot confirm a new claim. Late known replies are retained without applying conclusions.
- Atomic case update/reply/audit publication, duplicate protection, stale-run fencing, STOP, expiry/reset isolation and persistent conservative model-usage accounting. The original $2 ceiling was explicitly removed for local testing. The manual-feedback correction adds policy-authorized recognition of existing business-confirmed synthetic payments, with a receipt and balance/audit/reply committed together.
- Promises, extension requests, channel preferences and dated contact requests. Changing a channel does not require inventing an appointment; explicit global STOP still wins. New charges, other payment operations and contact execution remain unavailable.

## Verification evidence

| Check | Observation |
| --- | --- |
| Offline tests | 633 passed; includes preserved V1 coverage, role/source/usage checks, attention/runtime rendering and safe provider-failure classification |
| V2 PostgreSQL integration | 52 passed in `intervalagent_v2_test`; no model calls |
| Type checking | Passed |
| Application/script/test lint | Passed, using the targeted command in LOCAL-DEMO.md |
| Repository-wide lint | Blocked by four pre-existing `require()` lint errors in untracked `docs/learn/check.cjs`; that file was left unchanged |
| Production build | Passed; existing dynamic-filesystem tracing warnings remain in V1 `project-env.ts`; existing environment-file tracing exclusions remain enforced |
| Preserved V1 replay gate | Passed with pinned `live-20261016-1`, no model/DB fallback |
| Live persistent exchange | Passed: claim, business request, incomplete reply, complete reply, reviewed customer result and database reconnect |
| Live case updates | Passed: promise/call request; dated email request; channel-only preference without an invented date |
| Live negative checks | Wrong invoice remained conflicting; unsupported bank-verification/zero-balance claim was rejected |
| Live direct read / STOP | No unnecessary business delegation on the tested fresh record; STOP made no model call and blocked the planned event |
| Browser/UI/manual testing | Pending Akshay; not performed by the coding agent |

The successful persistent exchange used role configuration `v2-phase1-5`; subsequent preference/email checks used `v2-phase1-6`. Later deterministic audit, contact-switch and threat-guard changes have dedicated regression checks. These are small development samples, not a holdout score, financial-performance claim or proof that every conversation succeeds.

Observed complete-business-reply handling took about 55 seconds in the passing persistent sample, including a review/revision cycle. Waiting is visible and bounded; latency still needs broader measurement in Phase 5. At the original Phase 1 handoff, database-tracked calls reported 118,875 input and 7,426 output tokens; conservative used/reserved allowance was $1.697187 of $2, including the historical $1.66 reservation. Actual total API billing is unknown.

## Two self-review passes

1. Checked role/tool authority, account scope, command deduplication, interruption/reset behavior and budget accounting. Fixed old-claim evidence reuse, lost business-reply linkage during takeover, and normalized missing usage being treated as known. These are self-reviews, not independent reviews.
2. Exercised the persistent real-model exchange and checked saved state. The Reviewer initially confused a historical pending packet with current findings. Separated current review inputs, retained the failed trace and reran successfully. Added channel-only preferences, retained late replies, per-audit review/version evidence, conservative STOP/channel-switch handling and the preserved code threat guard. Relevant regressions pass.

## Manual handoff and later work

Open **http://127.0.0.1:3012/v2** and follow [LOCAL-DEMO.md](LOCAL-DEMO.md). Report UI issues or conversation failures before deciding on Phase 2.

Akshay's first manual pass found that workspace creation rejected a valid `127.0.0.1` origin. Next.js normalizes loopback request URLs to `localhost`; the origin check now uses the validated loopback Host header and still requires an exact scheme, host and port match. Regression tests reproduced the failure before the fix. Two self-check passes covered callers/security cases and actual HTTP creation/session restoration through Next.js. The latter returned 201/200; foreign, missing, alias and wrong-port origins remained blocked. Offline tests, database tests, type checking and changed-file lint pass. No model calls were made for this fix. Browser acceptance remains with Akshay.

After acceptance and fresh approval: Phase 2 adds the two-business/twelve-client operator journey, richer corrections and a second PostgreSQL source mapping. Phase 3 adds simulated financial operations. Phase 4 adds evaluated instruction/routing improvement and rollback. Phase 5 completes evaluation, replay, reporting and demonstration evidence. No subsequent phase is authorized by this status file.

## October 23 manual-feedback correction

Akshay authorized improving the payment conversation and latency while preserving model-led delegation. The orchestrator still selects specialists through SDK tool calls. Delegation now uses actual customer message IDs. Specialists receive scoped evidence/local dates directly; redundant context-read tools were removed. A completed specialist and the fixed source snapshot are not exposed for repeated work in the same run. New customer/business evidence starts a fresh run. Reviewer remains required; it understands that accepted business requests/updates are committed with the customer reply, rather than rejecting that acknowledgement as an unsupported external action.

The customer supplies the matching invoice before a new business request. A contextual Yes can confirm an explicitly scoped request. Partial replies can prompt one targeted clarification; conflicting findings no longer close the business reply path. Under the explicit synthetic business policy, reviewed recognition records the confirmed amount once. Pending/negative evidence, duplicate/snapshot-covered payments, wrong invoice/source, future dates, overpayments, operator-required proposals and stale runs cannot auto-change a balance. Earlier workspaces retain their old policy until the tester resets; no history is silently deleted.

Latest passing persistent HTTP sample: `results/v2-phase1/persistent-live-v2-phase1-10.json`, real SDK/model plus isolated PostgreSQL. Initial claim 5.9s, supplied invoice/business request 5.4s, scoped Yes/full recognition 11.9s, promise/callback 8.3s, fresh-record answer 7.1s, partial reply 10.3s and explicit partial-detail confirmation/recognition 11.1s. STOP took 41ms and made no model call. These are individual local development observations, not latency guarantees or a benchmark. Earlier candidates included a 32.5s partial-reply loop and rejected delegation attempts; those failures motivated the repeat-work guards and correlation changes. The latest passing full/partial exchange does not establish that every conversation succeeds. Final role-version-10 negative samples also passed: no matching payment, a Yes to a vague request remaining incomplete, and rejection of unsupported bank verification. Final conservative allowance accounting is $1.782719 of $2, leaving about $0.22; 345 database-tracked calls report 396,761 input and 23,400 output tokens, with no unknown-usage calls. This shared ledger includes prior development and the historical reservation; it is not actual billing.

Two self-review/fix passes covered (1) recognition authority, matching, snapshot coverage, duplicate/transaction behavior and interruption; (2) real-model conversation recovery, repeated delegation/source reads, Reviewer publication semantics and business follow-up. These are self-reviews, not independent reviews. Offline/DB tests, type checking, application/script/test lint, build and preserved V1 replay pass. Browser interaction/visual acceptance remains Akshay's; Phase 2, commits, pushes and deployment have not started.

### Invoice-mismatch correction, role version 11

Akshay's `Inv01` transcript exposed an invented explanation: no business request/result existed, yet Account Resolution said verification failed and the Reviewer accepted the summary. The customer should instead have been asked to clarify the mismatch with INV-101. A dated snapshot is not proof that a later payment did not arrive.

Execution status is now supplied to Account Resolution and Reviewer. A blocked invoice attempt is logged separately from an invoked/failed specialist; guard checks are scoped to the selected claim. The Reviewer checks execution claims in summaries as well as customer replies. A rejected specialist finding can receive explicit Reviewer feedback for one further bounded pass, chosen by the orchestrator. Repeat work remains disabled within each review pass; at most two reviewed passes remain allowed. The oversight panel no longer infers that verification was unnecessary merely because no findings exist. Existing customer histories are preserved.

Failing regression established before the fix; SDK boundary/targeted role-correction regressions now pass. Live SDK samples in `results/v2-phase1/invoice-regression-v2-phase1-11.json` passed for the exact mismatch (clarification, 2 calls), corrected invoice (business request, 4 calls), a different unknown invoice (clarification after a bounded revision, 8 calls), and rejection of unsupported bank verification. These are targeted model samples, not browser testing or a general success-rate claim. Two self-check passes covered execution provenance and the review/correction path. Full offline tests (618), isolated DB tests (47), type checking, application/script/test lint and build pass; pre-existing build tracing warnings remain. Akshay retains browser acceptance; no push/deploy or Phase 2 work was performed.

## Business report, dispute hold and live progress correction — role version 13

Akshay's latest exchange showed repeated settlement questions after a clear business assertion, contradictory review and no useful preview during the wait. Business Verification can now return `business_reported`: a linked invoice/amount that can be attributed without pretending to establish settlement. The customer agent receives that narrow attribution result; full evidence and unknown fields remain available to Account Resolution and Reviewer. Complete policy-compliant confirmation can still authorize recognition. A report alone cannot reduce the balance or create a receipt.

The orchestrator chooses specialists and escalation through model decisions. After a customer disputes the report, an accepted operator escalation sets a persistent hold. Further messages are saved without automatic model work until explicit resume. The UI offers an in-app dispute action and the requested review-needed banner. Provider-call start/completion hooks persist the actual active role and bounded timeline; UI polling displays those events and elapsed time without exposing unreviewed conclusions.

Latest actual HTTP sample: `results/v2-phase1/persistent-live-v2-phase1-13.json`. A claim/request took 8.5s (4 calls); the business's $50 reply took 6.1s (4 calls) and produced “Northside Fitness reports $50 for INV-101. If you believe that report is incorrect, you can dispute it here.” The dispute took 6.3s (4 calls), set the hold, and preserved the $129 balance with no receipt. An additional message saved in 0.35s without a model call. A concurrent HTTP read observed the active role/start event before any customer reply was published. These are local sample observations, not latency guarantees or browser acceptance.

Targeted live checks covered the pasted repeated business assertion, an explicit customer dispute and rejection of unsupported bank verification. Earlier development candidates still added irrelevant settlement caveats; their traces remain retained. The isolated dispute fixture initially omitted the preceding customer-facing report; correcting that chronology made the no-reopened-verification check pass. Current offline (620), isolated PostgreSQL (48), type checking, application/script/test lint, build and the preserved V1 replay gate pass. Build retains the existing V1 dynamic-filesystem tracing warnings.

Two self-review passes checked (1) report versus recognition authority, correlated evidence, persistent hold/resume and STOP/revision fences; (2) provider-hook ordering, duplicate completion accounting, HTTP progress before publication and the actual report/dispute exchange. These are self-reviews, not independent reviews. Final conservative ledger: **$1.844025 of the approved $2**, about **$0.156 left**; 497 tracked calls, 606,205 input / 32,286 output tokens, zero unknown-usage calls. This includes historical reservations and is not actual billing. No budget/admission cap was raised.

Refresh the existing page and follow the updated LOCAL-DEMO instructions; no reset is required for this correction, and old transcript entries are preserved. Akshay owns UI/manual acceptance. Work remains local on `v2-rebuild`; Phase 2, commits, pushes and deployment have not started. `main` and `origin/main` remain at V1 restore `2827779`.

## UI delivery checks

### Local ceiling removal and technical-failure recovery

The app previously treated all failed runs as `needs_review`, including API failures before the first response. These technical failures now use `run_failed` with an explicit retry path and no human-role glow. Refresh normalizes legacy failed cases only when no genuine review hold, takeover or STOP exists. Disputed cases and Reviewer-blocked results retain operator review.

New failures save a bounded safe classification plus provider HTTP status/code when available. Raw error messages, bodies, credentials and headers are not published. OpenAI quota/credit codes differ from access, bad request, timeout, connection and other provider failures; an ambiguous 429 does not prove which limit was reached. Old failures do not acquire invented retrospective details. No automatic retry/model fallback was added. Reference: [official OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes).

The local accounting migration replaced the database's $2 upper-bound check with a non-negative check; reservations now continue above $2 atomically. It preserved the ledger (observed $1.911011 immediately after the change), messages, receipts and other restrictions. Usage API reports no local dollar ceiling, and the UI says calls are billed to the API account. Reset does not erase usage. CLI fallback no longer enforces the obsolete $2 cap. This is not a change to OpenAI billing, credit or provider limits.

Self-review pass 1 covered caller/schema/UI consistency, accounting beyond $2, idempotent settlement and migration preserving usage. Self-review pass 2 covered redaction, legacy technical recovery, held-case retry denial, timeout/stale fencing and runtime details. These are self-reviews. Offline tests (633), isolated PostgreSQL tests (52), type checks, application/script/test lint, build, served/production stylesheet checks and V1 replay pass. Existing V1 build warnings remain. No paid model call was made for this change; real-provider recovery and browser acceptance remain with Akshay. No commit, push, deployment or V1 data change was made.

### Phase 2A: finalized Daylight checkpoint

Customer and business windows remain side by side, with operator review below. One moving light and a soft perimeter highlight indicate the human role needing input, based on saved case state. The cue does not choose specialists or fabricate progress. Case switches start with the appropriate static highlight; ordinary handoffs animate once. Reduced motion disables travel, and motion never moves keyboard focus or scrolls the page. Native links let the tester navigate to the active window.

Fresh workspaces seed one labelled outreach message per case from the dated synthetic source. No model call, customer turn or retryable work is created by that opening. Selection/refresh does not duplicate it. Existing conversations are preserved without backfilling messages. The compact runtime box shows actual provider progress and saves completion/failure/interruption, duration, completed-call count and bounded steps. Its final summary survives refresh and no-run controls until the next accepted run. Completed/blocked runtime is also linked to the existing audit. Optional JSONB fields need no schema migration and allow old workspaces to load.

Self-review pass 1: checked callers, fixture provenance, opening-only retry denial, raw customer/business persistence, revision/STOP/hold fences and runtime transaction boundaries; offline and real PostgreSQL regressions pass. Self-review pass 2: checked role priority, no-run and rejected-message retention, failed/interrupted display, motion cleanup/reduced-motion paths, responsive source and preserved controls. Added server-rendered runtime checks and wrapped the client selector to avoid narrow-width overflow. These are self-reviews, not independent or browser reviews.

Source delivery report (the user's manual-testing instruction owns the browser portion):

- Direction PASS: approved Daylight layout, existing Barlow type and blue accent. ENERGY 2 / RHYTHM 2 / MOTION 2. Customer conversation is primary; runtime/history are subordinate.
- Purpose PASS: glow marks only the role needing input; travel communicates a handoff, not decoration or model reasoning. Quiet pane borders separate the three communication/authority surfaces. No new assets or libraries.
- Source behavior PASS: forms, selectors, controls and anchors have actual handlers/targets; empty/loading/error/STOP/hold states remain. Attention state tests and runtime server-render checks pass. No testimonials, fabricated metrics, ghost links or shipped theme toggles.
- Persistence PASS: 50 isolated PostgreSQL tests cover the seeded opening, summary refresh/deduplication/retention, stale writes, expiry/reset and financial guards. 626 offline tests pass.
- Build/tooling PASS: type checking, application/script/test lint, build and V1 replay gate pass. Existing V1 dynamic-filesystem tracing warnings remain.
- Browser/visual checks PENDING with Akshay: click-through, actual travelling-light appearance, keyboard/focus behavior, reduced-motion behavior, narrow layout and runtime expansion/retention. No browser result or final visual acceptance is claimed.

### Stylesheet delivery correction from Akshay's screenshot

The screenshot showed updated labels with none of the new layout styling. The broad Tailwind Turbopack rule transformed `workspace.module.css` into ordinary CSS and left an empty module export. The stylesheet existed and returned HTTP 200, but React received no class names. Prior source/render tests and a successful build did not exercise this mapping; the earlier verification was incomplete.

The loader now excludes `.module.css`, leaving native CSS Module handling to Next.js while preserving global Tailwind processing. `scripts/v2-check-styles.ts` reproduced the failure before the fix and now passes against both actual served assets and production build artifacts. It asserts a rendered workspace class matches a compiled stylesheet selector, with design tokens, the two-column grid and shared Tailwind utilities intact. It makes no workspace/model request.

Two verification passes covered the development asset boundary and the production/global-style boundary. Offline tests (626), type checking, changed-file lint, build and V1 replay pass. No storage change, model call, commit, push or deployment was made for this correction. Actual visual/motion acceptance still belongs to Akshay. Hard-refresh the local page; preserve the existing workspace.

### Empty saved-case opener and page-wide customer view

Akshay's Sam screenshot showed an untouched legacy case with no opening. Workspace access now seeds one labelled synthetic outreach only for an empty, ready case with zero turns/business replies and no commands, audit, active run, STOP, takeover or review hold. This runs under the existing workspace row lock after expiry/access checks. Concurrent refreshes do not duplicate it, create a turn, change expiry or call the model. Started and stopped histories remain intact. No reset or global database migration is required.

V2 now has a route-scoped page-wide canvas; the shared root layout is unchanged. CSS removes the inherited width cap only while the V2 page exists, and the extra outer workspace border/background box is removed. Individual customer/business/operator surfaces remain. Customer messages are separate chat bubbles, and incoming customer-facing replies carry the business name; technical agent identity remains in runtime/activity. The synthetic opener appears before the customer replies.

Two self-review passes cover (1) scoped legacy bootstrap, concurrent reads, history/STOP/run/expiry and spending invariants; (2) customer-facing rendering, route-scoped width/style delivery and preservation of V1 layout. Offline tests (627), isolated PostgreSQL tests (51), type checking and changed-file lint pass. Served and production-asset checks verify the full-width selector as well as CSS-module mapping and grid rules. Build and V1 replay pass; existing V1 tracing warnings remain. Browser appearance, width, motion and keyboard acceptance remain Akshay's; no model calls, push or deployment are part of this correction.

No paid application model calls were made for this checkpoint. Latest read-only allowance was $1.851011 of $2, leaving about $0.149; admission was 19/20 for the UTC day. Caps remain unchanged. Open the existing local demo and follow the updated LOCAL-DEMO.md checklist. Keep this checkpoint local until Akshay accepts it and approves subsequent work.

- Static checks PASS: existing white/blue/Barlow direction retained; customer conversation is the primary area, with the narrower business inbox beside it and operator evidence below. No new visual assets or invented performance claims.
- Source checks PASS: controls have real handlers and meaningful disabled states; forms have labels, status/error announcements and bounded input. Layout uses responsive columns with shrinkable content. Build and type checks pass.
- Manual checks PENDING: actual keyboard behavior, mobile overflow, visual contrast in all states, focus behavior and click-through. Akshay explicitly owns this pass; no browser result is claimed.

Reference: orchestration follows the [official SDK manager/tools pattern](https://developers.openai.com/api/docs/guides/agents/orchestration). Budget rates were checked against [the official Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna); the ledger deliberately uses conservative bounds rather than claiming invoice accuracy.
