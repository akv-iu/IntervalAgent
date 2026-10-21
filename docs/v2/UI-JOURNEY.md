# V2 customer-to-review journey

Status: Phase 15's screen contract is pushed; Phase 16 locally implements slice A (customer chat/status) following Akshay's "move ahead". The selected journey and current visual style are agreed. Later activity/evidence disclosure and operator screens remain proposals. [Product status](STATUS.md), [requirements](SPEC.md), [implementation plan](PLAN.md), [slice A verification](PHASE16-REVIEW.md).

Scope correction: this is a compact resume application with varied case outcomes and repeatable learning cycles. The reference case is an entry point, not a single supported scenario. Lightweight case selection, clarification and repeated lesson/evaluation history stay in scope. Elaborate administration, public hosting and scale testing are deferred; the [portfolio completion boundary](PLAN.md#portfolio-completion-boundary) governs remaining work.

## What the walkthrough should show

A visitor opens an isolated synthetic billing case, disputes an invoice, follows four roles investigating it, and sees a pending resolution. An authenticated operator inspects the evidence and later records a decision. The customer transcript remains separate from internal collaboration throughout.

The reference Northside development case has an $84 invoice, a verified $50 payment and a cancellation eligible for a $20 credit. The proposed remaining balance is $14, pending human approval. Harbor's different policy permits payment allocation without that credit, leaving a proposed $34. These are development-record expectations, not committed effects or measured model results. Source: [development records](../../src/lib/v2/demo-records.ts), [billing guard](../../src/lib/v2/billing.ts).

## Proposed screens and behavior

| View | Main job | Content and actions | Delivery boundary |
| --- | --- | --- | --- |
| Start a synthetic case | Establish which business and account the visitor is acting as | Choose Northside Fitness or Harbor Subscriptions, explain synthetic records, start the reference account's case. Reuse a valid session rather than creating one on every load. | First UI slice; no evaluation dataset selector. |
| Customer case | Submit and follow a dispute | Business/account context, persisted conversation, case status, send message and Stop contact. On desktop, chat takes the main column; case status and, when implemented, pending proposal sit beside it. | Chat/status first; no draft is published as an agent reply merely because a worker finished. |
| Agent activity within the case | Explain who did what and why | Chronological role handoffs, tool outcomes, findings, Reviewer decisions, code-guard outcomes and expandable evidence. A separate section below chat, not additional customer speakers. | Second slice, after safe activity/evidence reads exist. |
| Operator case review | Assess the proposed action against evidence | Scoped case link/selection, existing GitHub sign-in, transcript, evidence, pending proposal and decision history. Proposal is the focal point, with evidence beside it on desktop. | Reusable case review with authorized approve/reject/request-information. Elaborate inbox/admin features deferred. |

Visitor URLs `/v2` and `/v2/cases/{caseId}` are implemented for chat/status. They remain subject to the existing default-off APIs. The proposed operator case URL carries business/workspace/case scope under `/v2/operator/cases/` and is not implemented. No new navbar entry was added. V1 routes and evidence stay available.

On a narrow screen, use one reading order: case identity and status, conversation/composer, pending proposal, activity/evidence. Operator review puts the proposal before its evidence and eventual decision form. No horizontal timeline or mandatory multi-column layout on a phone. This is a functional arrangement for review, not a rendered wireframe.

## Who can inspect what

Recommended visitor disclosure: structured summaries and scoped evidence for that visitor's own case. This preserves V2-FR-06 and V2-FR-24 without exposing prompts or private reasoning.

| Data | Visitor | Authorized operator |
| --- | --- | --- |
| Customer conversation | Own case only; Customer Agent remains the sole model-generated voice | Within business membership |
| Collaboration | Sender, recipient role, task, bounded finding/review summary, tool status, timestamps | Same plus scoped diagnostic and decision history |
| Evidence and proposal | Relevant synthetic record fields/references, proposed amounts and pending status | Relevant account records, policy/version and proposal preconditions |
| Provenance and usage | Explicit mock/model-test/live/replay distinction; observed usage, unknown or unavailable, with test-transport usage labeled synthetic | Same, plus relevant version identifiers; reserved capacity is separate from observed usage |
| Private data | No cookies, tokens, session/worker/actor identifiers, raw prompts, request payloads, hidden evaluation answers or model reasoning | No secrets, hidden answers or private reasoning; do not forward whole storage rows |

Use an explicit server projection with allowlisted fields for every new read. Scope comes from the authenticated visitor session or current operator membership. A reference is not permission to read another account. `model_test` must be described as a test workflow, never as live model evidence. Failed, missing and unavailable tool results remain visible as those states.

Only reviewed, guarded and deliberately published model text belongs in chat. Until publication exists, show fixed system status such as “Investigation finished. Operator review required.” outside the transcript. A reviewed internal draft may appear as a labeled draft in operator review; it is not a sent reply. A code guard is an application check, not a fifth agent.

## State and recovery contract

- Distinguish case state, execution state and financial outcome. `awaiting_human` means waiting for an operator; `succeeded` means the job finished. Neither means an adjustment was applied.
- Before submission: explain the selected synthetic account and show a clear empty state. While loading: preserve context and label the operation. On failure: retain unsent text and show a recovery action. Do not manufacture progress percentages or estimated completion times.
- Submission uses the server's case revision and a stable idempotency key for retries of the same message. A revision conflict reloads state and lets the visitor review their text before another submission. STOP retains its existing priority and suppression behavior.
- Keep the case ID in the case URL so refresh can load it with the existing HttpOnly session. Do not put a session token in a URL or browser storage. Expired/revoked sessions explain that access ended; do not silently replace the workspace and imply old history survived.
- Poll persisted state without overlapping requests, pause when the page is hidden, back off on errors, and respect `Retry-After`. Pagination must not drop or duplicate messages. Use a separate activity cursor: agent checkpoints do not necessarily change the case revision. The current history cursor pages case events, not agent messages.
- In the first slice, show only the case state the API actually exposes. Queued/running/retry details require the later scoped execution projection; a case in `investigating` alone cannot establish whether a worker is active. The UI must not silently start a worker, enable a provider or invent role activity. Missing V2 configuration gives a clear unavailable view without falling back to V1 credentials/data.
- Render record/model/customer text as text. Announce meaningful asynchronous changes without repeatedly reading the full timeline; preserve focus during polling. Use labeled controls, visible focus and at least 44-pixel tap targets. Browser/keyboard acceptance remains required.

## What the current backend can support

| Capability | Current implementation | Work needed before its screen |
| --- | --- | --- |
| Visitor session/case/chat | Session GET/POST/DELETE, case POST/GET, message POST; scoped cookies, revisions and pagination | Client interaction and honest empty/loading/error/expiry states. No new storage schema needed for this chat/status slice. |
| Agent activity/proposal/execution | Durable internal role messages, tool attempts and job results exist | Scoped read projection, bounded pagination, evidence resolution, execution status, explicit provenance and minimal database grants if required. Neither current case GET returns this trace/result. |
| Operator case access | GitHub auth/session plus business-scoped case/facts/history GET | Sign-in UI and case screen. Current OAuth return lands on the session API; a safe fixed post-login UI destination must be designed and tested, not a client-supplied redirect. |
| Operator decisions | No approve/reject/request-information HTTP operation | Typed mutations, lightweight scoped case selection, current authorization, stale-version fences, transactional actions/audit and decision history. |
| Confirmed resolution | No committed V2 ledger changes or customer publication | Simulated actions plus post-commit guard/publication. No approval control until it can perform a real authorized operation. |

Source inspection: [visitor API](../../src/lib/v2/visitor-api.ts), [operator API](../../src/lib/v2/operator-api.ts), [case store](../../src/lib/v2/case-store.ts), [visitor grants](../../db/ops/v2_web_role.sql), [operator setup](OPERATORS.md). Internal snapshot storage is not a safe public API. Do not widen grants to whole run/attempt tables merely to render an activity list.

## Small implementation slices

| Slice | User-visible result | Verification appropriate to that change |
| --- | --- | --- |
| A: customer chat and case status | Create or return to the reference case within the same active session, submit a dispute, refresh history and stop contact. This does not reopen closed cases. The worker can remain mock. | Focused interaction/API-contract tests with simulated HTTP, typecheck/lint/build, two self-review passes; user browser/keyboard check when isolated V2 setup is available. No broad DB rerun for UI-only changes. |
| B: activity, evidence and pending proposal | Follow actual four-role checkpoints and inspect scoped records without mixing them into chat. | Projection/pagination tests plus targeted DB isolation/grant checks for new reads. Flag remote DB checks before starting; full storage regression only for shared storage/security changes. |
| C: operator read-only review | Sign in and open an authorized case with proposal/evidence and honest denial states. | Focused auth-return/rendering tests; real GitHub browser acceptance requires configured isolated setup. No self-enrollment or visitor approval. |
| D: decisions and simulated effects | Approve, reject or request information with a reason across varied cases; show confirmed changes only after commit. | Targeted transaction, concurrent/stale/duplicate decision, clarification/reinvestigation, rollback and authorization DB tests. |

These slices refine Tasks 5-6 within the reduced portfolio acceptance boundary. The lesson demonstration and selected real-model/replay evidence follow that same scope; hosting and launch work are deferred. Before each slice, state its result and checks; after each, stop with evidence and the steps Akshay should test. A fresh full database run is not needed to review this document.

## Confirmed visual direction

Akshay selected "Keep the current style" on October 20, 2026. Carry forward the existing white background, blue accent and Barlow type from [globals.css](../../src/app/globals.css) and [layout.tsx](../../src/app/layout.tsx). This preserves Recovery Lab's identity and gives financial evidence a consistent reading surface. No new asset, logo or theme is proposed.

Slice A uses the confirmed direction: white background, warm ink, Barlow and the existing blue accent for the primary action/focus. Chat is the focal point, status is secondary, borders separate the two jobs, and consistent spacing keeps the reading order clear. Energy 1 / rhythm 1 / motion 1: a calm work surface with no added animation. The existing light theme is retained by user choice. No new brand assets were created. See the [desktop](screenshots/phase16-desktop.jpg) and [mobile](screenshots/phase16-mobile.jpg) screenshots, both using a fake HTTP backend, not real worker/model evidence.

Review points now concern later activity/evidence disclosure and operator views. Slice A browser interactions were checked by the assistant with fake HTTP; Akshay's acceptance with a real isolated V2 database and worker remains open. No hosted activation, paid call or application migration is implied.
