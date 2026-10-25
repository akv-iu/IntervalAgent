# V2 local demo: supervised payments and evaluated learning

Worktree: `D:\Projects\IntervalAgent-v1-rebuild`, branch `v2-rebuild`.
Open **http://127.0.0.1:3012/v2**. Phases 3 and 4 are complete at the bounded demo scope; Phase 5A offline replay/reporting is delivered; remaining Phase 5 work is pending. Akshay delegated this batch's testing. See [STATUS.md](STATUS.md) for exact results, spending and limits.

No migration/reset is needed. Refresh the page to load new controls. Workspaces still expire after their original 24 hours; browser recovery needs the valid session. Reset clears case history, retains private learning/history/call accounting, and does not replenish spending or extend expiry. Financial decision controls make no model calls; conversation, correction retry and learning proposal/comparison use the configured paid API. The app-wide $2 cap remains removed; the separate completed test batch stayed below its $2 guard.

## Phase 5A: offline evidence report

From this worktree run `npm run eval:v2:replay`, then open `results/v2-replay/report.md` (or `report.json` for row evidence/metrics). No server, API key, database, browser test or paid call is required. The command has no live mode. V1 remains separately reproducible with `npm run eval:replay`.

Expect **replay PASS**, customer **2/4 -> 4/4, eligible**, Reviewer **2/4 -> 3/4, ineligible**, and the unsafe suggestion **rejected**. PASS means saved evidence/scoring reproduces; it does not approve the failed candidate. The report includes sample size, per-role/check outcomes, known/unknown token usage, conservative historical accounting, individual-call latency and observed delegation/escalation events. Uncaptured ledger outcomes are explicitly unavailable.

The checked-in archive under `fixtures/v2/learning-20261024-1` contains only selected synthetic live outputs/instructions/usage, with hashes and model/configuration references. Exact provider requests were not captured; this command rechecks saved outputs rather than rerunning orchestration or a model. No lesson or financial record changes. A missing/tampered/incompatible file, malformed output or call-count mismatch fails closed. This is a small development selection, not final holdout or all-client acceptance. No manual/UI testing is needed for this checkpoint.

## Phase 3: financial supervision

1. Select a case and **Take over this case**. For an unresolved simulated Pending/Unknown attempt, inspect **Operator financial decision**, choose settled/not-settled and provide a synthetic evidence reference plus a reason of at least ten characters. Settlement saves one receipt and reduces that amount; not-settled records no money. Original attempts remain unchanged, and takeover stays on.
2. For Cedar prior-payment recognition, obtain a complete linked business confirmation and accepted review. Inspect the packet, then use **Approve existing payment** with evidence. A new unreviewed message, stale source, wrong invoice, incomplete facts, duplicate or invalid date blocks approval. This records prior money; it never charges the customer.
3. Open **Financial corrections and exceptions**. **Approve a credit** requires the latest accepted review/current evidence and positive cents no greater than balance; it records no receipt. **Approve latest extension request** acts only on a current saved request and does not reschedule an existing plan. These controls do not create business policy.
4. **Reverse a local receipt** retains/annotates an unreversed local receipt and restores its amount once; it is not a refund. Imported settled records cannot be reversed. **Reconcile a pending source payment** retains the pending source record with a decision reference; settled creates a separate receipt, not-settled leaves balance unchanged. Balance changes invalidate old plans/quotes, including formerly fully-paid plans.
5. Refresh/reselect and inspect decisions, receipts, original attempts and before/after balances. No financial decision itself sends a reply or uses a chat turn/model call. **Resume automatic replies**, then **Retry from saved evidence**, requests a reviewed explanation without replaying the effect. STOP/stale revision/expiry still blocks new effects.

Delegated browser results: Riley's pending $185 was settled, then its receipt reversed to restore $185; Casey's imported pending $99 was marked not settled with $99 unchanged/no receipt. Both persist after reload and remain under operator control. Existing workspace history was retained. Other financial branches have automated coverage, not a claim of browser testing every branch.

## Phase 4: correction -> candidate -> comparison -> activation

