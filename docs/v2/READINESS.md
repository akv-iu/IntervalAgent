# V2 readiness and acceptance evidence

Final automated checks for semantic checkpoint 2: **791 offline tests / 52 files, 184 isolated DB tests / 2 files, types/lint/build/CSS and preserved V1/V2 replays passed**. These do not replace the incomplete live retest or Akshay's browser acceptance.

October 26 semantic checkpoint 2: the [frozen live comparison](../../fixtures/v2/semantic-20261026-1/SUMMARY.md) records nine matched cases: previous/checkpoint-1 structured passes 5/9 -> 6/9, assessed useful outcomes 3/9 -> 6/9. After one bounded correction pass at `v2-claim-2`, explicit payment details and different-invoice handling passed retest; the vague-business-reply retest is incomplete because the 100-call reservation guard prevented final review. The other six cases were not rerun at this version. Median initial case time was 7.774s previous / 8.248s candidate, so no general speed claim is supported. Claims of universal understanding, a complete 9/9 current-version pass or exact API billing remain unsupported. All original failures are retained. No browser test, deployment or real payment occurred.

October 26 semantic checkpoint 1: **780 offline tests / 50 files and 184 isolated PostgreSQL tests / 2 files passed**, plus type/lint/build and both preserved replay gates. A failing reproduction of contextual invoice confirmation now passes through a cited payment-claim contract, existing SDK delegation, Reviewer and transactional persistence. Added checks cover unknown terms, wrong/stale scope or citations, new customer corrections, rejected review publication, reconnect, financial authority and historical lesson exclusion. Baseline is `v2-claim-1`; archived replay remains historical. No new API calls, browser acceptance, migration/reset or production change occurred.

For **FR-04/05/06/07/11/13/17 and NFR-03**, these checks establish the interpretation boundary and persistence/authority mechanics, not live semantic reliability. Customer claims may be contextually interpreted but cannot establish receipt. Reviewer must check the meaning of the cited evidence; code does not prove English semantics. Unknown amount/date can reach business investigation while financial recognition still needs complete linked authoritative evidence. Legacy financial reviews need fresh interpretation before new recognition, and old-base lessons need new evaluation before application. Matched live semantic evaluation is checkpoint 2 and needs separate approval/budget. See STATUS.md for the bounded scope and remaining checks.

October 26 addendum: the approved UI refresh passed 758 offline checks (including three new runtime/navigation regressions), with 31 focused checks rerun, build/types/lint/CSS/replays and sampled desktop/390px visual review. Business/Review/Details navigation supersedes the earlier layout; use the updated DEMO.md checklist. No new paid calls, DB integration run or full browser/live-model acceptance is claimed. The matrix below records the October 24 baseline; [STATUS.md](STATUS.md) records the UI checkpoint and remaining acceptance.

October 24, 2026. Phase 5C is the final **automated** verification checkpoint for the agreed portfolio scope. The implementation supports a controlled demonstration; **Phase 5B browser/UI acceptance remains pending with Akshay**. This document is an evidence map, not a claim that every functional/non-functional requirement has unrestricted production acceptance.

## What ran in Phase 5C

| Check | Observed result | What it establishes |
| --- | --- | --- |
| `npm test` | 755 tests / 49 files passed | Offline logic, SDK/tool contracts, bounds, validation, rendering and replay mechanics. Network disabled in test setup. |
| `npm run test:v2:db` | 181 tests / 2 files passed | Actual PostgreSQL transactions/persistence and mapped source behavior in `intervalagent_v2_test` only. |
| `npm run typecheck` | Passed | Type/route generation checks. |
| Targeted ESLint | Passed | Changed integration test code passes configured lint. |
| `npm run build` | Passed | Production build; existing V1 filesystem-tracing warnings remain. |
| Built CSS check | Passed | Existing workspace module/grid/design rules remain in emitted assets. |
| `npm run eval:replay` | V1 guarded gate passed | Preserved pinned V1 evidence remains reproducible; its baseline failures remain visible. |
| `npm run eval:v2:replay` | Saved-output gate passed | Archived customer 2/4 -> 4/4, Reviewer 2/4 -> 3/4 ineligible, and unsafe-suggestion rejection reproduce. No new live model evaluation. |

No application bug was reproduced in this checkpoint, and no application code or feature was changed. Fourteen new integration checks extend the existing DB suite from 167 to 181. Their model responses are **scripted**, while SDK delegation, source validation, progress/usage instrumentation, command/store validation, transactions and reconnects execute normally. Scripted model invocations are not OpenAI API calls or billing evidence. No paid calls, browser test, deployment, production/V1 database access or reset of Akshay's demo workspace occurred.

## New journey coverage

The same four-turn journey runs independently for each client below: direct record answer with Orchestrator/Reviewer only; promise plus a planned call through Account Resolution; email-only preference superseding the call without inventing a new appointment; then a specifically requested planned email. Tests reconnect to PostgreSQL, compare unchanged source money and peer cases/workspaces, reject duplicate publication, then confirm STOP blocks the planned event/retry without another model reservation.

