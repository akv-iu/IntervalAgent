# IntervalAgent V2 rebuild: plan for review

Status: Akshay accepted the Phase 1 flow and Phase 2A Daylight checkpoint for continuation on October 23, 2026, after manually confirming that the app works with the replacement API key. He authorized pushing the completed checkpoint to `v2-rebuild`; production V1 stays on `main`. Phase 2A includes the attention handoff, opening outreach and latest-run box, not the rest of Phase 2. The local $2 API ceiling is removed for local testing; accounting and per-run/workspace limits remain. Phase 2B is the next bounded checkpoint, subject to the existing usage-report-and-approval rule. See [STATUS.md](STATUS.md) and [LOCAL-DEMO.md](LOCAL-DEMO.md).
Date: October 23, 2026. Branch: `v2-rebuild`, based on V1 commit `7a6c6c8`.
Acceptance requirements: [SPEC.md](SPEC.md). The original root `SPEC.md` remains the V1 contract.

## Intended result

An independent, medium-scope multi-agent collections project: a collection operator selects a business and client, plays the client in a natural conversation, observes specialist work, and intervenes or corrects it. A separate business contact can supply fresh payment information through a business-facing inbox. Four model-backed agents adapt their work to evidence, support simulated operations, and improve through evaluated, reversible instruction and routing changes. Akshay is no longer preparing this for an Interval AI presentation; that company does not determine the product's branding or acceptance criteria. The agreed scope still does not require a commercial launch.

Use the same six synthetic scenario families for each of two businesses: twelve selectable client instances with business-specific facts/policies. Situations initialize facts, not dialogue scripts. No spreadsheet import is required. Preserve V1's evals, recordings, reporting, correction behavior and learned timing/channel/tone picker. Depth comes from varied evidence and decisions, not infrastructure size.

## The factory boundary

```text
Operator dashboard / customer conversation / business inbox
                    |
Four-agent runtime + versioned business configuration
                    |
Validated domain tools + business-scoped source adapter
                    |
Synthetic records now; mapped database/API sources later
```

The reusable unit is a configured business-agent runtime. Separate its own storage (conversations, feedback, runs and decisions) from a business's source data. Switching the source must not discard case history.

Simulated operations live in an application ledger. Tools reconcile source snapshots with committed local operations, keeping their provenance distinct and preventing double counting. Recognizing an existing payment is separate from initiating a new simulated payment: match the receipt to the obligation and check whether the snapshot already includes it. Business confirmation supports an evidence proposal, not a new charge. A successful local simulation does not assert that an external business database was updated.

A business profile supplies identity/branding, tone/contact preferences, policies, capabilities, adapter selection and applicable lesson versions. Tools return normalized evidence with scope, source references, versions and freshness; missing, unavailable and conflicting results remain explicit.

Use versioned synthetic balances, invoices, payments and policies with a visible balance-as-of time. Connor's spreadsheet example explains stale business information; it is not an import feature request. Business Verification supplies fresh simulated evidence when accessible records are insufficient.

"Plug into any DB" means additional sources can implement this contract. Changing a connection URL cannot interpret an unknown schema. Initially build a synthetic adapter and one PostgreSQL mapping over a second synthetic source shape in a dedicated test database. Prove both work without changing agent definitions. Do not build universal schema discovery, arbitrary endpoint registration or a connector marketplace. Credentials and SQL remain behind application tools.

## Four agents and meaningful boundaries

These roles replace the earlier Investigator/Payment split. A simple lookup or row insertion is a tool call, not justification for another model-backed agent. Separate communication channels, authority, context and testable decisions. Application code saves raw messages without a model call.