1. Run a ready case through review. Under **Correct this case**, choose a role and save concrete feedback. For example: `For this business, name the current invoice when stating a balance. Keep all evidence and financial safeguards.` Saving pauses the case. A case correction alone changes neither future cases nor money.
2. Under **Evaluated agent learning**, choose that same **Learning role** and **Lesson scope** (business/scenario family, or explicitly all families in that business). Click **Propose reusable lesson**. Reviewer diagnoses the saved evidence; unsupported data/tool repairs or unsafe instructions stay rejected. No evaluation answers are supplied to diagnosis.
3. Inspect the candidate instruction/diagnosis, then **Compare with baseline**. This is a bounded paid operation: two independent target cases, a regression and a safety case, using the current and proposed versions. Inspect actual outputs, row results, model/version and calls. All candidate checks must pass with a correctness or call-count gain; a tie/failed/incomplete run does not qualify. Scripted or obsolete reports cannot activate.
4. Enter an **Activation/rejection/rollback assessment** of at least ten characters. Activate only after assessing the live eligible evidence, or reject with a reason. The effect stays private to that workspace/business/role/scope. New jobs pin the lesson ID; other businesses and already-running jobs retain their own instructions. No weight training, shared promotion or code rewriting occurs.
5. **Roll back this version** restores a valid prior version or base, retains comparison/decision history, and changes subsequent jobs only. Earlier suite reports remain in **Earlier comparison reports**. Limits are eight candidates, forty learning actions (rollback remains available after exhaustion) and sixty-four reserved model calls per workspace, with at most thirty-two calls/ninety seconds per comparison. These allowances do not replenish on reset.

Actual live evidence: current customer candidate improved 2/4 -> 4/4; current Reviewer candidate reached 3/4 and stayed blocked. A prior eligible Reviewer version changed a controlled review decision, then rollback restored the base result. Unsafe owner feedback was rejected. The original failed comparison remains alongside the versioned apostrophe-scoring fix. These small development suites do not prove general improvement. Paid learning UI buttons were not browser-clicked in this batch; the live SDK/store harness and automated HTTP/UI checks cover that path.

For an explicitly budget-approved live reproduction, run `npx tsx scripts/v2-phase34-checkpoint.ts --live` from this worktree. The script creates its own synthetic workspaces, saves evidence without access tokens, and stops for inspection before sandbox activation/rollback. Its existing `results/v2-phase3-4/budget.json` guard has $1.76 of $2 reserved; do not reset/delete it to bypass the cap. Offline verification: `npm test`, `npm run test:v2:db` (isolated local test DB), `npm run build`, and `npm run eval:replay`.

Changed external snapshots fail closed; arbitrary external writes, policy editing, real refunds/provider verification and a scheduler remain outside this demo. A saved event does not execute contact. All earlier checkpoint sections below are historical; current delivery above supersedes unavailable-control statements.

## Earlier Phase 3B delegated test

October 24 delegated test: Jamie's consent/success/receipt/reload/explanation retry passed; Riley's failed then explicitly retried pending outcome passed; Robin's unknown outcome/reload passed. Pending/unknown stayed blocked after Resume. Mobile width and keyboard payment activation passed. A missed offer handoff and confirmed-plan label were fixed and rechecked. Northside's existing cases were preserved. Phase 3C now adds the explicit operator decision controls above; no Phase 3C browser result is claimed.

## Check Phase 3B first

Open/refresh **http://127.0.0.1:3012/v2**. No reset or migration is needed, but old offers have outdated policy versions: ask for a fresh proposal. The checklist below can repeat the delegated sample or cover additional cases. Initial implementation verification used scripted responses and the isolated test database; the delegated test above used live calls.

