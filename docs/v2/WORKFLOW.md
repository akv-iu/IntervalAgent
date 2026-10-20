# Four-role mock workflow

V2 development lives on `v2`; `main` is reserved for V1 production maintenance. This phase runs four deterministic role functions, not four live language models. The public V1 pages are unchanged.

## Try it offline

```powershell
npm run workflow:v2:mock
npm run workflow:v2:mock -- --reject-once
npm run workflow:v2:mock -- --business subscriptions --missing-policy
```

These commands use the existing labeled development records, require no database or credentials, and print JSON containing internal envelopes, tool operation keys and the result. IDs/time are fixed for repeatability. `--reject-once` explicitly injects unsupported wording into the first draft so the review/correction path is visible. `--missing-policy` injects a missing record; it is not evidence of a real outage. Unknown flags/businesses fail.

## What runs

1. Customer sends the accepted customer text to Coordinator as untrusted task data.
2. Coordinator requests account history and effective policy from Investigator.
3. Investigator reads the scoped tools concurrently and reports evidence or uncertainty.
4. Coordinator requests a pending-review draft from Customer.
5. Customer sends that draft to Reviewer. It contains no financial proposal.
6. Reviewer checks the fixed mock wording and evidence. Unsupported wording triggers targeted policy reinvestigation and another draft. Missing evidence escalates immediately. After at most two correction cycles, unresolved review escalates.

This is a fixed mock routing demonstration. Its Reviewer uses an exact acknowledgement/evidence check, not general language understanding. It does not resolve payment matching, calculate a proposed adjustment, or demonstrate model-selected delegation. The $14 resolution and financial approval workflow remain later work.

## Durable worker

The existing [worker command](WORKER.md) runs the same workflow against scoped persisted case snapshots. Migration 010 adds private, append-only `v2_agent_messages`. Every envelope links business/workspace/account, case/run/task, parent, sender/recipient, evidence and a stable operation key. Scope, permitted routes, parent ownership and observed tool evidence are validated before insertion. Existing visitor/operator APIs do not expose this internal timeline yet.

A new run pins the accepted source text, four mock instruction versions/texts, policy, record hash and an explicit `none` lesson version. Unsupported instruction snapshots fail rather than silently substituting current code. In-flight legacy `mock-investigation-2` runs retain their two-tool behavior. New `mock-workflow-1` runs reuse stored outputs and successful tools after lease recovery; envelope timestamps record the actual persisted step time and remain unchanged on reuse. Only trusted synchronous mock functions execute inside the checkpoint transaction; do not attach an external provider there. Unavailable tools get one separately counted retry; valid missing results do not.

There are at most 18 persisted mock messages per run, enough for the normal six-message path, two five-message correction cycles and a final escalation. Deadline, lease, case revision, STOP and existing tool caps still apply. Mock role functions consume zero model requests/tokens; those counters must describe provider dispatches, not role names. Existing model accounting primitives are not connected to a dispatcher.

Both approval and escalation end at `awaiting_human`. A mock Reviewer approval is an internal acknowledgement check, not operator approval. No customer reply is published, no ledger is changed and no lesson becomes active. The next phase must connect substantive billing evidence/proposals and model dispatch accounting before claiming model-backed four-agent behavior.