| Agent | Owns and can do | Cannot do / reason for separation |
| --- | --- | --- |
| Customer / Case Orchestrator | Own the customer conversation, ask clarifying questions, perform simple scoped reads, and delegate work. Retain overall case context and explain reviewed outcomes. | Cannot impersonate the business, verify its own customer claim, approve exceptions or directly change financial records. Keeps one customer-facing voice. |
| Business Verification | Own a separate business-facing verification request: compose the relevant query, interpret the authorized contact's reply in context, request missing payment facts, and return a linked evidence packet. | Cannot publish customer replies or change a balance. A vague "yes" cannot supply missing terms; a scoped confirmation can establish them. Needs a business-only channel/context and may wait across separate runs for an external party. |
| Account Resolution | Interpret commitments, extension/contact requests and changed intent against current facts/policy; reconcile conflicting evidence; propose typed case updates, options and actions. | Cannot contact either party, approve itself, execute arbitrary SQL or bypass validation. Guarded tools write reviewed proposals. Its value is interpretation/reconciliation, not row insertion. |
| Reviewer | Challenge evidence, request completeness, matching, proposed actions and outward-facing financial claims. Return targeted revisions and diagnose operator corrections for evaluated improvement. | Cannot provide missing business confirmation, execute effects, grant human authority or activate its own lessons. Has a checking objective and constrained permissions distinct from the proposer. |

Use the OpenAI Agents SDK for TypeScript with agents as tools. The orchestrator owns the customer-facing reply; specialists return typed findings or pending work. The application enforces permissions, financial invariants, review requirements and limits. Reviewer checks substantive financial claims to either party; material edits or new evidence invalidate prior acceptance. No turn must invoke every role. A case with a fresh, sufficient record can use a direct read; external verification and complex reconciliation justify specialist work.

### What a handoff means here

A responsibility handoff passes the minimum relevant context, task/request ID, evidence references, unresolved question and return condition to the agent that owns that work. It is not necessarily an SDK conversation takeover: Business Verification never becomes the customer's speaker. Its initial request can return `awaiting_business`; the application persists it and ends the active run. A correlated business reply starts/resumes the responsible work, then returns evidence to the orchestrator. No model process stays running while waiting and no model polling is needed.

These boundaries must be enforced by tool/channel access and tested behavior, not only by different names or prompts. Demonstrate that the business agent asks for missing facts, the resolution agent detects a mismatched invoice/amount, and the Reviewer blocks an unsupported conclusion. Report any role that adds cost without a distinct decision rather than forcing calls to justify a count.

## Reference investigation: synthetic snapshot -> business verification -> resolution

1. The selected synthetic client has a dated balance snapshot. The operator starts the client's simulated outreach from that context.
2. The customer claims a later payment. The orchestrator asks for the invoice number before a new business request, retaining the payment claim while clarifying amount/date/method as needed. A displayed invoice is not a customer answer. An already recorded matching payment can be answered directly. Missing records do not prove nonpayment; a customer reference alone does not prove settlement.
3. If fresh authoritative information is missing, the orchestrator delegates a scoped request to Business Verification. That agent posts a notification/message in the relevant business inbox. The case is visibly awaiting verification; routine collection demands for the contested amount are paused while waiting, without silently resolving or globally suppressing the case.
4. An authorized business contact replies. A short "yes" can confirm an unambiguous request stating amount, date, invoice and receipt status; do not demand repeated fields. A clear amount assertion with unknown date/settlement can be saved as `business_reported`: attribute it to the business and offer an in-app dispute, without another settlement questionnaire. It does not authorize a receipt or balance reduction. Ask targeted follow-up only when the account/amount itself is unclear. A vague answer cannot establish missing facts. References are optional. Support no matching payment, pending, conflicting evidence and no response; none implies nonpayment or future arrival.
5. Business Verification returns the reply, responder identity, request/evidence IDs, payment facts, timestamps and remaining uncertainty. Label business-confirmed evidence separately from bank/provider settlement verification.
6. Account Resolution checks the evidence against the correct debt and current state, using tools for calculations. It returns a supported proposal or a specific unresolved issue to the orchestrator. Reviewer checks the proposal and communication; business confirmation alone cannot authorize an unrelated credit or payment write.
7. The orchestrator delivers the reviewed next step or requests the operator's judgment with a complete evidence packet. A customer's subsequent dispute of a business report pauses automatic replies until explicit operator resume; additional messages remain saved without model calls. The earlier payment claim alone is not a dispute of a later report. A verified partial payment does not close the entire debt. Late/duplicate replies are retained but cannot blindly overwrite newer facts or publish after STOP/takeover.