1. Select Northside / Sam (resume automatic replies first if the earlier manual test left an operator hold; STOP remains in force). Send `Can I pay the full remaining balance by card in two monthly installments starting today?` Use another ready case if Sam's allowance is exhausted. Expect a fresh reviewed offer, not an executed payment.
2. In **Simulated plan and payment**, inspect the exact method, invoice, amounts and dates. With Sam's unchanged $79 balance, expect $39.50 today plus $39.50 next month. Click **Confirm this simulated plan**. Expect saved consent and a reviewed agent explanation, with balance unchanged and no receipt. Confirmation uses an action, not a customer chat turn. A chat `Yes` alone must not confirm/charge.
3. Select **Success** under **Demo processor outcome**, then click **Simulate due payment of $39.50**. Expect one simulated receipt and a $39.50 remaining balance. Inspect saved records/runtime and refresh/reselect: outcome, receipt and balance must persist. The next installment is future-dated, so it cannot execute now or automatically later.
4. On a separate ready case, create/confirm a card plan starting today and choose **Failed**. Expect an attempt with no receipt or balance reduction. A new explicit click can retry the same due installment; retrying an agent explanation must not charge again.
5. On other ready cases, choose **Pending** or **Unknown**. Expect no receipt/reduction and an operator reconciliation hold. Resume must not permit a new payment or relabel the result as succeeded. Phase 3C adds the separate operator decision described above.
6. Create/confirm a plan starting tomorrow: future terms can persist, but no payment executes before its due date. Refresh history after dates change to update observed server time; future dates do not extend this workspace's 24-hour lifetime. No scheduler runs.
7. A cash plan may be offered/confirmed, but cannot automatically create a cash receipt: operator receipt approval is still pending. Existing pending payments and unresolved business-payment evidence must block new payment/confirmation controls. Customer-reported prior payments continue using business verification, not these buttons to declare old money received.
8. Check all labels, selects/buttons, saved outcomes and keyboard/narrow-width behavior. Controls should disable during a run, STOP, takeover or review hold. Report total calls/latency, unexpected escalation, stale terms or inaccurate success wording. If the model explanation fails, inspect the saved result first; **Retry from saved evidence** retries the explanation only.

The outcome selector is a test control for a synthetic processor; it is not real bank evidence. No real payment, email, call, automatic charge or future agent runs. Confirmation/payment actions use your configured OpenAI account for the subsequent agent explanation during manual testing; normal API billing applies. No paid model calls were made during initial implementation; live calls were used in the subsequently delegated test.

Automated Phase 3B verification: **696 offline tests and 128 isolated PostgreSQL tests passed**, plus build/type checks, targeted lint, CSS assets and preserved V1 replay. These checks do not prove live wording or latency.

## Earlier Phase 3A checks

The offer-only boundary below describes the earlier checkpoint; Phase 3B above supersedes its unavailable-confirmation/execution statements.



Refresh **http://127.0.0.1:3012/v2**; no reset or migration is needed. This checkpoint adds offers, not payment execution. You own the live conversation/browser pass; the implementation used scripted responses only and made no paid model calls.

1. Select Northside / Sam. If the earlier test left the case under operator control, use **Resume automatic replies** first; STOP remains in force and is not bypassed. Use another ready case if Sam's allowance is exhausted.
2. Send `What payment methods and installment options do you have?` Expect Northside's card, bank transfer or cash and 1/2/3 payments, rather than an invented policy or automatic operator hold. The orchestrator can answer this simple read without a specialist.
3. Send `Can I pay the full remaining balance in cash in two monthly installments starting tomorrow?` Expect Account Resolution's calculation tool and required Reviewer. For Sam's unchanged $79 balance, the offer is $39.50 tomorrow plus $39.50 on the same day next month (clamped if necessary). Model wording/routing is not scripted; report any missed calculation, invented term or unnecessary escalation.
4. In saved records under the dashboard/operator pane, expect a **Payment proposal** with exact amounts/dates, method and **Not agreed. No payment received.** Refresh/reselect: it must persist without changing the balance, adding a receipt, promise or contact event. Ask for a different eligible method/date to create a newer offer; the old one should show **Superseded**. Offer labels refer to the last saved case update.
5. Select Cedar / Jamie and request cash or five installments. Cedar permits only card/bank transfer and 1/2/3/4/6 payments. Expect clarification/alternatives, or operator review for an exception. Northside policy and Sam's saved offer must not appear in this case. A normal eligible offer alone should not require operator escalation.
6. Reply `Yes, go ahead` after an offer. Chat alone must not claim confirmation, a charge, receipt or reduced balance: use the separate Phase 3B controls. Check record readability and disclosures by keyboard/narrow width; financial approval controls remain unavailable.

Synthetic defaults: Northside's first date is within 30 days; Cedar's within 45 days, using the displayed case timezone. Offers cover the full remaining balance, with no added fees/interest. Partial amounts, custom cadence and financial exceptions are not automatically approved. A month-end plan keeps its original day anchor; extra cents go to the final installments. STOP and existing turn/workspace limits remain.

Automated results: 685 offline tests and 102 isolated PostgreSQL tests passed. Scripted SDK checks cover direct options, model-selected calculation, required review and rejection of forged schedules. They do not prove live model quality or latency. No browser test was performed by the coding agent for 3A.

