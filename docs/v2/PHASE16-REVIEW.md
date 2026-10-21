# Phase 16: customer chat and case status

Status: verified and pushed as `3b9a2b2` on `v2` following Akshay's October 20 advancement approval; production `main` remains `61b7ece`. Exactly four application roles remain unchanged. No application database, migration, worker activation, live model or deployment was used in this phase.

## Delivered and deferred

`/v2` starts/reuses a private visitor session and opens account 1's reference case. `/v2/cases/{caseId}` restores messages, polls persisted case state, sends messages with server revisions/stable retry keys, and sends priority STOP. It uses the existing API and credentials stay server-side. Failed session lookup does not create a replacement. Ending a session explicitly removes browser access without deleting cases.

Agent activity, evidence, run provenance, proposals, operator decisions and customer publication are not supplied by these screens. There is no new navbar link or approval control. Actual V2 setup/worker browser acceptance and Akshay's visual acceptance remain open. This does not complete Task 5.

## Review and verification

Self-review 1 corrected session-failure start handling, send-error persistence during polling, actual account labels and late STOP notices. Self-review 2 found retained state when Next restores a cached page and added workspace resets. Browser verification then exposed a stale read-error during business switching; added read/write/session-response fences and verified that delayed old-workspace responses cannot enter the new case. These were two self-review/fix passes followed by verification, not independent model/agent reviews.

Initial lint found unescaped JSX apostrophes; fixed. The first build failed because the existing shared navigation pathname hook suspended on the new dynamic route. The installed Next 16 guide specifies the Suspense boundary now used in the root layout. No blocking-route opt-out was added. Shared navigation targets became 44 pixels tall, and the synthetic-data footer now covers both businesses.

Final checks: 790 offline tests/56 files; typecheck/lint/production build; 22 focused client/routes/import tests; pinned V1 guarded replay/full-coverage gate; all 18 server manifests exclude environment/private evaluation assets. No DB suite rerun was needed for unchanged API/storage code. Existing Next tracing and Vitest configuration-loader warnings remain.

## Browser evidence

The assistant used the built Next app, with `V2_MODE=off`, through a temporary local fake HTTP proxy. The proxy returned scripted session/case responses without importing the application DB or model code. It was outside the repository; test services were stopped afterward. This verifies the browser client, not actual session cookies, storage, worker execution, OAuth or live models. The real default-off API was also checked directly and displayed unavailable.

| Interaction | Observed result |
| --- | --- |
| Business selector; Start reference case | Opens the reference case with an empty conversation; both business selections exercised. |
| Send message | Displays the saved customer text and actual returned case state; no generated reply invented. |
| Browser refresh | Restores the previously accepted message from fake HTTP history. |
| Workspace options; Open reference case | Returns to the same case; a stopped case stays stopped. |
| End session to change business | Shows explicit loss-of-access notice and business selector. |
| New business on cached route | New empty history; no prior-business message or stale read error. |
| Failed acknowledgement; Refresh access; Send again | Draft remains; saved message appears once. HTTP traffic confirmed identical retry keys. |
| 409 conflict; explicit resend | Draft remains; no automatic resend. Traffic confirmed revision changes from 1 to 2. |
| 429 limit | Send/refresh disabled during Retry-After; Stop contact remains enabled and succeeds. |
| Delayed normal send; Stop contact | STOP succeeds while ordinary send is pending; the late acknowledgement does not overwrite stopped state. |
| Delayed send; end/start another workspace | Old response does not add its message or error to the new business case. |
| Expired session; Start a new workspace | Case access ends visibly; new session creation requires the explicit start action. |
| Session GET failure; Refresh access | Error is recoverable; no Start button silently replaces the workspace. |
| Actual default-off API | Unavailable view, no workspace creation. |
| Keyboard Tab then Enter | Visible solid focus on Send message; Enter submits successfully. |
| Pending human review | Says no financial change was applied; does not show a draft as a sent reply. |
| Widths 320/390/768/1280; 300-character unbroken reference | No horizontal overflow; visible targets at least 44 pixels; mobile status precedes chat. |
| Console | No application console errors on successful QA flow. Expected HTTP failures were deliberately injected; an unrelated browser-extension warning was excluded. |

Existing V1 navbar destinations were inspected in source, not clicked through against the application database. V1 replay/offline checks passed. No screen-reader, load/latency or full real-backend browser acceptance is claimed.

Screenshots use fake HTTP, not a real worker/model: [desktop](screenshots/phase16-desktop.jpg), [mobile](screenshots/phase16-mobile.jpg). The browser returned JPEG bytes; file extensions were corrected during artifact verification without changing the images.

## Design and delivery gate