The demo has a business inbox and response form. A tester can play operator and business contact only within their own workspace; code enforces request linkage, scope and permitted simulated actor. Notifications are in-app, not external messages. Evaluate overdue/expiry on application activity; any follow-up requires an explicit bounded in-app action. There are no automatic reminders. An unanswered or rejected request remains unresolved and is not marked paid. Reviewer can inspect failures throughout; a data correction and reusable lesson are separate things.

## Guarded updates and planned contact events

Account Resolution proposes allowlisted case fields from substantive conversation changes. Reviewer checks evidence/policy; code validates scope, types, cents, dates and current revision, then saves the accepted case update, its customer confirmation and before/after audit together, linked to source and review. Raw incoming messages save independently. Financial operations retain their own durable receipt before any success claim. After interruption, display saved state/receipts and retry by stable IDs; never replay effects just to regenerate a reply. Stale work cannot publish a confirmation after its update was rejected.

Clear commitments/preferences and extension requests update automatically after review/validation. Policy-compliant customer-confirmed payments/arrangements can proceed through validated code; uncertain evidence, credits/financial adjustments, exceptions and policy overrides need operator approval. Business confirmation alone is evidence, not authority for an unrelated write.

Recording an existing payment requires a reviewed match and explicit business recognition policy; otherwise an operator approves it. Preserve evidence provenance and apply only the amount not already reflected in the balance. A customer claiming an old payment does not consent to a new payment.

Keep promised partial/full payment separate from received payment, extension requested from approved, and contact requested from performed. "I'll pay $50 Friday and need more time" records a promise and extension request; it does not reduce the balance or approve the extension.

An extension can be approved automatically only if an explicit business policy permits that exact change and the required customer confirmation is present; otherwise record the request for operator decision. The agent cannot invent the approval rule.

Call/email/tomorrow requests record channel preference and a planned date/window linked to the message. Resolve relative dates against the displayed case clock and client timezone; clarify ambiguity/missing details. Changed preferences supersede events, and STOP blocks contact. Planned/superseded/blocked are visible states, never proof of execution. No scheduler, cron, future agent invocation or actual call/email is included. An event date does not extend workspace lifetime; show if it falls beyond expiry.

Keep two clocks explicit: interactive case time uses current server time displayed in the client's timezone; initialize synthetic snapshot/payment dates relative to workspace creation. Offline replay can pin a separate scenario clock. Expiry, admission, spending and audit timestamps always use real server time. Fixture/replay dates cannot extend access or replenish allowances.

## Persistent, restricted demo and hosting target

- Use a database-backed private workspace with copies of the synthetic cases. Refresh/reopening with the same valid browser session restores messages, updates, business replies, planned events and sandbox feedback. Anonymous cross-device recovery is not promised.
- Starting review defaults: fixed 24-hour lifetime and 10 accepted customer turns per case. Duplicate retries do not count twice. STOP/history reads remain available at the cap without a model call. Also enforce server limits on business replies, evaluations, workspace/reset admission and nested calls; choose exact additional counts and shared API cap before live use.
- Reset affects only that tester and does not replenish abuse/spending allowances. It invalidates the old workspace generation so in-flight runs/replies cannot repopulate reset data. Check expiry before access/mutation; late replies cannot revive an expired workspace. Cleanup is bounded on activity or an explicit maintenance action, not a timed worker. Show expiry/reset outcomes explicitly.
- Sandbox operator/business-contact permissions do not grant maintainer rights. Tester lessons and activations stay private. Only the maintainer can deliberately promote evaluated shared versions. Shared fixtures, V1 evidence and curated artifacts remain separate from expiring demo data.
- Optional hosting target: Vercel Hobby plus Neon Free within quotas, excluding model charges. Save state in PostgreSQL, not function memory/disk. Execute bounded request-driven runs, end while awaiting business, and resume only on a new authorized action. Use persisted continuations if a workflow cannot fit an active-request limit. No dedicated worker, external queue or scheduler is required.
- Target infrastructure cost is $0/month within free quotas, not unlimited capacity. Handle quota exhaustion/cold starts and shared account allowances. Any later deployment needs explicit authorization and separate V2 configuration/database; V1 remains frozen.