### October 24 call-efficiency refinement

Business policy and today/tomorrow now arrive in the run context. A simple options question can be answered directly; Account Resolution still chooses the calculation tool for a concrete offer. Scripted SDK checks use two calls for direct options and five for an accepted calculated offer (dispatch, calculation request, findings, customer reply, Reviewer). These are tested paths, not a hard cap or measured live performance. Clarification, another date offset or review revision can require more calls.

For your next manual exchange, expand Runtime. Each model call now occupies one row, with requested tool names on completed calls; start/completion events are not displayed as separate calls. New runs retain up to forty events for the existing twenty-call limit, including the initial dispatch. The history scroll area is keyboard-focusable. Old saved runs cannot recover discarded events; they show the visible/total completed count and a missing-history notice instead. No workspace reset is needed. Report the total calls and elapsed time from a new run so we can assess actual model behavior.

## Phase 2D: automated source proof

No UI change, workspace reset or app database migration is required. The dashboard still uses its saved synthetic records. There is no source selector to test manually in this checkpoint.

`npm run test:v2:db` creates/seeds only the `v2_source_demo` schema in `intervalagent_v2_test`, alongside the existing isolated workspace tests. Its source reader uses read-only transactions and a three-second statement timeout. It maps organization/account/payment rows to the same evidence as fixtures, including business policy, cents, payment states and snapshot version/date. Source SQL and credentials stay outside prompts.

Shared adapter checks cover both businesses, duplicate case IDs across businesses, missing/injection-shaped scopes and mutation isolation. PostgreSQL negatives cover invalid money/policy/state, oversized payment sets and unavailable tables. Direct-read and business-verification SDK journeys use scripted responses with both adapters; they make no paid model calls. The application error-path test verifies a saved source error and zero model reservations/calls.

Changed source facts cannot replace locally committed receipt evidence automatically: the loader stops for reconciliation. It does not claim an external database was updated or silently fall back to fixtures. Supporting a new database schema needs an explicit mapping. No production database or source-selection UI is connected.

Historical Phase 2D verification: **659 offline tests and 89 isolated PostgreSQL tests passed**, plus build/type checking, targeted lint, stylesheet checks and the pinned V1 replay gate. That checkpoint is now pushed as `5d20fab`; current Phase 3A checks are recorded above.

## Check Phase 2C first

Refresh the existing page; no reset or schema migration is needed. These are private case corrections, not reusable learning rules.

1. Open a case with a reviewed agent response, including Sam's installment conversation. Under **Operator review → Correct this case**, select the role to correct. The latest reviewed attempt is the target; an initial synthetic opening alone cannot be corrected.
2. For Sam, select **Case Orchestrator** and try: `Answer Sam's question directly and briefly. State that two installments are a request requiring review. Do not imply an arrangement or callback has been approved.` Click **Save correction and pause**. Expect operator control, saved original output/feedback and unchanged model-call/customer-turn counters. The latest Runtime summary should remain visible.
3. Click **Retry with correction and resume**. This explicit action makes paid API calls on your account. The orchestrator can select specialists; Reviewer checks the revised result. An accepted revision appends a **Reviewed correction** reply without deleting the original. A rejected revision stays in **Correction history**, labelled as an unpublished draft. The run may legitimately return to operator review where terms/policy are still unavailable; installment execution is not part of this checkpoint.
4. Expand **Correction history** and inspect the original response, role, feedback, revised response and Reviewer outcome. Refresh/reselect the case: the history must persist. Other businesses/cases must not receive this correction. Existing receipts/balances must stay intact; feedback cannot recognize/replay a payment or undo a committed effect.
5. In a separate attempt, save feedback, then add a customer message or business evidence before retrying. That input stays saved; the old correction should become stale and its retry disabled until fresh feedback is saved. **Resume automatic replies** also changes the revision, so use the combined correction retry action when you intend to run saved feedback. STOP continues to block correction/resumption.
6. Check role selection, textarea, save/retry controls, history disclosure and the paused banner by keyboard and at a narrow width. The banner should say automatic replies are paused rather than imply that an already-visible reply was never sent. Saving alone makes no model call; retries use the normal Runtime and limits.

There are at most six saved corrections per case, each with one run attempt; correction retries share the existing six-retry allowance. A failed/interrupted run remains recorded; inspect Runtime and save fresh feedback for another attempt. Ordinary later turns receive no hidden correction instruction. No lessons are activated across cases; evaluated learning remains Phase 4.

