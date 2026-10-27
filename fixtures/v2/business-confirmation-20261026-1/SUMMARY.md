# Business confirmation checkpoint: live acceptance FAILED

Akshay approved the bounded fix with usage unknown and a new $1 live API test allowance. This is a separate batch from both earlier closed budgets. Work used synthetic in-memory live inputs and an isolated PostgreSQL test database. No user's saved balance, production branch, browser state or application budget was modified by testing.

## Reproduction and engineering changes

Jordan's saved transcript is captured in `jordan.json`, without workspace access credentials. The saved production-demo failure contains two orchestrator tool requests and a generic error; rejected tool arguments were not retained. Offline reproduction using that same history and repeated invalid report arguments made requests of 28,652 and 31,175 bytes, then hit the existing 32 KB context guard. This matches the failure pattern but does not prove the exact missing arguments of the user's run.

The provenance bug is reproduced in a failing test: a customer response could not stay linked to the original report across later business follow-ups. The validator now checks an actual earlier linked report, rather than forcing the latest business message. Customer agreement is not financial authority and is not compared to a potentially newer stored report amount; raw semantic support is still reviewed. Changed claims remain scoped/current and require exact quotations.

Business tools accept `{paymentClaim: null}` to reuse validated interpretation. Shorter role instructions remove repeated/contradictory report/dispute mandates. Messages carry a computed local calendar date, avoiding UTC-day inference on retries. Business Verification and Reviewer use low reasoning effort; orchestrator/resolution retain none. The same model, 1,400 output-token bound, 32 KB request guard, per-run limits and four roles remain. The final role version is `v2-business-confirmation-3`: new BusinessFinding output excludes `business_reported`, while historical Verification records still read that value. The final schema restriction was offline-only after the test cap.

Confirmed business receipts need no further customer acceptance. Code supports `payment_recognized.replacesReceiptId` only for a newer confirmation of the same active local business receipt, same request/invoice/date/reference/original claim and permitted policy. The corrected TOTAL replaces the old entry, preserving it with a reversal link. $129 minus $80 is $49; correcting that same receipt to $50 restores $30 and leaves $79. Imported/operator/simulated/reversed/unrelated receipts cannot be replaced this way. Unknown/pending evidence cannot authorize money. Ledger/source/audit/reply changes remain atomic; duplicate commands are fenced. Only a committed recognition refreshes the saved claim's source generation; audit retains the original interpretation.

## Live evidence, including failures

| Capture and runtime | Case | Result |
| --- | --- | --- |
| `initial.json`, `e434e82`, business-confirmation-1 | $80 paid today | FAILED: 13 calls / 24.091s; model demanded proof of hypothetical additional money instead of recognizing the supported partial payment. |
| Same | Exact Jordan saved history | FAILED: 12 calls / 25.210s; model kept treating contextual receipt confirmation as unresolved; review blocked. Maximum request 27,105 bytes, so this run avoided the reproduced context overflow but did not resolve the case. |
| Same | Explicit unknown date | Structured safety check passed: 6 calls / 10.377s; no financial effect, date remained unknown, business follow-up. Wording still overemphasized the original full-payment claim. |
| Same | Explicit pending receipt | Structured safety check passed: 12 calls / 21.618s; no financial effect. Excessive calls/questions remain a quality failure. |
| `partial-policy-retest.json`, `bbcb585`, business-confirmation-2 | $80 paid today | INCOMPLETE: 7 calls / 19.024s; reservation cap stopped the next call before final review. Local date was correct, but Business Verification still questioned the invoice named in its linked question. One invalid legacy report-only finding caused additional work. No success claimed. |

Expected actions and synthetic contexts were declared before each call. The original question, actual business wording and preceding conversation were present in the captured specialist input. Missing context is not established as the explanation for these semantic failures. The receipt-correction live continuation was skipped because its prerequisite recognition failed. Final version 3 has no paid acceptance run. Do not combine different revisions into a pass rate or claim this workflow is now reliable.

## Budget and next boundary

The ledger closed at **50 attempts / $1 reserved**, with all attempts reporting usage: **166,775 input and 4,821 output tokens**. Existing conservative reported-token accounting estimates **$0.046534**, not an invoice and not $1 actually billed. The reservation cap stopped further testing despite lower reported-token accounting. No additional paid tuning was performed after that stop.

Automated tests establish report-reference/context repair, role settings, exact arithmetic, guarded receipt replacement, rejection/rollback, reconnect and unchanged customer-turn counts. They do not establish live English interpretation. Next work should isolate Business Verification's evidence/authority interpretation before more full-workflow changes. No new framework, agent, automatic lesson activation or deployment is justified by this failed result. Browser acceptance remains with Akshay.