## Execution agreement

- Work locally on `v2-rebuild`. No push, merge, deployment, production configuration change or production DB write without fresh explicit authorization. Preserve the old V2 work.
- Before each implementation phase, report fresh account usage/reset metadata or unknown, explain the bounded change, and wait for Akshay's approval. API spending needs a separate approved limit before calls.
- Surface material changes in behavior or architecture; do not silently expand scope. These phases are review boundaries, not permission to complete everything unattended.
- Test the changed behavior and perform two labeled self-review/fix passes. Run applicable regressions, including the preserved V1 replay gate. Browser testing belongs to Akshay unless delegated for that pass.
- Provide a ready URL, concise checks and expected results. Distinguish mocks, API checks, real model proof and browser acceptance. Required live proof remains pending until authorized and performed.

## Phase 1: conversational investigation

> **Result:** A persistent conversation verifies a payment claim and records supported commitments/contact requests.\
> **Work:** Connect the four roles, synthetic tools, saved isolated workspace, business inbox and guarded case/event updates.\
> **Check:** Demonstrate useful follow-up/resumption, refresh persistence and correct planned-versus-paid state.

- Start with one business and a small subset of cases; the completion target remains two businesses/twelve clients. Exercise all four roles across meaningful tasks and include a fresh-record case that does not unnecessarily contact the business.
- First checkpoint: with an approved API cap, run a minimal local model-backed exchange using synthetic tools before building the full persistence/UI slice. Prove direct reads, a missing-facts business follow-up, resolution and an unsupported conclusion caught by review. If delegation is ineffective or too costly, revise that behavior with Akshay before expanding infrastructure. This checkpoint is not completion of Phase 1.
- Reuse V1 presentation and relevant guards. Its blanket dispute-to-handoff behavior must not short-circuit the new path; STOP/contact safeguards and the original V1 eval path remain intact.
- Keep V1's shared lessons and payment-plan fallbacks out of V2 unless explicitly mapped and tested against the new case state. Exhausted review/revision attempts leave a visible blocked/needs-review result with a factual acknowledgement; never publish an unreviewed financial claim or resume contested demands as a fallback.
- Introduce only the contracts, synthetic adapter and durable workspace/case/request context needed for the slice. Show both threads, activity, provenance and usage. Pending business work survives the active run. Enforce isolation, expiry, turn caps and spending controls from this first slice.
- Record reviewed promises, extension requests, preferences and planned events. Under the explicit synthetic business recognition policy, Account Resolution can propose recording an existing business-confirmed payment. Code validates evidence, amount/date, account, policy, duplication and current revision, then commits receipt/balance/audit/reply together after review. Partial confirmation reduces only that amount. Payment dates at/before the snapshot, possible duplicates, overpayments or operator-required proposals cannot auto-apply. New payments, arrangements and other operations remain Phase 3. There is no scheduled execution.
- Keep specialist selection with the orchestrator model. Supply scoped source/context, execution status and local dates directly instead of requiring repeated context-read model calls. Distinguish an unrequested/blocked check from a failed check or a business response. Completed specialists cannot be repeatedly invoked within one review pass; explicit Reviewer feedback can justify one final bounded revision of the affected role. Required review and write guards remain enforced. Show the active agent and actual timestamped model-step starts/completions with elapsed waiting time; do not stream unreviewed financial conclusions. Polling saved state makes no model calls.
- Test changed follow-up information, incomplete business confirmation, wrong account/invoice, missing/conflicting evidence, no response and duplicate/late replies. Declare new validation examples before prompt tuning; keep expectations outside runtime context.