## Check Phase 2B first

Refresh **http://127.0.0.1:3012/v2**. No reset is required. The existing browser session keeps its saved work and gains the missing cases; its original expiry and limits still apply.

1. Use **Business** to switch between Northside Fitness and Cedar Home Services. Each **Client** menu and business case table should show six matching clients. **Open [client]'s case** should select that client and navigate to the conversation. Switching context clears unsent form text; saved conversations are retained. The table can be collapsed.
2. Inspect **Synthetic source and policy** in a case. Northside allows reviewed recognition from complete business confirmation; Cedar requires operator approval. Operator payment approval is not implemented in this checkpoint, so Cedar confirmation cannot automatically reduce a balance. Existing Northside cases keep their saved policy and source data.
3. As Riley at Cedar, try `I promise to pay $50 tomorrow. Please call me tomorrow afternoon.` After the reviewed reply, inspect the table and operator records: the promise and planned call should agree, with no received-money or executed-call claim. This conversation makes paid model calls on your configured account.
4. Switch to Northside, then return to Riley. Use **Refresh history**, reload the browser, and reselect Cedar/Riley. Messages, reviewed updates, planned events and balance should still agree; Northside must not show Riley's promise or inbox. Opening, selecting and refreshing alone make no model calls. A full browser reload starts selection at Alex; it does not delete other clients' work.
5. Inspect the partial-payment, different-reference, cancellation/renewal, affordability and pending-payment source records. These initialize facts rather than scripts; conversations may change direction. Eligible methods and unagreed full-balance offers are now available in 3A; arrangement agreement, approval controls and new-payment execution remain later work. A pending receipt must not be described as settled.
6. Check the selectors, table collapse/expand, case links, role highlight, Runtime and existing controls by keyboard and at a narrow width. The table has its own focusable horizontal scroll region; the page itself should not overflow. Browser, visual and model-behavior acceptance remain yours.

## Existing Daylight UI checks

The Daylight workspace uses the full V2 page width, with customer chat and the business inbox side by side, operator review below, and an expandable runtime box beside the case status. The shared V1 width limit and the extra outer card do not wrap V2. Customer-facing messages use the business name, with the customer's messages aligned separately. There are now two businesses and twelve clients, plus a business-filtered dashboard. Case corrections are available as described above; the second source mapping is verified as described above. Phase 2B/2C implementation and automated checks used no paid model calls; the separately delegated Phase 2C browser pass used one live correction run. Phase 2D used no paid model calls.

If the updated labels appear but the page is a plain vertical stack without pane borders or the workspace background, that is a stylesheet failure, not the intended design. The October 23 fix excludes `.module.css` from the global Tailwind loader so Next.js can export its scoped class names. Refresh with Ctrl+Shift+R after the local server picks up the configuration change; no workspace reset is needed. The asset checks below verify the actual class/stylesheet match without browser interaction or model calls.

1. Refresh the page. New/reset workspaces include one **Synthetic opening** per case, with a dated source balance and invoice. Untouched empty cases in an older workspace now receive that opening automatically under the workspace lock. Started, stopped, held or active cases are not rewritten. Switching clients or refreshing must not duplicate the opening or use a customer turn. An opener alone cannot be retried. No reset is needed to see the opening in an untouched empty case.
2. Follow a payment claim through the existing flow below. When the reviewed business request is saved, the light should travel from customer to business and leave a soft glow there. The text must say whose turn it is. During actual model work, expand **Runtime** to see the working agent, elapsed time and real start/completion events. The UI cue follows saved workflow state; it does not select an agent or simulate a result.
3. Reply as the business. After a report returns, attention should move back to the customer. **Last run** should retain its final duration, completed-call count and bounded steps after the reply and after refresh. The next message or explicit retry that starts a run replaces that summary. Invalid submissions, takeover/resume and messages saved during a hold do not erase it. Older workspaces have no invented summary for pre-update runs.
4. Dispute the report. Operator review should glow, replies should pause and additional messages should save for the operator without model calls. Check **Resume automatic replies**, **Stop contact**, retry and saved evidence. STOP must never be cleared by resume.
5. Check the layout at narrow widths, keyboard access, focus visibility and the **Go to…** links. The animation must not steal focus or scroll automatically. With the system's reduced-motion setting on, the role label and static highlight must remain while the travelling light is disabled. Saved agent history and API allowance are expandable rather than competing with chat.

