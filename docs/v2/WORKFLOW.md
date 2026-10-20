# Four-role mock workflow

V2 development lives on `v2`; `main` is reserved for V1 production maintenance. This phase runs four deterministic role functions, not four live language models. The public V1 pages are unchanged.

## Try it offline

```powershell
npm run workflow:v2:mock
npm run workflow:v2:mock -- --reject-once
npm run workflow:v2:mock -- --business subscriptions --missing-policy
```

These commands use the existing labeled development records, require no database or credentials, and print JSON containing internal envelopes, tool operation keys and the result. IDs/time are fixed for repeatability. `--reject-once` explicitly injects unsupported wording into the first draft so the review/correction path is visible. `--missing-policy` injects a missing record; it is not evidence of a real outage. Unknown flags/businesses fail.

## What runs now

1. Customer sends the accepted customer text to Coordinator as untrusted task data.
2. Coordinator requests account history, invoice details, payment search, adjustment history and effective policy from Investigator. Multiple invoices are not silently reduced to the first one.
3. Investigator reads independent tools concurrently and reconciles their records, existing allocations/credits, available settled payment and cancellation eligibility. Missing, contradictory or ambiguous evidence produces explicit uncertainty.
4. Coordinator requests a pending proposal from Customer using the structured finding.
5. Customer proposes the verified candidate allocation/eligible credit and a projected balance, with versioned evidence and mandatory human approval.
6. Reviewer recomputes the existing code-based proposal preview from observed records and checks the finding, proposal, evidence and fixed pending wording. Rejection names the relevant billing tools for reinvestigation. After at most two correction cycles, unresolved review escalates.

The reference Northside case proposes a $50 allocation plus a policy-eligible $20 credit against $84, leaving **$14 pending approval**. Harbor Subscriptions uses the same runtime with a one-day cancellation window; its three-day cancellation is ineligible, so only the $50 allocation is proposed, leaving **$34 pending approval**. Existing allocations/credits reduce what can be proposed; nothing is applied again. These are synthetic development examples, not independent model evaluation.

This remains fixed mock routing and deterministic text, not general language understanding or model-selected delegation. Automatic proposals require one invoice, at most one available settled payment and at most one eligible cancellation; ambiguity or an unsafe preview goes to a human. Record/customer text cannot choose tools or authorize effects. Standalone preview/approval capability is not inferred from a successful Reviewer result.

## Durable worker

The existing [worker command](WORKER.md) runs the same workflow against scoped persisted case snapshots. Migration 010 adds private, append-only `v2_agent_messages`. Every envelope links business/workspace/account, case/run/task, parent, sender/recipient, evidence and a stable operation key. Scope, permitted routes, parent ownership and observed tool evidence are validated before insertion. Existing visitor/operator APIs do not expose this internal timeline yet.

A new `mock-billing-1` run pins accepted source text, four billing instruction manifests, scoped business/snapshot/invoice context, policy, record hash and explicit `none` lesson version. Unsupported instruction snapshots fail rather than silently substituting code. In-flight `mock-investigation-2` and `mock-workflow-1` runs retain their prior two-tool behavior. New runs reuse outputs and successful tools after lease recovery; timestamps retain each persisted step time. Only trusted synchronous mock functions execute inside the checkpoint transaction; do not attach an external provider there. Unavailable tools get one separately counted retry; valid missing results do not.

There are at most 18 persisted mock messages per run, enough for the normal six-message path, two five-message correction cycles and a final escalation. Initial billing uses five tools; each financial correction requests four relevant tools, so two cycles use thirteen calls before any transient retries. The shared sixteen-tool cap can pause earlier if retries exhaust it. Deadline, lease, case revision and STOP still apply. Mock role functions consume zero model requests/tokens; existing model accounting is not connected to a dispatcher.

Both approval and escalation end at `awaiting_human`. A mock Reviewer approval is an internal proposal check, not operator approval. The pending proposal/preview is stored only when it matches the reviewed draft and a fresh preview against the scoped case facts. Missing/altered proposals, wrong projected balances and completed-action wording cannot commit as reviewed results. No customer reply is published, no ledger is changed and no lesson becomes active. Provider dispatch/output checkpoints, human approval/actions and UI remain later work.