Requirements: FR-02, FR-04 through FR-08, FR-15, FR-17 through FR-22; NFR-01 through NFR-13.

Done when: real traces demonstrate invoice clarification, contextual business confirmation, an attributed business amount report with dispute/operator hold, complete partial-payment recognition and the direct-read alternative; reviewed updates/receipts/events survive refresh with accurate simulated balances and planned-contact state. Live progress is observable before publication. Unsupported confirmation, duplicate effects and stale writes are blocked. Report observed calls/latency; isolation, expiry/caps, role restrictions and V1 regressions pass.
Review with Akshay: both threads, saved status/events/receipts, resumption, review evidence, latency and usage. No external delivery, new charge execution or reusable lesson activation yet.

## Phase 2: operator dashboard and business/source adaptation

> **Result:** The operator manages two businesses and twelve clients while each business sees its own verification inbox.\
> **Work:** Add scoped selection/history, dashboard commitments/events, operator corrections and the second source adapter.\
> **Check:** Switch business/source/tester without mixing facts, changing agents or permitting shared-state edits.

- Build operator -> business -> client -> conversation around Phase 1, plus the business-contact inbox. Business verification is not the same authority as collection-operator approval. Keep internal activity separate from both outward threads and reuse useful V1 reporting.
- Phase 2A UI checkpoint: Daylight workspace is implemented and accepted for continuation, with the approved attention cue and compact runtime box. Seed synthetic opening outreach once per fresh case; returning to a case restores its history. Move a single attention cue to the surface needing the tester's input: customer, business inbox or operator. Use a brief transfer animation and a persistent soft highlight with a role/status label, rather than a caution banner or endless flashing. Respect reduced motion and retain keyboard control. Browser/manual testing remains Akshay's. The other theme previews are not shipped options.
- Phase 2B checkpoint: implement the two-business/twelve-client selection and dashboard of saved case status, promises, extension requests and planned contact events. Preserve existing workspace histories and model-led delegation. Verify business/workspace isolation and refresh persistence, then stop for Akshay's manual test. The second source adapter and richer operator corrections remain subsequent bounded checkpoints within this phase.
- Manual-feedback refinement: V2 uses the full page width without the extra outer card; V1 retains its existing layout. Incoming customer-chat messages use the business name, with customer messages aligned separately. Untouched empty legacy cases get their initial outreach automatically under a row lock; preserve conversations and stopped/held/active cases rather than requiring a reset.
- Put runtime activity in a small expandable box beside the case status. Show active role/progress during a run, then retain its final duration, call count and bounded steps until the next accepted customer/business message starts a new run. An explicit retry also replaces the displayed run. Rejected submissions and actions that start no run do not erase it. This latest-run display is separate from durable audit history; replacing it never deletes saved evidence.
- Cover late payment, partial/unallocated payment, conflicting reference, cancellation/renewal overlap, affordability/options negotiation, and pending/failed operations as starting conditions. Businesses differ in policies and records; conversations can cross those categories.
- Persist case/evidence/decision history with the existing stack. Add the access checks required for operator operations, not an elaborate administration product.
- Support investigation, verification, correction/retry, takeover and resume. Show partial/full promises, extension requested/approved, preferred channel/date/window and awaiting-business/answered/overdue requests. Follow-up is explicit, not a scheduled agent.
- Test separate workspace histories, reset/expiry and exhausted-turn behavior. Switching simulated actors cannot grant maintainer rights or another tester's records.
- Add the PostgreSQL adapter over a different synthetic source schema in an isolated test database. Run shared adapter checks and the same investigation through both adapters; no production connection.

