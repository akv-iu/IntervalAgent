# Live semantic comparison: October 26, 2026

The contextual interpretation path worked in live SDK calls across both businesses. The initial candidate also regressed on three cases. One bounded correction pass fixed two of those in development retests; the third retest is incomplete because the approved reservation guard stopped further calls. This is useful development evidence, not full acceptance or a general model-quality claim.

Initial matched comparison: previous application `6bf7fd4` (`v2-phase4-1`) against `c1eb79b` (`v2-claim-1`). Same nine fixed raw inputs, synthetic source facts, clock, model `gpt-6-luna`, SDK 0.21.0 and bounded transport. Execution order alternated. Expected answers were not passed to the agents. No database writes, browser tests, real payments, lessons or deployment were involved in the live comparison.

| Initial result, nine cases per variant | Previous | Checkpoint 1 |
| --- | ---: | ---: |
| Structured checks passed | 5/9 | 6/9 |
| Structured checks plus coding-agent semantic assessment | 3/9 | 6/9 |
| Needlessly requested an already-known invoice/amount | 3/9 | 0/9 |
| Model calls | 46 | 42 |
| Reported input / output tokens | 92,354 / 2,389 | 99,689 / 3,708 |
| Median end-to-end case time | 7.774s | 8.248s |
| Slowest case | 12.442s | 15.629s |
| Conservative reported-token accounting | $0.025478 | $0.028630 |

Fewer calls did not produce a general latency or token-cost improvement in this small sample. Contextual-confirmation improved from seven calls/12.029s with no accepted business request to four calls/7.259s with a correct request. Cedar full-balance reference improved from six calls/10.204s without a useful accepted result to four calls/8.678s with a correct request. These are individual observations, not statistically significant speed claims. Four blocked claim attempts remained in initial candidate activity; correct final replies do not establish perfect initial tool selection.

| Case | Previous structured / assessed | Checkpoint 1 structured / assessed |
| --- | --- | --- |
| Contextual confirmation/full amount | fail / fail | pass / pass |
| Cedar contextual full balance | fail / fail | pass / pass |
| Explicit payment details | pass / pass | fail / fail |
| Later denial | pass / pass | pass / pass |
| Conditional future intention | pass / fail | pass / pass |
| Explicit different invoice | pass / fail | fail / fail |
| Ambiguous invoice reference | fail / fail | pass / pass |
| Contextual invoice correction | fail / fail | pass / pass |
| Vague business yes, unknown terms | pass / pass | fail / fail |

Semantic assessment is coding-agent self-review, separate from the runtime Reviewer, not an independent human panel. The previous model proposed a firm promise from a conditional intention; the evaluation never committed it. It also asked to repeat an explicit different invoice. Those outputs show why a structured routing check alone is insufficient. No variant proposed payment recognition in these cases.

## Correction and retest

See RETEST.md for the diagnosis recorded before retesting. Candidate revision `5134496`, role version `v2-claim-2`, adds explicit cents units and clarifies scope and acknowledgement-versus-receipt review instructions. It does not relax provenance, account boundaries, business-report completeness or financial authorization.

| Development retest at the new revision | Result | Calls / elapsed |
| --- | --- | --- |
| Explicit payment details | Accepted targeted request; 12900 cents/date retained | 4 / 9.403s |
| Explicit different invoice | Accepted scoped explanation/operator referral; no invented cross-account check | 5 / 7.698s |
| Vague business yes | Incomplete before final review; no success inferred | 3 / 5.655s |

The remaining six cases were not rerun at `v2-claim-2`. Do not combine results across versions into an 8/9 or 9/9 acceptance claim. The different-invoice retest still used an unnecessary source reread and Account Resolution; it is correct but has avoidable work. The vague-business-reply instruction change remains unvalidated in a completed live run.

## Budget and reproducibility

Akshay approved a separate $2 testing budget after fresh usage was reported at 6:19 PM Mountain: 47% five-hour / 92% weekly, resetting October 26 at 9:45 PM / November 2 at 3:45 PM. This did not restore the removed app-wide cap.

The shared test ledger reserved $0.02 per attempt and retained reservations across both runs. All 100 permitted attempts completed provider calls with known usage; the guard prevented the next required Reviewer call. The original partial capture has a generic local error classification, but the closed ledger and recorded calls establish the reservation-cap stop, not a provider outage. The harness now distinguishes that budget stop for future runs. **No further paid calls were made.**

Total: **220,364 reported input tokens, 7,020 output tokens, zero unknown-usage calls**. Conservative reported-token accounting is **$0.062111** at $0.25 input / $1 output per million, including the incomplete retest's three calls. This differs from the **$2 reserved ceiling** and is not a provider billing statement. The checked [official model page](https://developers.openai.com/api/docs/models/gpt-6-luna) lists lower standard rates; cache/tier/billing details were not captured sufficiently to assert exact billing.

cases.json, both original capture files, the closed budget, rubric, retest declaration and manual assessment are hash-pinned by manifest.json. Offline evidence tests reproduce structured verdicts, assessment counts and accounting without API/DB clients. Captures contain synthetic raw inputs, final findings, source/role versions, calls/tokens/times and hashes. They do not contain API credentials, workspace tokens or exact provider request/response transcripts. Re-scoring is not another live orchestration run.

`npx tsx scripts/v2-semantic-checkpoint.ts` is preparation only. `--live --run=unique-name` makes paid calls through the existing bounded model and the retained ledger; it needs new authorization after this batch's cap. A future separately approved batch needs a new explicit budget arrangement, not deletion of this ledger. Production main remains V1.

Next useful check: finish the vague-business-reply run under separately approved testing allowance, then consider a small fresh paraphrase set for the current revision. Current evidence cannot certify all natural language, whole-conversation cost/latency, or unrestricted financial reliability. Browser acceptance remains with Akshay.