Antislop: during, existing user session override. Design Read: billing case workspace for demo customers, existing Recovery Lab white/blue visual language, energy 1 / rhythm 1 / motion 1. White `#ffffff`, ink `#2b2827`, muted `#6b6765`, action blue `#0067cc` and existing divider `#e2e0df` retain the confirmed identity. Barlow is retained for continuity/readability. Chat is the focal point; the secondary status column becomes the first section on mobile. Borders/spacing distinguish these jobs without decorative cards or animation. Existing light theme retained by user choice.

| Item | Status and evidence |
| --- | --- |
| R-01 gradients | N/A: none added. |
| R-02 punctuation | PASS: scoped text checked for forbidden em dashes. |
| R-03 mobile | PASS: checked 320/390/768/1280 widths, no overflow, long reference wraps. |
| R-04 icons | N/A: no new icons. |
| R-05 composition | PASS: conversation/status hierarchy follows the billing task; screenshots linked above. |
| R-06 typography | PASS: existing user-confirmed Barlow, no new font. |
| R-07 backgrounds | PASS: existing white reading surface, no decorative pattern. |
| R-08 arrows | N/A: no decorative control arrows. |
| R-09 badges | N/A: no badges added. |
| R-10 glass | N/A: none added. |
| R-11 radii | PASS: existing rounded-md controls and Thread bubble shape retained. |
| R-12 shadows | N/A: no shadows added. |
| R-13 glow | N/A: no glow added. |
| R-14 cards | N/A: no feature cards. |
| R-15 actions | PASS: Start/Open reference case, Send message, Stop contact and session actions have specific behaviors, exercised above. |
| R-16 copy | PASS: no model-quality or financial-effect claim; provenance unavailable is explicit. |
| R-17 numbers | PASS: reference account 1, server messages/revisions and the existing 500-character contract; no performance statistic in UI. |
| R-18 testimonials | N/A: none added. |
| R-19 motion | PASS: no animation added; focus/interaction only, consistent with motion 1. |
| R-20 identity | PASS: retained approved palette/type; case-specific conversation/status content. |
| R-21 theme | PASS: user confirmed the existing white-background style; no theme toggle introduced. |
| R-22 illustrations | N/A: none added. |
| R-23 assets/direction | PASS: user confirmed current style and advanced slice A; screenshots capture the actual QA UI, no brand assets invented. |
| R-24 navigation | PASS: new case/options/restart links navigated; no unimplemented navbar entries; existing V1 hrefs unchanged. |
| R-25 contrast | PASS: existing ink/muted/action-blue on white checked; input outlines use muted, not the pale divider. Disabled controls excluded. |
| R-26 controls | PASS: all new controls exercised in the interaction table; no dead approval action. |
| R-27 states | PASS: empty/loading, unavailable, expired, failed submit, conflict, limited, investigating and stopped states observed. |
| R-28 FAQ | N/A: none added. |
| R-29 palette | PASS: existing neutrals and one blue accent retained. |
| R-30 originality | PASS: extends Recovery Lab's confirmed style, no product clone. |
| R-31 reasons | PASS: design reasons above connect style/layout/spacing to reading and task priority. |
| R-32 keyboard | PASS for checked path: labeled selector/textarea, visible focus, Tab/Enter submission; broader screen-reader/user acceptance still open. |
| R-33 edits | PASS: source edited directly; temporary script only simulated HTTP, never rewrote UI/CSS. |
| R-34 themes | N/A: no new theme or toggle. |
| R-35 verification | PASS for slice: production build and recorded click-through; no real DB/worker acceptance implied. |
| R-36 claims | PASS: fake backend and unmeasured limits explicitly identified. |
| R-37 direction | PASS: user-confirmed white/blue/Barlow and Design Read/dials stated before edits. |
| R-38 authenticity | PASS: actual server-returned text, escaped React rendering; screenshots labeled fake HTTP. |
| Dials/focal point/accent/motif | PASS: calm conversation-led view, structural spacing, blue primary action/focus and existing Thread bubbles; screenshots show desktop/mobile hierarchy. |
| C-1 intentionality | PASS: existing Thread/PageHeader/tokens/APIs reused; no new dependencies/framework. |
| C-2 completeness | PASS for slice A: session/case/chat/status/STOP work with failure recovery; later slices explicitly absent. |
| C-3 composition | PASS: content determines chat/status layout, no marketing sections. |
| C-4 resilience | PASS for tested browser paths: revision conflicts, lost acknowledgement, scope changes, late responses, STOP and responsive checks above. |
| C-5 honesty | PASS: internal drafts are not customer replies, execution is not a financial outcome, no model evidence fabricated. |

Remaining risks/acceptance at this phase's completion: real isolated V2 DB/worker browser walkthrough, full screen-reader testing, long-history/load measurements and later activity/proposal/operator/financial workflows. No paid model call, deployment or new grants. Phase 16 was subsequently pushed as `3b9a2b2`; [Phase 17](PHASE17-REVIEW.md) adds activity/proposal code without claiming browser acceptance.