Requirements: FR-01 through FR-03, FR-06 through FR-08, FR-10, FR-15, FR-17 through FR-22; applicable NFRs remain enforced.

Done when: all twelve clients are selectable, dashboard state matches saved work, histories restore after refresh, limits hold, and a source swap needs no agent changes.
Review with Akshay: selection, inboxes, promises/extension/contact events, takeover/corrections, expiry/reset and factory evidence.

## Phase 3: simulated operations and supervision

> **Result:** A client chooses an eligible option and follows its actual simulated payment/resolution outcome.\
> **Work:** Add current-proposal confirmation, validated writes, operation states and agent assessment of outcomes.\
> **Check:** Prove correct amounts, no duplicate effects and truthful handling of failed, pending or uncertain results.

- Retrieve business-eligible payment methods/arrangements through tools; calculate amounts and schedules in code. The model explains and adapts the proposal.
- Bind confirmation to a specific current proposal. Recheck consent, scope, policy, record versions and required authority before execution. Customer consent, Reviewer acceptance and operator approval are distinct.
- Use transactional writes to an isolated simulated ledger. Distinguish recognition of an existing payment from a new simulated payment; test receipts already included in the snapshot and partial allocations so neither is applied twice. Pending is not recovered money. Repeated clicks/retries cannot duplicate effects, and a timeout does not establish failure. Unsupported source write capabilities stay disabled.
- Feed operation outcomes to Account Resolution and Reviewer; avoid continuous model polling. An unresolved payment claim needs evidence and business verification, not a Pay button to declare it settled. Business acknowledgement is evidence; financial mutation still requires the configured authority and current-record checks.
- Encode the agreed authority split: reviewed clear case updates and policy-compliant customer-confirmed payments/arrangements proceed through validated code; uncertain evidence, credits/adjustments, exceptions and overrides require operator approval. Keep case-recording and financial-effect tools separate. Corrections after effects need traceable authorized compensating actions.

Requirements: FR-07 through FR-10, FR-15, FR-17 through FR-19, FR-21, FR-22; NFR-02 through NFR-05, NFR-08, NFR-10 through NFR-13.

Done when: a successful operation updates the simulated account once; stale confirmations fail; failed/pending/unknown results remain accurate; chat and reports agree with committed state.
Review with Akshay: options, consent, outcomes, operator exceptions and before/after records.
Optional later: introduce a new synthetic payment mid-conversation to demonstrate reassessment. This is not a completion dependency.

## Phase 4: evaluated agent and orchestration improvement

> **Result:** Operator corrections and Reviewer findings can improve future behavior with evidence and rollback.\
> **Work:** Add scoped candidates, matched baseline comparison, regressions, manual activation and version history.\
> **Check:** Repeat the loop across different failures and preserve rejected candidates alongside qualifying changes.

- Extend V1 correction/retry concepts to role/business/situation scope and instruction/routing versions. Immediate case correction is separate from changing future behavior.
- Reviewer diagnoses data, reasoning, routing, tool or review failures and proposes candidates, including missed business follow-up, wrong-case matching or premature settlement claims. It cannot independently certify or activate them.
- Compare current and candidate behavior on separate validation cases with declared criteria/budgets. Use deterministic checks and human assessment; keep final holdout answers out of tuning.
- Support investigation, delegation, clarification, escalation and review improvements. Lessons cannot relax permissions, financial guards or spend limits.
- A sandbox operator activates eligible versions only in that workspace. Shared promotion needs separate maintainer authorization and evaluation. Pin versions, retain evidence and support rollback; change subsequent work, not in-flight financial operations. Expiry/reset does not delete curated shared artifacts or restore spending allowance.

Requirements: FR-10 through FR-13, FR-16, FR-18, FR-22; NFR-02, NFR-04, NFR-06 through NFR-08, NFR-10 through NFR-13.