Akshay explicitly removed the local $2 dollar ceiling for local testing on October 23. Calls now use the configured OpenAI API account without that app-side spending ceiling. Conservative usage accounting remains visible; this does not change provider credits, billing, quotas or rate limits. Per-run, turn, workspace and admission limits remain. Reuse your browser session where possible.

Technical failures now show **Technical failure** rather than implying a financial/operator review decision. Refresh, then use **Retry from saved evidence** for a previous failed run. New failures retain a safe category, provider HTTP status and code when available in **Last run**. Old generic failures have no retrospective provider details. A genuine dispute/takeover/STOP is not cleared by this change.

## Your manual pass

1. Start a private workspace and select Alex / late payment. Send `I paid $129 today by debit card. Can you check?` Expect the agent to ask for the invoice before contacting the business. The balance stays $129.
2. Reply `My invoice number is INV-101.` Expect a specific business request covering that invoice, amount, date and receipt/settlement status. While processing, expand the compact runtime box for the active agent, timestamped model steps, elapsed time and completed calls. These are actual saved events, not streamed financial conclusions. The travelling light is a UI cue tied to the saved state.
3. In the business inbox reply `Yes`. If the preceding question unambiguously stated those terms, expect reviewed recognition of $129: one saved business-confirmed receipt and a $0 simulated balance. Refresh and check both persist. It must not claim independent bank verification or a new charge. If terms were missing, expect a targeted question instead of invented facts.
4. Select Jordan / conflicting payment and change the conversation: `I promise to pay $50 tomorrow. Please call me tomorrow afternoon.` Expect a saved promise and planned contact window, not a receipt or executed call. Refresh the page and reopen the same browser session; both threads and recorded updates should remain.
5. Try `Don't call me. Please email me instead. I haven't chosen a date.` Expect a saved email preference, superseded incompatible call event and a clarification if needed. No date should be invented. Then use **Stop contact**: contact stays stopped and planned events become blocked. Resume cannot undo STOP.
6. Select Sam / fresh record and ask `Did my $50 payment reach invoice INV-102?` Expect a direct source read without a business-verification attempt. The recorded payment is already included in the $79 balance and must not be deducted again.
7. Check narrow-screen layout, keyboard use, error/waiting states, business/customer separation, review packets and takeover/resume. Takeover can interrupt a run; a later explicit retry uses saved evidence. Report the case, message and observed/expected behavior for any issue.

These are examples for testing, not runtime dialogue scripts. Agent replies vary. A blocked review produces a visible review-needed state and retains its evidence; an interrupted model request never substitutes a mock response.

For a business-report check, use Jordan before STOP (or an unused case): `I paid $129 today for INV-103.` Reply as the business `He has only paid 50 dollars`. Expect a clear attribution of the business's $50 report and an offer to dispute here, without another date/settlement questionnaire. A report alone leaves the balance unchanged and creates no payment receipt. Complete scoped confirmation can still support reviewed recognition under the existing policy; reporting an amount and recognizing a settled payment are separate outcomes.

Click **Dispute business report** or type a disagreement and ask for review. Expect an operator acknowledgement and the banner **Your message is saved. An operator needs to review this case before a reply can be sent.** Further messages persist without automatic replies or model calls until **Resume automatic replies**. Resume allows a later message or explicit retry; it cannot undo STOP. A negative business reply must leave the balance unchanged and say no matching payment was located. Pending/no-response remains unresolved.

This report/progress correction needs no reset. Refresh the page; use **Retry from saved evidence** to reassess a previously blocked exchange. Earlier transcript entries remain unchanged. Review the active-agent preview, dispute control, hold banner and operator resume with keyboard and a narrow window.

For invoice clarification, tell Alex `I have paid`, then `Inv01 and I have paid 129 dollars , today`. Expect a question clarifying the mismatch with INV-101, not a failed-business-check explanation or payment conclusion. No business request should be sent for the unmatched invoice. Then reply `Sorry, I meant INV-101.` Expect the business request to appear. This correction requires no workspace reset; historical messages/review packets are retained rather than silently rewritten.

