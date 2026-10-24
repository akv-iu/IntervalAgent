# V2 local demo: Phase 2A UI checkpoint

Worktree: `D:\Projects\IntervalAgent-v1-rebuild`, branch `v2-rebuild`.
Open **http://127.0.0.1:3012/v2**. Akshay owns browser/UI/manual acceptance.

## Check the updated UI first

The Daylight workspace uses the full V2 page width, with customer chat and the business inbox side by side, operator review below, and an expandable runtime box beside the case status. The shared V1 width limit and the extra outer card do not wrap V2. Customer-facing messages use the business name, with the customer's messages aligned separately. There are still one business and three clients; the remaining Phase 2 dashboard/source work has not started. No model calls were used to implement or verify this UI checkpoint.

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
