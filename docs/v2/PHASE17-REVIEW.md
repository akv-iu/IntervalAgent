# Phase 17: visible investigation and pending proposal

Status: implemented locally; automated checks complete, user browser acceptance pending. Phase 16 is pushed as `3b9a2b2` on `v2`; production `main` remains `61b7ece`. Akshay approved this phase after the October 20, 7:28 PM Mountain usage checkpoint. No application database activation, live API call or deployment is included.

## Result and boundaries

The customer case now has a separate Agent activity section: chronological saved role handoffs, parent-step references, bounded findings/review summaries, tool outcomes, expandable cited evidence, pending proposal, execution state and resource provenance. Customer chat still contains only deliberately published customer-facing messages. Reviewer acceptance is draft review; all proposed financial effects remain pending human approval.

`GET /api/v2/cases/{caseId}/activity` uses the existing visitor authentication, host check, rate limit and private/no-store response. A read-only repeatable-read transaction rechecks the session and scopes all reads by business/workspace/case. New migration 012 defines three allowlisted views. The web grant script adds only SELECT on these views; raw snapshots, prompts, requests, agent messages, job results and lease/worker identities remain denied. Only disposable schemas and temporary roles in `TEST_DATABASE_URL` were used for migration/grant checks.

The latest investigation is bounded by existing storage limits: 18 role messages and 28 attempt slots. At most 200 evidence records are resolved; truncation is explicit. Invoice details show at most eight lines, also labeled when truncated. Missing/stale evidence versions are marked unavailable. Older runs remain stored; paged historical run browsing is deferred. Activity polls independently of transcript revisions, pauses on hidden pages, backs off and shares the existing Retry-After gate. Scope changes/unmount abort requests; a newer case revision hides an older proposal immediately.

A pending proposal needs a succeeded latest job, the matching current case/policy revision, an unsuppressed case awaiting human review and a recomputed valid preview. Model-test results additionally require the saved approving application guard. Both server and client enforce the current-proposal state contract. Mock/model-test/unavailable provenance is explicit. Known reported usage, unknown attempts, held capacity and charged budget are distinct; test-workflow usage is not a verified live-model or currency-cost claim.

## Two self-review and verification passes

1. The first database run failed five proposal-read cases. The preview helper expects an exact account scope; passing the full case record violated its strict schema. Fixed that shared call. Review also made the activity response advance parent case state without regressing a newer revision, labeled parent-step numbers, and rejected missing projected amounts instead of converting null to zero. Both business-policy tests then returned the expected $14/$34 pending balances.
2. Rechecked scoping, session revocation, raw database privileges, cancellation/new-input races, provenance, unknown accounting, tool failures and UI recovery. Added the matching client proposal invariant and an explicit model-test guard requirement. Corrected queued retry wording so an already-attempted task is not called unclaimed, and reused the parent retry gate across chat/activity. Lint caught a render-time clock call; removed it. PostgreSQL rejects writes to non-updatable views with `55000`, before a privilege error; corrected the test to verify absent INSERT/UPDATE/DELETE grants directly as well as rejecting writes. This was a test-expectation fix, not an added privilege.

These are two self-review/fix passes by the implementing assistant, not independent agent/model reviews.

Automated evidence: 798 offline tests in 57 files; typecheck, lint and production build; 11 activity database cases plus 18 existing visitor regressions (28 passed together; a targeted two-test pass rechecked formatted evidence and added unavailable-tool coverage, for 29 distinct passing DB cases); pinned V1 replay release gate. All 19 server build manifests exclude environment/private evaluation files; changed document links and whitespace checks pass. Activity coverage includes empty/queued/in-progress snapshots without case revision changes, both businesses, stale/STOP proposals, cross-workspace access, private-field omission, missing/foreign evidence, unknown model-test usage, lease expiry, escalation and unavailable tools. Client/render checks cover strict response/scoping bounds, abort/429 behavior, safe text escaping, pending money, test provenance and current-proposal invariants.