Workspaces created before the recognition-policy update retain their older configuration. To test automatic recognition, use **Reset workspace** once or start a fresh browser session. Reset clears only your workspace history and does not reset usage accounting. The dollar-cap removal runs a local accounting-constraint migration via `npm run v2:migrate`; it preserves all histories, usage and limits unrelated to spending.

## Local setup and restart

The isolated Docker container is `intervalagent-v2-phase1`, bound to loopback port `55442`, with a persistent named volume. Its application database is `intervalagent_v2`; integration tests use the separate `intervalagent_v2_test` database. V2 code refuses V1 database URLs.

For the already-created setup:

```powershell
cd D:\Projects\IntervalAgent-v1-rebuild
docker start intervalagent-v2-phase1
npm run v2:migrate
npm run v2:dev
```

For a new clone, run `npm run v2:local-db` once to create the container and ignored `.env.v2`. Create the test database with `docker exec intervalagent-v2-phase1 createdb -U postgres intervalagent_v2_test` before the integration suite. The setup command refuses to overwrite existing configuration.

Set `V2_OPENAI_API_KEY` in ignored `.env.v2` when needed. The explicitly enabled V2 demo can also use an inherited `OPENAI_API_KEY`; merely opening a page does not call the model. Never paste keys into chat or commit them. The model is pinned to `gpt-6-luna`; there is no automatic model/provider fallback.

Use `npm run v2:dev` for this pass. Its child process disables V1's live endpoint and clears V1 database credentials from that process. The original `.env`, V1 application source and production are unchanged. Stop that local process when finished.

## Limits and persistence

| Limit | Phase 1 value |
| --- | --- |
| Workspace lifetime | Fixed 24 hours; reset/activity does not extend it |
| Customer messages | 10 accepted messages per case; duplicate requests count once |
| Business replies | 10 per case, including retained late replies |
| Explicit retries | 6 per case; do not consume another customer turn |
| Operator corrections | 6 saved corrections per case, 1,200 characters each; one run per correction, sharing the 6-retry allowance |
| Case actions | 60; STOP/history remain available at the limit |
| Workspace resets | 3, within the original lifetime |
| Workspace admission | 20 globally per UTC day on this local database |
| Local model dollar ceiling | Removed by Akshay for local testing; paid usage is billed to the configured API account |
| Per-run model work | At most 20 calls across nested agents, 90 seconds overall, 30 seconds per provider request |
| SDK turns | 6 outer turns, 4 per specialist invocation, at most 2 reviewed drafts |
| Model payload/output | 32 KB serialized context per call; at most 1,400 output tokens |

The usage ledger records a reservation before each call. Known usage is charged at conservative rates; missing usage/timeouts keep the full reservation. Earlier file-based checkpoints retain $1.66 in conservative reservations because complete usage receipts were not retained for them. This is an upper-bound accounting ledger, not a bill or current spending ceiling. New database-tracked calls retain reported usage, role, tool names and model latency. Workspace reset does not erase usage. No automatic provider retry or fallback model is enabled.

Events are records only: no worker, scheduler, reminders, calls or email delivery. A window extending beyond workspace expiry is labeled. Expired workspaces deny access and late replies; bounded cleanup happens during new workspace creation. Losing the browser cookie can lose anonymous access.

## Automated verification

```powershell
npm test
npm run test:v2:db
npm run typecheck
npx eslint src scripts tests vitest.config.ts vitest.v2-db.config.ts
npm run build
npx tsx scripts/v2-check-styles.ts --build
npm run eval:replay
```

The offline suite blocks network access and excludes both database suites. The V2 integration suite uses real PostgreSQL in its dedicated test database and never calls a model. V1 DB integration tests were not run; V1 database code was unchanged.

With `npm run v2:dev` running, `npx tsx scripts/v2-check-styles.ts` also checks the served page and its static CSS assets. It makes no workspace/model request. This specifically detects the empty CSS-module export that unit tests and a successful build missed; it does not replace your visual, motion or keyboard testing.

Optional live verification commands make paid calls on the configured API account; the local $2 ceiling no longer applies:

```powershell
npm run v2:checkpoint -- --live --case=dated-email
npx tsx scripts/v2-integration.ts --live
```

Live artifacts are local under ignored `results/v2-phase1/`. They contain synthetic evidence and bounded summaries, not keys or private reasoning. The persistent trace records the model, role version, source-code hash, saved states and observed request times. It is not yet a V2 offline replay runner; that is Phase 5. A failed pre-fix trace was retained separately.