Done when: multiple candidate cycles work across at least two role/situation contexts; an unsafe candidate is rejected; activation affects subsequent behavior; rollback restores the prior version. Report improvement only when the comparison supports it.
Review with Akshay: correction -> candidate -> evaluation -> decision -> next-case behavior -> rollback. No weight training or autonomous code rewriting.

## Phase 5: evals, outreach learning, reporting and demonstration

> **Result:** A reproducible demonstration supports evidence-backed claims about this independent multi-agent project.\
> **Work:** Complete multi-agent evaluation/reporting, preserve V1's picker/evals, and document the operator/business journey.\
> **Check:** Replay selected real traces and reconcile quality, simulated outcomes, resource usage and limitations.

- Preserve V1's timing/channel/tone picker and pinned eval results. Show the selected outreach strategy; evaluate any business-specific extension separately rather than relabeling old scores as V2 gains.
- Complete checks for changing intent, synthetic-record freshness, incomplete business replies, resumption, promise-versus-receipt and requested-versus-approved state, planned-versus-executed contact, scope/expiry/reset, STOP at the turn cap, duplicates and learning regressions.
- Report sample sizes, denominators, failures/unknowns, delegation/correction/handoff outcomes, settled simulated receipts, model calls/tokens and latency. Separate synthetic/mock/live/replay provenance.
- Pin selected budget-approved real traces with model/config/tool/lesson versions; replay with no model/DB fallback. Keep final holdout scoring separate from development and candidate selection.
- Provide local setup, an architecture diagram, evaluation commands, a short walkthrough and limitations. Run final targeted checks and Akshay's browser acceptance; no public launch is required.
- Check bounded requests/resumption against the optional free hosting target and document quotas/cold starts. No scheduler/worker or deployment is implied.

Requirements: FR-14 through FR-22; NFR-01, NFR-04, NFR-06 through NFR-13.

Done when: the operator demonstrates varied conversations, human review, simulated operations and evaluated improvement; the same four agents serve both businesses; V1 gates and new reports are reproducible.
Review with Akshay: final walkthrough, evidence-backed resume claims and stopping point. Do not claim real collection lift or superiority over one agent without supporting comparison.

## Decisions for Akshay's review

- Review business names, six scenario families, payment methods and policy thresholds. Four roles, business verification and automatic reviewed case updates versus human-approved exceptions are agreed.
- Initial model/API budget and nested-call, token, retry and deadline limits before Phase 1 live verification.
- Review verification fields, request expiry/manual-follow-up rules and PostgreSQL test-source mapping. No spreadsheet endpoint is required. Real source connections/external notifications are not authorized.
- Review the starting 24-hour/10-turn defaults, remaining admission/reply/eval limits and shared API cap before live use. Anonymous recovery requires the valid browser session.
- Receipts stay structured synthetic evidence. Upload/OCR and real provider verification remain optional; business inbox, case/event recording and tester isolation are required.
- Re-estimate effort after Phase 1 integration/model behavior is observed; no fixed delivery date is promised.

## Stopping boundary

Finish these five demonstrated capabilities. Defer spreadsheet imports/exports, real messages/payments, timed execution/reminders, universal schema detection, connector marketplaces, automatic shared lesson promotion, model fine-tuning, cloud worker fleets, large benchmarks and public deployment. Reuse within billing/recovery is the factory claim; unrelated industries may need new tools/evals.

## Hosting references

Checked October 23, 2026: [Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal non-commercial use; [Hobby Node.js functions](https://vercel.com/docs/functions/limitations) currently allow up to 300 seconds. [Neon Free](https://neon.com/pricing) currently includes 1 GB storage and 100 CU-hours/month per project, with [scale to zero](https://neon.com/docs/introduction/scale-to-zero). These are provider limits, not measured app capacity. Recheck account/plan availability before any approved deployment; API charges are separate.
