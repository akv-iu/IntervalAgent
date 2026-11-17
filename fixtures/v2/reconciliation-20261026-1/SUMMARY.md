# Customer agreement reconciliation: October 26

Akshay approved this bounded fix and up to $1 of additional live testing. Live inputs are synthetic and run in memory: no database/app-budget writes, browser test, real transaction or deployment. Sam's fixture preserves the reported wording and message IDs. The input builder contains no expected agent answer. Current runtime is `4c613e2`, role `v2-reconciliation-4`, using existing `gpt-6-luna` bounded transport. Captures retain inputs/outputs; later diagnostic captures also retain model exchanges, without credentials or HTTP headers.

Expected outcomes were declared before calls: refresh Sam's stale $79 claim to the agreed $40; request missing receipt facts from the business without an operator hold or premature write; recognize a new confirmed payment once; refuse already-included money; distinguish a dispute. This is development regression evidence, not a held-out benchmark.

| Capture | Runtime | Observation |
| --- | --- | --- |
| `initial.json` | `560b682`, reconciliation-1 | Agreement blocked after 9 calls: the provenance gate incorrectly excluded a linked report citation. |
| `linked-report-retest.json` | `4194fd1`, reconciliation-2 | Agreement passed in 6 calls / 17.516s. New-payment continuation stopped after 4 calls: mistyped IDs and generic SDK feedback. |
| `diagnostic.json` | `4194fd1`, reconciliation-2 | Four calls reproduced mistyped IDs and generic errors; no specialist/final review completed. |
| `repair-feedback.json` and interrupted snapshot | `24b7aa3`, reconciliation-3 | Six completed calls plus one retained reservation. Windows rejected a report rename before that reserved call started. No final outcome. The temporary snapshot is archived separately, not counted as another run. |
| `validated-reuse.json` | `4c613e2`, reconciliation-4 | Agreement passed in 13 calls / 29.840s without operator/financial write. New settled payment passed in 6 calls / 14.082s: one valid 4000-cent proposal, $79 minus $40 = $39. The already-included case completed one call before the reservation cap. Dispute live testing did not run. |

Interpretation/delegation remain model decisions. Code validates scope, exact citations, chronology, linked reports and financial authority. A report citation requires customer confirmation and cannot prove receipt. Changed interpretation travels through existing specialist arguments or final output; null refresh metadata reuses validated state instead of recopying IDs. The SDK `asTool` wrapper exposes only scoped validation feedback. No new interpreter agent, phrase route, framework or mandatory call was added.

Wording assessment: the completed agreement runs distinguish agreement from dispute. The new-payment continuation attributes business confirmation, calculates $39 and preserves the included $50. **Latency/Reviewer reliability remain limited:** the final agreement needed a second review cycle after an unnecessary rejection. Reviewer called a missing-date business question unnecessary; the final follow-up omitted that date. The later synthetic business reply supplied it anyway. A missing date still cannot authorize a write. This does not establish complete follow-up questions or elimination of false rejections. Included-payment/dispute live checks remain incomplete; code guards/scripted journeys cover them offline.

The separate ledger is closed at **50 reservations / $1**, independent of the previous closed $2 batch. **49 calls reported 220,465 input / 12,564 output tokens; one unused/unknown reservation remains conservatively charged after the save interruption.** Existing accounting estimates $0.067700 for reported tokens, or $0.087700 including that $0.02 reservation; neither is an invoice. The reservation cap stopped further calls despite lower token accounting.

`manifest.json` pins all JSON hashes. Evidence tests independently validate the successful proposal and refuse a duplicate. Isolated PostgreSQL tests cover reconnect, $79→$39 exactly once, preservation of the included $50 and rejection of a later denied claim. No saved user balance was altered.
