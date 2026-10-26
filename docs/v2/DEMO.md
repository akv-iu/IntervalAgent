# V2 demonstration walkthrough

Use the `v2-rebuild` worktree at `D:\Projects\IntervalAgent-v1-rebuild`. Follow [LOCAL-DEMO.md](LOCAL-DEMO.md) to start the local database/app, then open `http://127.0.0.1:3012/v2`. Use your own unexpired private workspace; do not reset a workspace whose history you want to retain. All people, balances, business replies and payment outcomes are synthetic. Live chat/retry/learning comparison uses the configured paid API; opening the preview and offline replay does not.

## 1. Start from the customer's view

Choose Northside / Alex in the client navigation. A fresh case starts with labelled synthetic business outreach. You play Alex in the central chat; **Business** opens the separate inbox, **Review** opens operator controls, and **Details** opens source policy/outreach/records. These actors retain separate channels and permissions even though one tester can play them. Actual activity is above the composer; **View steps** expands its call history.

Say `I have paid`. The orchestrator should collect missing invoice/payment details. Then give the matching invoice, amount and today's date, for example `It was INV-101, $129 today by card`. When the dated snapshot cannot establish receipt, inspect the model-selected Business Verification request and handoff light. There is no model process left polling while the business is silent. Runtime shows actual calls/tool requests and retains the latest run until the next message/retry.

Answer the specific business request in its inbox. A clear settled confirmation can support a reviewed existing-payment proposal under Northside's explicit policy. A bare answer cannot fill facts the question did not state. The agent must not treat a missing old record as proof of nonpayment, or the customer's claim as a receipt.

## 2. Show disagreement and meaningful human review

On a separate ready case with the same claim, answer as the business `Only $50 was paid`. If date/settlement are incomplete, expect an attributed business report and opportunity to dispute, not fabricated financial confirmation. Then dispute it as the customer. Automatic replies pause with saved claim/evidence/request linkage for the operator; later messages remain saved. Inspect the packet, original attempt and Reviewer findings before deciding or resuming.

For Cedar, complete business confirmation still requires operator authority before recognition. **Take over this case**, inspect evidence and use the eligible **Operator financial decision** control with a synthetic note/reference. The decision is recorded without a new charge or model call. Resume/retry requests an explanation only; it cannot replay an effect.

## 3. Show options, consent and durable effects

On a ready case ask `Can I pay the full remaining balance by card in two monthly installments starting today?`. Account Resolution can use the calculation tool; Reviewer checks the result. Inspect the saved offer's exact cents/dates. A proposal is not consent, and chat acceptance alone does not execute payment.

Use the explicit reviewed-proposal confirmation, then separately choose a labelled demo processor outcome and simulate the due installment. Only success creates a simulated receipt/reduces balance. Failed permits a separate explicit attempt; pending/unknown needs operator reconciliation. Reload to demonstrate persistence. Original attempts remain in history after reconciliation. Credits and local-receipt reversal are explicit operator decisions, not hidden prompt edits or real refunds. Future installments/events do not execute automatically.

## 4. Show evaluated improvement without promising a gain

Save concrete role feedback under **Correct this case**. That pauses the case and affects only its explicit corrected retry. Under **Evaluated agent learning**, use the matching role/scope to propose a reusable lesson, inspect the diagnosis, and compare it with the current version. The software harness evaluates separate targets, regression and safety cases; Reviewer cannot activate itself. Unsupported/unsafe suggestions and data/tool repairs stay rejected.

Inspect the live comparison before explicit activation, rejection or rollback. A tie or failed target stays ineligible even if the proposed rule sounds sensible. Activated versions affect subsequent matching jobs and remain business/workspace-scoped. Audit/history retain original outputs and version IDs. The project changes instructions, not model weights.

For a free, reproducible evidence demonstration run `npm run eval:v2:replay` and open `results/v2-replay/report.md`. Expect the captured customer comparison **2/4 -> 4/4**, the Reviewer comparison **2/4 -> 3/4, ineligible**, and rejection of the unsafe suggestion. Replay PASS means those saved outputs/verdicts reproduce, not that the Reviewer candidate passed or a current model was rerun.

## 5. Connect the preserved V1 outreach experiment

Open **Details**, then **Outreach strategy: V1 policy preview** below the source/policy disclosure. There is deliberately no default overdue age because V2 records do not contain one. Pick a hypothetical group:

| Days overdue in the preview | Frozen channel | Local time | Tone |
| --- | --- | --- | --- |
| 1-30 | SMS | 10:00 America/Denver | Friendly |
| 31-60 | SMS | 18:00 America/Denver | Friendly |
| 61-90 | SMS | 10:00 America/Denver | Formal |
| 91-120 | SMS | 10:00 America/Denver | Friendly |

Inspect **Policy provenance**: source run, version, seeds, synthetic reward basis, train/test sample counts and source hash. Changing the group makes no API call, contact event or state write. Changing client clears the hypothetical group. The shared benchmark is not a business-specific lesson or permission to disregard saved email/call preferences, missing contact details, STOP or operator control. The original V1 experiment remains at `/picker`; its latest imported run may differ from this pinned snapshot.

## Phase 5B manual/UI acceptance for Akshay

1. Refresh `/v2`, create a workspace only if the old one expired, choose **Details** and open the outreach disclosure. Confirm no recommendation appears until you choose an age group.
2. Choose **31-60** then **61-90** and compare the time/tone with the table. Expand provenance and verify it says synthetic V1 training with the frozen source run, not new training for this business.
3. Change client/business. Confirm the age selection clears and saved customer/business history, balances and events remain unchanged. A case already stopped/held should show the corresponding notice after choosing a group.
4. Check the select/disclosures/link by keyboard and at narrow width; confirm text/hash fits. `/picker` is an existing V1 reporting page and needs its own imported V1 dataset.
5. Confirm Cedar's source/policy text refers to operator review, rather than saying approval is unavailable. No paid conversation/learning test is required for this 5B acceptance.

Model routing and wording can vary. Report a missing investigation, unsupported receipt, incorrect escalation or awkward handoff rather than expecting exact scripted replies. Broader twelve-case/live/browser acceptance remains separate from the automated checks and this short demonstration. See [ARCHITECTURE.md](ARCHITECTURE.md) for responsibilities, persistence and the two learning paths, and [STATUS.md](STATUS.md) for measured evidence and limits.