| Business | Clients / starting situations | Scripted SDK invocations per journey |
| --- | --- | --- |
| Northside Fitness | Alex / late payment; Sam / included partial payment; Jordan / conflicting reference; Taylor / cancellation; Morgan / affordability; Casey / pending payment | 14 each |
| Cedar Home Services | Riley / late payment; Jamie / included partial payment; Drew / conflicting reference; Avery / cancellation; Robin / affordability; Quinn / pending payment | 14 each |

Two additional journeys carry a matching $50 claim through Business Verification, a linked business reply, Account Resolution and Reviewer. Northside's explicit recognition policy permits one reviewed receipt/balance change; Cedar preserves the balance until a separate takeover/operator approval. Both persist the correct receipt provenance, reject a cross-business reply, and create no new charge. Each uses 10 scripted SDK invocations. New checks total **188 scripted invocations across 14 journeys**; this count covers the new checks only, not the entire test suite. These exercise protocols across all seeds, not live natural-language quality in all twelve situations.

Two self-review passes: (1) traced model-selected tool calls -> normalized source -> scoped commands -> accepted review -> transactional updates/audit -> runtime -> reconnect. (2) checked no-repeat effects, other-business/tester isolation, changed intent, STOP and automatic/operator authority differences. The initial new isolation assertion incorrectly expected two independently created workspaces to share timestamps; it now compares each workspace with its own original snapshot. No product contract, guard or model score was relaxed. These are self-reviews, not independent reviews.

## Functional requirements

Evidence names below refer to files in `tests/` (DB entries in `tests/v2-db/`). “Automated” means tested mechanics; it does not certify all possible model conversations.

| Requirement | Evidence and delivered boundary | Acceptance qualification |
| --- | --- | --- |
| FR-01 business configuration | `v2-source`, `v2-options`, DB `workspace`: two brands/options/recognition policies and scoped contact data share roles. | Seeded/code-configured demo. No general business-policy/tone/rules editor; the outreach tone selector is a benchmark preview. |
| FR-02 source adapter | Shared `helpers/v2-source-contract`, `v2-source`, DB `source`: fixtures and differently shaped PostgreSQL mapping, scoped missing/invalid/unavailable results. | Automated. No universal schema detection or external write connector. |
| FR-03 business/client selection | `v2-dashboard`, `v2-source`, new twelve-client DB journeys and peer-state comparisons. | Data/rendering/integration checked; full selector browser acceptance pending. |
| FR-04 history/conversation | `v2-runtime`, `v2-presentation`, DB opener/legacy/update/retry tests and new multi-turn journeys. | Protocol/history verified; live conversation coverage remains sampled, not exhaustive. |
| FR-05 four responsibilities | `v2-agents` role/tool denial and nested SDK tests; new exact role sequences show direct reads avoid specialists and business evidence uses distinct roles. | Scripted SDK mechanics plus prior live examples; no proven advantage over a single-agent baseline. |
| FR-06 evidence/freshness | `v2-source`, `v2-agents`, DB recognition/source tests and new linked-business journeys. | Dated snapshot/claim/business/operator evidence remain distinct; simulated business contact is not a bank. |
| FR-07 review gate | `v2-agents` bounded revisions/failed delegation; DB rejected/threat/stale/invalid publication tests; preserved failed Reviewer candidate. | Automated gates and limited live comparisons. Reviewer reasoning is not guaranteed correct. |
| FR-08 operator review | DB dispute/hold/resume/recognition/reconciliation; `v2-financial`, `v2-corrections`. | Workspace-local synthetic operator, without production identity/permission administration. |
| FR-09 simulated finance | `v2-options`, `v2-payments`, `v2-financial`, DB authority/duplicate/late/stale/outcome/compensation tests. | Synthetic ledger only. Actual payments/refunds, arbitrary overrides and changed external snapshot merge remain unsupported. |
| FR-10 case correction | `v2-corrections`, DB saved/original/revised/stale/capped correction tests. | Feedback is separate from evidence/financial approval and reusable learning. |
| FR-11 candidates | `v2-learning`, DB diagnosis/source/scope/unsafe/data-repair checks; prior actual diagnosis calls. | Bounded supported role/focus combinations; unsupported failures do not become arbitrary prompt edits. |
| FR-12 matched evaluation | `v2-learning`, `v2-eval-replay`, DB tie/incomplete/scripted/unsafe denial; pinned live comparisons. | Two role contexts with small development samples. No final holdout or general improvement claim. |
| FR-13 activation/rollback | DB current-baseline/model/suite/scope checks, next-job pinning, stale-prior rollback and budget-exhausted rollback; prior live sandbox proof. | Private explicit activation only. No shared promotion or weight training. |
| FR-14 outreach policy | `v2-outreach`, `picker`: compact preserved snapshot reproduces V1 choices/seeds/counts. | Hypothetical age-group preview because V2 has no age field. No automatic outreach or business-specific retraining; UI pending. |
| FR-15 dashboard/records | `v2-dashboard`, `v2-financial`, DB atomic updates/receipts and new contact-intent journeys. | Saved records are distinguishable; broad browser acceptance pending. |
| FR-16 preserved/new evals | Both replay gates, `v2-eval-replay`, SDK/DB tests and pinned synthetic live-output fixture. | V2 is saved-output rescoring, not exact provider-request/SDK-orchestration replay. Full multi-agent reporting/live holdout is not implied. |
| FR-17 persistence/stale work | DB reconnect/revision/interruption/reset/expiry/correction/payment tests; new reconnect journeys. | Automated. Private workspace expires; unsupported source changes fail closed. |
| FR-18 provenance/runtime | `v2-runtime`, `v2-failures`, DB model-start/finish/usage tests; new journeys use the real instrumentation around scripted responses. | Runtime is bounded, not private reasoning. Scripted instrumentation is not live latency/cost evidence. |
| FR-19 structured updates | `v2-agents` source/role validation; DB atomic update/reply/audit and all twelve new journeys. | Promises/preferences/plans are recorded; they do not prove payment or contact execution. |
| FR-20 cross-party verification | `v2-agents`, DB linked/foreign/late/takeover/new-request tests and new business-evidence journeys. | In-app simulated exchange. No external messaging, background agent polling or timed reminder. |
| FR-21 planned contacts | New changed-intent/STOP journeys, DB date/channel/expiry tests and dashboard rendering. | Planned/superseded/blocked states; no scheduler/call/email execution. |
| FR-22 tester isolation | DB independent workspace, cap, STOP/history, reset/expiry, foreign-request and scoped-learning tests. | Anonymous browser-session demo, not production business authentication. |

