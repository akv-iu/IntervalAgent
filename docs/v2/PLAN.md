# IntervalAgent V2 rebuild: plan for review

Status: Phases 3 and 4 are implemented and verified on `v2-rebuild`; production V1 stays on `main`. Akshay approved completing both without another approval pause and delegated testing, with a separate $2 total live-test budget. Delivery includes supervised financial corrections and scoped, evaluated instruction improvement with explicit activation/rollback. Phase 5A offline saved-output replay/reporting is now delivered; the rest of Phase 5 remains pending. See [STATUS.md](STATUS.md) for evidence and limits and [LOCAL-DEMO.md](LOCAL-DEMO.md) for the walkthrough.
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
- Phase 2B checkpoint (implemented and pushed; remaining manual checks stay with Akshay): two-business/twelve-client selection and a dashboard of saved case status, promises, extension requests and planned contact events. Northside Fitness and Cedar Home Services have six factual starting situations each. Cedar's existing-payment recognition policy requires operator approval; that approval control is not implemented here, so complete confirmation cannot automatically reduce its balance. Existing workspaces gain missing cases using their original creation clock, preserving saved histories, allowances and expiry. The same four agents consume the selected case facts; labels do not select a scripted dialogue. Case corrections and the second source adapter are covered in Phases 2C and 2D below.
- Phase 2C checkpoint (pushed as `6138a32`; delegated core browser pass completed): save feedback for a named role against this case's latest reviewed attempt, capturing its original result and revision. Saving pauses automatic replies without a model call. A separate **Retry with correction and resume** action explicitly resumes and starts one bounded reviewed attempt; changed evidence/revision, STOP, reset or expiry makes stale work ineligible. Preserve original/revised outcomes and linked audit; append an accepted customer revision without overwriting the prior reply, and retain rejected drafts privately. Feedback is supplied to the orchestrator, any model-selected specialists and Reviewer as a proposed correction, not evidence or policy. No payment recognition/replay or reversal is allowed in correction retries; supported non-financial proposals still need their actual customer source and review. Maximum six saved corrections per case, sharing the existing six-retry allowance. The paused banner describes automatic replies accurately. Evaluated lesson activation remains Phase 4. The delegated core browser pass is recorded in STATUS.md; broader manual coverage remains incomplete.
- Manual-feedback refinement: V2 uses the full page width without the extra outer card; V1 retains its existing layout. Incoming customer-chat messages use the business name, with customer messages aligned separately. Untouched empty legacy cases get their initial outreach automatically under a row lock; preserve conversations and stopped/held/active cases rather than requiring a reset.
- Put runtime activity in a small expandable box beside the case status. Show active role/progress during a run, then retain its final duration, call count and bounded steps until the next accepted customer/business message starts a new run. An explicit retry also replaces the displayed run. Rejected submissions and actions that start no run do not erase it. This latest-run display is separate from durable audit history; replacing it never deletes saved evidence.
- Cover late payment, partial/unallocated payment, conflicting reference, cancellation/renewal overlap, affordability/options negotiation, and pending/failed operations as starting conditions. Businesses differ in policies and records; conversations can cross those categories.
- Persist case/evidence/decision history with the existing stack. Add the access checks required for operator operations, not an elaborate administration product.
- Support investigation, verification, correction/retry, takeover and resume. Show partial/full promises, extension requested/approved, preferred channel/date/window and awaiting-business/answered/overdue requests. Follow-up is explicit, not a scheduled agent.
- Test separate workspace histories, reset/expiry and exhausted-turn behavior. Switching simulated actors cannot grant maintainer rights or another tester's records.
- Add the PostgreSQL adapter over a different synthetic source schema in an isolated test database. Run shared adapter checks and the same investigation through both adapters; no production connection.
- Phase 2D checkpoint (pushed as `5d20fab`): a read-only PostgreSQL adapter maps separate organization/account/payment tables in `intervalagent_v2_test` to the same contract as the fixtures. Shared checks and direct-read/business-verification journeys exercise both sources through the same SDK entry point with identical role definitions and scripted model responses. Scope, money, dates/versions, explicit missing/failure outcomes and safe errors are validated before model calls. A changed snapshot that conflicts with locally committed receipt evidence is blocked for reconciliation rather than silently replacing it. The app keeps its saved synthetic source; no source-selection UI, real business connection, paid model call or deployment was added.

