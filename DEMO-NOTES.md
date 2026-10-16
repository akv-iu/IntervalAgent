# Demo notes and design review

Rehearsal notes, not claims that implementation is complete. Use completed tense only after release checks pass.

## Positioning

"I built a small collections simulation around the responsibilities in your role: generating outreach, evaluating behavior, learning channel and timing choices, and making results usable in a customer dashboard. I kept each part small enough to test and explain end to end."

Prefer "I deliberately scoped this to demonstrate the full loop" over "I could have built much more if I had time." Name the limit, next experiment, and evidence that would justify deeper work.

## Two-minute demo

| Time | Show | Explain |
| --- | --- | --- |
| 0:00-0:20 | Customer | Synthetic balances, mock outreach, simulated receipts, defined metrics |
| 0:20-1:00 | Evals and dispute/stop conversation | Recorded live agent, scripted customer, guards, actual comparison |
| 1:00-1:25 | Picker | Explore during training, freeze choices, test new cases; payment reward |
| 1:25-1:45 | Failed CI evidence and restored green | A guard regression detected without paid calls |
| 1:45-2:00 | One tradeoff and next step | Respond to the depth topic Connor cares about |

## Concepts to explain in your own words

| Area | Demonstrated concept | Deliberate limit | Next depth step |
| --- | --- | --- | --- |
| Evals | Expected behavior, adversarial cases, regression testing | Twelve paths; pattern checks miss meaning | Independently reviewed paraphrases and real failures; measure misses and false alarms |
| Guards | Prompt guidance plus code controls and fallback | Two things change in the comparison | Compare baseline, improved prompt alone, and prompt plus guard to isolate contributions |
| Replay | Repeatable application checks on stored outputs | Does not detect future model drift | Small periodic live evals and new reviewed recording sets |
| Bandit | Explore/exploit, reward, segments, held-out testing | Synthetic fixed probabilities and small samples | Multiple seeds and uncertainty; contextual features if data supports them; controlled real experiment before real lift claims |
| Reporting | Integer money, denominators, promises versus receipts | Full-payment agreements always settle in simulation | Real payment events, partial payments, reconciliation, reporting cutoffs |
| PostgreSQL | Constraints, transactions, isolation, aggregation | Small read-only dataset | Query plans at realistic scale; tenant authorization before private data |
| Operations | Offline run/import, read-only public view | No real delivery or concurrent workers | Idempotent jobs, retries, consent checks, audit trail, monitoring before real sending |
| Try page and lessons | Human correction loop: fix, retry, accept; soft lessons in the prompt, four hard rules in code; one shared rule list for guard and scores | Live only on a local clone; lessons match by pattern-read situation; rules read wording, not meaning | Promote reviewed situations into recorded evals; measure whether accepted lessons reduce repeat mistakes |
| AI-assisted work | Generated work reviewed with tests and judgment | Tests are not proof every line is correct | Explain an actual bug, its cause, and the check that caught it |

Do not imply deferred systems are already built or mastered. Learn unfamiliar concepts through a small example before using them in the pitch.

## Retrospective on this correction

Written as a review of the plan before implementation; what shipped is in [README.md](README.md) and [DEVLOG.md](DEVLOG.md).

- Preserved breadth: picker is required alongside live evals, customer UI, SQL reporting, and deployment.
- Removed low-value work: second provider, LLM personas, tone judge, custom walkthrough, autoplay, separate aging page, historical run browser.
- Corrected evidence: system comparison replaces prompt-only attribution; simulated receipts are distinct from agreements; train/test cases are separate; mock dashboard data is labeled.
- Corrected contracts: explicit account datasets, persisted message checks, run timestamps/completion, pinned recordings.
- Simplified mechanics: one typed JSON artifact connects runner and importer. No DB-dependent CI, sink framework, or pass-count baseline updater. The complete suite and all hard checks gate release.

## Introspection: remaining weaknesses

- A shorter plan can hide integration work. After the mock core, implement one conversation through JSON, database, and UI before live-eval access becomes a dependency. Reuse the final modules, then complete the suite and pages.
- Scripted personas can favor the agent. Keep transition rules fixed across versions, assert trigger coverage, and review transcripts; never tune replies to make guarded win.
- Guards and scorers can share blind spots. Use independent positive/negative examples, adversarial paraphrases, and manual review. Passing checks is not universal safety.
- Mock dashboard data can be confused with live evals. Keep source labels beside metrics; never combine recovery numbers.
- Held-out synthetic results inherit assumptions chosen by us. Disclose those assumptions and actual results, including losses.
- Two days depends on setup access. Stop polishing when release checks pass; fix narrow failures without expanding architecture.

## Follow-up plan corrections

The implementation-plan review tightened six points: validate installment counts and totals, schedule handoff messages, establish green replay CI before its mutation demo, separate test:db from offline tests, bring the database/Customer path forward, and remove optional picker-to-bulk wiring. These are correctness and sequencing fixes, not new product features. Customer recovery remains a fixed-policy mock simulation; learned-policy results belong on Picker.

## Ready-to-pitch self-check

Can you explain one conversation and its verdict, how the picker updates an estimate, why testing is separate, where a dashboard number comes from, and a test you intentionally broke? If not, spend remaining time on understanding and verification rather than features.