## Non-functional requirements

| Requirement | Evidence/status |
| --- | --- |
| NFR-01 preserve V1 | Branch/remote checks keep `main` at `2827779`; authorized pushes target `v2-rebuild`. No production merge/deploy/config change. |
| NFR-02 trust boundaries | Strict command/source/output schemas; `v2-agents`, `v2-source`, DB foreign/stale/forged scope checks. Sandbox role play grants no maintainer authority. |
| NFR-03 financial integrity | Integer-cent/date/policy calculation, locked transactions, before/after audit, duplicate/unknown/rejected/stale outcome tests and both recognition authorities. |
| NFR-04 limits/accounting | `v2-agents` nested bounds; DB admission/turn/reply/action/reset/expiry/reservation/unknown-usage tests. App-wide local dollar cap remains intentionally removed. |
| NFR-05 interruption/concurrency | DB duplicate commands/concurrent effects, stale publish, reset/STOP/takeover, post-commit explanation failure and reconciliation tests. |
| NFR-06 maintainability/adapter | Connected code self-review and shared source/SDK behavior checks. Existing SDK reused; no new framework. Long-term maintainability is not established by passing tests. |
| NFR-07 evaluation separation | Candidate diagnosis excludes evaluation answers; declared suite/versions and failed candidates retained. Development comparisons remain separate from any future final holdout. |
| NFR-08 secrets/diagnostics | Allowlisted source/command/fixture fields, cookie/session scope, cross-business denial and archive credential-pattern/schema tests. No independent security audit claimed. |
| NFR-09 usability/accessibility | Semantic controls/rendering/CSS checks and earlier sampled browser evidence. **Phase 5B keyboard/mobile/click-through/contrast acceptance pending**; no full a11y audit. |
| NFR-10 honest metrics | Historical live/saved-output reports identify sample sizes, known/unknown usage and per-call latency. No new live latency benchmark or SLA in 5C. |
| NFR-11 verification | 755 offline + 181 isolated DB checks, build/types/lint/CSS and both replay gates; two labelled self-reviews. No new live/browser/independent review in this checkpoint. |
| NFR-12 durable waiting | DB request correlation, late evidence, invalidation/expiry and business-policy journeys. No timed reminders/future contact worker; request lifetime remains bounded by workspace/activity rules. |
| NFR-13 persistence/hosting | Actual PostgreSQL state, fixed expiry/reset/cleanup guards and scoped artifact retention. **Hosting capacity/free-tier suitability not assessed or deployed in 5C**; optional hosting is not a portfolio-demo dependency. |

## What remains before calling the demonstration accepted

1. Akshay's [Phase 5B manual/UI checklist](DEMO.md#phase-5b-manualui-acceptance-for-akshay). Report failures or delegate that browser pass explicitly. “Continue” has not been treated as a pass result.
2. Walk through the chosen story in [DEMO.md](DEMO.md) if current live wording/latency matters. Broader live coverage needs its own agreed budget; current evidence stays labelled sampled/scripted/replayed.

No additional features, universal connectors, automated real outreach, hosted product or new learning framework are required to reach this portfolio stopping point. Optional hosting or broader research can be a later explicit decision. This checkpoint does not invent another implementation phase while manual acceptance is pending.

Defensible description: **“Built a TypeScript multi-agent recovery simulation with model-selected specialist delegation, durable cross-party evidence, guarded PostgreSQL effects, operator corrections, scoped evaluated instruction activation/rollback, and reproducible saved-output evaluation.”** Mention the synthetic environment and sample limits when discussing results; do not claim real collections lift, production business authentication or autonomous model-weight improvement.