Requirements: FR-01 through FR-03, FR-06 through FR-08, FR-10, FR-15, FR-17 through FR-22; applicable NFRs remain enforced.

Done when: all twelve clients are selectable, dashboard state matches saved work, histories restore after refresh, limits hold, and a source swap needs no agent changes.
Review with Akshay: selection, inboxes, promises/extension/contact events, takeover/corrections, expiry/reset and factory evidence.

## Phase 3: simulated operations and supervision

> **Result:** A client chooses an eligible option and follows its actual simulated payment/resolution outcome.\
> **Work:** Add current-proposal confirmation, validated writes, operation states and agent assessment of outcomes.\
> **Check:** Prove correct amounts, no duplicate effects and truthful handling of failed, pending or uncertain results.

### Phase 3A checkpoint: eligible options and reviewed proposals

> **Result:** Customers can discuss each business's eligible methods and receive a concrete saved offer.\
> **Work:** Add versioned synthetic policies, model-selected option/calculation tools and reviewed proposal records.\
> **Check:** Preserve cents/dates, reject unsupported or stale terms, and keep offers distinct from agreements and receipts.

Implemented locally, stopped for Akshay's manual test. Business policy and today/tomorrow are supplied upfront, so a simple options question can stay with the orchestrator without redundant reads. Account Resolution chooses the calculation tool for a concrete offer and Reviewer checks it. Scripted SDK paths verify two calls for direct options and five for an accepted proposal; live counts can vary. Runtime groups events by call, shows requested tools and retains the initial dispatch for new bounded runs; legacy truncation is labelled. Northside permits card/bank transfer/cash and 1/2/3 monthly payments, starting within 30 days; Cedar permits card/bank transfer and 1/2/3/4/6 payments, starting within 45 days. These are explicit synthetic defaults, not real business terms. Full remaining balance only, with zero added fees/interest. Clarify method/count/first date; unsupported requests need alternatives or operator review. Calculate dates in code using the original day of month, clamped at month-end, and split cents without rounding loss.

Save a `payment_proposed` update atomically with the accepted reply and audit, bound to customer evidence, policy/source versions, invoice, balance and exact schedule. Revalidate before commit. Preserve prior offers and label superseded/outdated terms in the existing records view; labels refer to the saved case clock. Do not mix recognition and a new offer in one result. No agreement, customer confirmation action, new payment, receipt, balance reduction or external source write occurs. Existing workspaces require no reset/migration.

Phase 3A stopped at unagreed offers. Phase 3B below adds explicit consent and simulated execution; supervised financial approvals remain a subsequent checkpoint.

### Phase 3B checkpoint: consent and simulated outcomes

> **Result:** The customer confirms exact reviewed terms, then explicitly simulates the next due installment.\
> **Work:** Add scoped confirmation/payment controls, atomic outcomes/receipts and model-led explanation of saved evidence.\
> **Check:** Block stale/duplicate/held/future actions and preserve effects through model failure, rejection and retries.

Implemented and tested, including Akshay's delegated browser sample recorded in STATUS.md; authorized for push to `v2-rebuild`. `confirm_plan` binds the current case revision and latest exact reviewed proposal to a saved agreement/audit. Chat yes alone has no financial authority. `simulate_payment` uses that case's latest agreement and computes the next due installment on the server. Only card/bank-transfer simulation is enabled; cash receipt approval is not implemented. Future installments stay recorded, with no scheduler or automatic charge. Refresh reads include server observation time for due-date controls; the server rechecks actual time and policy under lock.

A labelled demo-processor control selects succeeded/failed/pending/unknown synthetic responses; it is test configuration, not bank evidence or a model decision. Succeeded commits one simulated receipt, balance/version change and operation record atomically. Other outcomes receive no receipt or balance reduction. Pending/unknown blocks new confirmations/attempts until later operator reconciliation; Resume cannot bypass that guard. Known failure permits a new explicit attempt; duplicate command IDs never replay. Existing pending payments and unresolved business evidence block starting another payment plan.