No browser automation was used. A real isolated mock setup is the next approval boundary; migration 012 and new view grants are not applied to the application database. Do not give Akshay a default-off URL as a functioning acceptance test. After setup, he should check refresh/recovery, all four roles, evidence expansion, the two pending balances, STOP/new-input invalidation, narrow layout and keyboard focus. No operator decision control or financial effect exists yet.

## Design and delivery gate

Antislop: during, existing session override. Retain the user-confirmed white/blue/Barlow direction: white `#ffffff`, ink `#2b2827`, muted `#6b6765`, blue `#0067cc`, divider `#e2e0df`. Energy 1 / rhythm 1 / motion 1. Conversation stays first; a border separates saved internal activity below it. Native details reveal evidence and resource use without competing with chat. Proposal amounts use the shared money formatter; no new assets, icons, branding, theme or animation. Source: [antislop skill](../../.codex/skills/antislop/SKILL.md).

The user's explicit instruction assigns browser checks to him. Source/render checks below do not claim a completed browser/visual delivery gate.

| Gate | Evidence / status |
| --- | --- |
| R-01 | PASS: no gradients. |
| R-02 | PASS: scoped source/text checked for em dashes. |
| R-03 | Pending user browser check: one-column, wrapping source layout; no measured overflow claim. |
| R-04 | PASS: no icons added. |
| R-05 | PASS: conversation, pending proposal and saved investigation have distinct headings and hierarchy. |
| R-06 | PASS: retained approved Barlow. |
| R-07 | PASS: retained white background. |
| R-08 | PASS: no decorative arrows. |
| R-09 | PASS: no badges. |
| R-10 | PASS: no glass. |
| R-11 | PASS: reused rounded-md controls. |
| R-12 | PASS: no shadows. |
| R-13 | PASS: no glow. |
| R-14 | PASS: no decorative cards. |
| R-15 | PASS: Refresh activity has a handler; record/resource details use native controls. |
| R-16 | PASS: mocks, pending changes, missing evidence and unknown usage are labeled. |
| R-17 | PASS: money/resource data comes from validated scoped storage; tests verify $14/$34. |
| R-18 | PASS: no testimonials. |
| R-19 | PASS: no animation. |
| R-20 | PASS: extends the existing case workspace and identity. |
| R-21 | PASS: retains the approved light theme. |
| R-22 | PASS: no illustrations. |
| R-23 | PASS: no new assets/navigation; approved existing direction. |
| R-24 | PASS: existing navigation unchanged; no new page link or dead approval action. |
| R-25 | PASS for retained text tokens: ink/muted/blue on white; no new color pairing. |
| R-26 | PASS in source: refresh handler and native details are implemented; browser interaction remains pending. |
| R-27 | PASS in source/render tests: loading, empty, failed, pending, missing and expired states. |
| R-28 | PASS: no FAQ. |
| R-29 | PASS: existing neutral palette with one blue accent. |
| R-30 | PASS: billing evidence and role handoffs follow the approved workspace. |
| R-31 | PASS: layout/type/color reasons recorded above. |
| R-32 | Pending user keyboard check: native summary/button controls, headings and existing focus styles. |
| R-33 | PASS: source edited directly with patches. |
| R-34 | PASS: no new theme/toggle. |
| R-35 | Build PASS; browser click-through pending Akshay's assigned test. |
| R-36 | PASS: no measured performance, live-model or applied-financial claims. |
| R-37 | PASS: approved direction and dials retained. |
| R-38 | PASS: explicitly synthetic stored records; untrusted text escapes in render tests. |
| C-1 | PASS: existing tokens, sessions, records, money formatter and retry gate reused. |
| C-2 | Code slice complete; browser acceptance and isolated setup remain open. |
| C-3 | PASS: activity/evidence/proposal each serve the selected dispute journey. |
| C-4 | Automated scope/STOP/retry/missing-data checks pass; visual resilience awaits browser acceptance. |
| C-5 | PASS: actual validation evidence and remaining limits are recorded separately. |