Consent/outcome commits before the model explains it. Failed/rejected/stale explanations cannot undo the operation or trigger a second one. Agents receive saved agreements/operations and choose useful assessment work; Reviewer still checks the reply, and assessment cannot propose another payment/recognition. Application validation controls effects. Per case: at most six confirmed plans and twelve attempts within existing 60-action limits and fixed expiry; controls do not consume chat turns. Policy versions advance to `*-options-2`, invalidating old offers; request a fresh quote without resetting the workspace.

### Phase 3C checkpoint: operator financial decisions

> **Result:** An operator can record a verified prior payment or resolve a pending/unknown simulated attempt without losing original evidence.\
> **Work:** Add separate takeover-only decisions, required evidence notes/references, atomic receipts/balances and saved decision context for agents.\
> **Check:** Refuse stale, foreign, duplicate, unreviewed or stopped actions; preserve committed effects through failed/rejected explanations.

Implemented locally: `approve_recognition` targets the latest accepted review and complete linked business confirmation, including Cedar's operator-required policy. It reuses matching/date/amount/duplicate checks; the operator cannot supply an arbitrary amount, invoice or receipt. New unreviewed messages invalidate approval. `reconcile_payment` targets one saved pending/unknown simulated operation and its unchanged source/balance. The operator records synthetic evidence and settled/not-settled; settlement adds one operator-provenance receipt, while not-settled adds no money and permits only a separate explicit new attempt.

Both actions require takeover, current revision, stable ID, a 10–1200 character note and 1–80 character evidence reference. They consume no chat turn or model call, retain operator control, and append at most twelve decisions within existing action/lifetime limits. Original business evidence/attempts remain unchanged; decisions link their target, evidence, time, receipt and before/after balances/versions. Resume remains a conversation action. Explicit resume/retry supplies original and effective operation state plus decisions to the existing SDK agents; the orchestrator chooses assessment and Reviewer checks the explanation. No financial execution tools are granted.

The approved closeout adds `approve_credit`, `approve_extension`, `reverse_receipt` and `reconcile_record`. Credits require a current accepted review and bounded amount, reduce debt without recording money received, and cannot be repeated against that review. Extensions approve the latest current saved request without rescheduling an agreed payment plan. A local receipt can be reversed once through a compensating decision: retain the receipt, annotate its reversal and restore its amount. Imported settled receipts remain read-only. An imported pending record can be resolved as settled/not-settled; retain its original state with a decision reference, and create a separate receipt only on settlement. Balance changes invalidate old plans/quotes. Every action uses takeover, revision, scope, evidence, duplication and transaction guards; no decision itself calls a model or sends a reply.

This completes the bounded synthetic Phase 3 contract. It is a private role-playing demo, not production operator authentication or bank verification. Cash still requires complete prior-payment evidence. Changed external snapshots fail closed; arbitrary external writes, general policy editing, actual refunds and provider integration are outside this implementation. Synthetic credits and receipt compensation are the supported financial exceptions, not a universal accounting system.



### Phase 3 acceptance contract (across 3A, 3B and 3C)

These bullets describe the delivered phase contract within the synthetic and source-capability boundaries above.

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

Delivered: Reviewer diagnosis uses saved role corrections/rejected findings to propose one bounded reusable instruction. Four declared evaluation focuses cover invoice clarity, contact preferences, verification handoff and payment truthfulness, with supported role/focus combinations. Unsupported changes/data/tool repairs are rejected instead of becoming prompt patches. Independent validation uses two target cases, a regression and a safety case with matched baseline/candidate runs. Correctness must improve (or call count fall) while every candidate check passes; the server recomputes eligibility. A tie, partial run, unsafe result, scripted provenance, obsolete suite/model/base or changed baseline cannot activate. This is instruction/delegation/review improvement through the existing four roles, without model-weight training or self-modifying code.

Learning is private to workspace, business and role, optionally narrowed to scenario family; exact scenario scope takes precedence. Subsequent jobs pin instruction IDs, and audit retains those IDs after rollback. Operator assessment is required for activation, rejection and rollback. Earlier comparison reports remain available after a declared suite upgrade. Rollback restores a valid prior version, otherwise base instructions, and records the actual before/after choice. Workspace reset retains curated learning/history/call accounting, interrupts pending learning and does not extend expiry; nothing is promoted to shared artifacts. Limits: eight candidates, forty learning actions (rollback remains available after exhaustion), sixty-four reserved model calls per workspace, thirty-two calls/ninety seconds per comparison. The ordinary conversation limit remains unchanged.

Live acceptance exercised customer and Reviewer contexts, unsafe-feedback rejection, subsequent job pinning, rollback and business isolation. Current suite `learning-evals-2`: customer baseline 2/4 -> candidate 4/4; Reviewer 2/4 -> 3/4, so that Reviewer candidate stayed inactive. An earlier Reviewer candidate passed 4/4 and changed a controlled review decision before rollback. The original suite/report was retained when an apostrophe-scoring defect was fixed; no failed report was rewritten. Small development suites support these specific claims only, not general improvement or a final holdout score.

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

### Phase 5A checkpoint: saved-output replay and reporting

> **Result:** Selected live development evidence can be checked and reported without keys, database or new model calls.\
> **Work:** Pin both suite-2 role comparisons and an unsafe suggestion, reuse the existing scorer, and report outcomes/usage/latency with explicit provenance.\
> **Check:** Reproduce both gains and the failed Reviewer candidate; fail closed on missing/tampered/incompatible evidence or accounting mismatch, and retain V1's replay gate.

Delivered: `npm run eval:v2:replay` creates Markdown/JSON reports from the checked-in synthetic archive. Its manifest pins hashes, model/role/suite/SDK versions and the closeout configuration reference. The artifact retains instructions, actual outputs, tool requests and individual usage/latency without workspace tokens/credentials. Replay independently rescores outputs and recomputes eligibility; it does not trust archived pass/eligible flags. It has no live/database/mock fallback and does not activate lessons. Eight paired rows across customer/Reviewer contexts and one unsafe suggestion reproduce their recorded outcomes, including the ineligible Reviewer candidate.

This is saved-output replay, not exact provider-request or orchestration replay: those raw requests were never recorded. Scoring context is reconstructed only from the declared fixture and captured comparison date. Selected development evidence is not a final holdout; per-call latency is not total user wait, and known-token accounting is not billing. Missing customer/ledger outcomes stay unavailable rather than inferred from prose. See STATUS.md for counts and self-review evidence.

Stop at this checkpoint. Remaining Phase 5 work includes broader journey coverage, presenting the preserved V1 learned outreach strategy in V2, architecture/final demonstration material and any optional hosting check. No UI change, paid call, production merge/deployment or hosting work is part of 5A.

## Decisions for Akshay's review

- Review business names, six scenario families, payment methods and policy thresholds. Four roles, business verification and automatic reviewed case updates versus human-approved exceptions are agreed.
- Initial model/API budget and nested-call, token, retry and deadline limits before Phase 1 live verification.
- Review verification fields, request expiry/manual-follow-up rules and PostgreSQL test-source mapping. No spreadsheet endpoint is required. Real source connections/external notifications are not authorized.
- Review the 24-hour/10-turn defaults and remaining admission/reply/eval limits before live use; the app-wide dollar cap was explicitly removed for local testing. Anonymous recovery requires the valid browser session.
- Receipts stay structured synthetic evidence. Upload/OCR and real provider verification remain optional; business inbox, case/event recording and tester isolation are required.
- Re-estimate effort after Phase 1 integration/model behavior is observed; no fixed delivery date is promised.

## Stopping boundary

Finish these five demonstrated capabilities. Defer spreadsheet imports/exports, real messages/payments, timed execution/reminders, universal schema detection, connector marketplaces, automatic shared lesson promotion, model fine-tuning, cloud worker fleets, large benchmarks and public deployment. Reuse within billing/recovery is the factory claim; unrelated industries may need new tools/evals.

## Hosting references

Checked October 23, 2026: [Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal non-commercial use; [Hobby Node.js functions](https://vercel.com/docs/functions/limitations) currently allow up to 300 seconds. [Neon Free](https://neon.com/pricing) currently includes 1 GB storage and 100 CU-hours/month per project, with [scale to zero](https://neon.com/docs/introduction/scale-to-zero). These are provider limits, not measured app capacity. Recheck account/plan availability before any approved deployment; API charges are separate.
