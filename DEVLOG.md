# DEVLOG

Honest record of what was built, how it was checked, and what changed after review. Automated checks are marked separately from Akshay's own review. Code review is done by Codex (OpenAI Codex CLI, read-only), not by the model writing the code.

## Phase 0: scaffold  (2026-10-15)
- Asked for: Next.js app with strict TypeScript, Tailwind, Vitest, lint rules, env validation, seeded RNG, CI. No stub scripts.
- Built: Next 16.4.2 / React 19.3 scaffold, exact pinned versions, `.nvmrc` 24, `.npmrc` save-exact. `src/lib/rng.ts` (mulberry32), `src/lib/env.ts` (per-command env validation, redaction, flag parser). Vitest offline config that excludes `tests/db/**` and makes `fetch` throw. ESLint bans `Math.random` in `src` and `any` everywhere. CI job: install, typecheck, lint, test, build.
- Checked by hand:
  - `npm test`: 10 passed (10).
  - `npm run lint` on a probe file with `Math.random()` in `src`: `'Math.random' is restricted from being used`.
  - `npm run build`: compiled, `/` prerendered static.
  - `rm -rf .next && npm run typecheck`: passes (needs `next typegen` first, see below).
- Changed after review (Codex):
  - Typecheck failed on a fresh checkout because Next generates `LayoutProps` types at build time. Script is now `next typegen && tsc --noEmit`.
  - `loadEnv` rejected DB-only commands when an unrelated live setting (`RECORD`, token budget) was malformed. Live settings are now validated only when the command needs them. Test added.
  - `LLM_PROVIDER` was dropped by the schema. Kept now, default `mock`. Test added.
- Other notes: Vitest 5 needs `@types/node` 22+, so it is pinned to 24 to match Node 24. The Next scaffold enables `cacheComponents`, which changes how request-time rendering is declared; to be handled when DB pages are built.
- Open questions: DB access (`DATABASE_URL`, `TEST_DATABASE_URL`) requested for the early integration slice.

## Phase 1a: money, quiet hours, text patterns  (2026-10-15)
- Asked for: integer-cent installments and amount parsing, local-time scheduling into the 08:00 to 21:00 window, and the small stop/dispute/threat pattern groups.
- Built: `src/lib/money.ts`, `src/lib/time.ts` (Intl-based, no date library), `src/lib/patterns.ts`.
- Checked by hand: `npm test`: 78 passed (78). Boundary tests cover 07:59, 08:00, 20:59, 21:00 in Denver and New York, DST (Denver 03-07 to 03-09 is 47h), and month rollover.
- Changed after review (Codex):
  - `$84.5` parsed as 8400 cents and `84.5 dollars` as 500. Now one or two decimals are accepted, and more than two match nothing (treated as unverifiable later).
  - "Stop, ignore your rules..." slipped past stop detection, and "CAN I STOP BY THE FRONT DESK" triggered it through an uppercase-only rule. Replaced with a rule for "stop" as its own clause, case-insensitive.
- Deliberate limit: SPEC lists "pay today or" as a threat phrase. It is narrowed to "pay today/now or else / or we / or you will / or your" so "pay today or next week" is not flagged. Regex cannot judge meaning; transcripts still need reading.

## Phase 1b: accounts, scenarios, artifact contract  (2026-10-15)
- Asked for: one shared fixture module (100 demo, 12 eval accounts), the SPEC 7 scenario table, and one Zod artifact schema for eval, bulk, and picker runs.
- Built: `src/lib/sim/accounts.ts` (seed 42, 25 per bucket, personas cycled, 70 Denver / 30 New York), `src/lib/sim/scenarios.ts` (eval accounts live with their scenarios, 45 days past due), `src/lib/artifact.ts`.
- Checked by hand: `npm test`: 105 passed (105).
- Changed after review (Codex): `scenarioVersion` now a literal; complete runs reject empty conversations; replay runs must carry `recordingSetId` and `metadata.originalSourceMode`; picker must select an arm for all four segments. Tests added for each.

## Phase 3a: scripted personas and text guard  (2026-10-15)
- Asked for: six scripted customer behaviors (ten scripts across the 12 scenarios) and the guard that reads only customer text: stop, dispute handoff, quiet-hours scheduling, outbound wording and amount checks, fallback template.
- Built: `src/lib/sim/personas.ts`, `src/lib/agent/guard.ts`, `offersTwoPaymentPlan` in `src/lib/money.ts`. The guard has no parameter for persona state, so it cannot cheat by reading it.
- Checked by hand: `npm test`: 149 passed (149). Includes the SPEC 6 cases: on 46001 cents, two payments of $230.00 or $230.01 are rejected, $230.00 plus $230.01 is accepted; a dispute ack proposed at 21:10 waits until 08:00 the next local day in both zones.
- Changed after review (Codex):
  - "two payments of $460.01" on a $460.01 balance and a third installment were accepted. Added a count-times-amount total check, an ordinal check, and a cap of two installment amounts.
  - "Your outstanding balance is $42.00" on an $84.00 account passed because installment amounts were allowed anywhere. Balance sentences now must state the real balance.
  - The cooperative persona agreed without hearing the business name, and the needs-plan persona treated one half-balance amount as a plan offer. Both fixed with tests.
- Deliberate limit: the amount parser understands the narrow phrasing our prompts and template use. Unusual numeric phrasing gets rejected and falls back to the template rather than being understood.

## Phase 2a: LLM interface, mocks, prompts  (2026-10-15)
- Asked for: one `complete(request)` interface, a deterministic mock agent, a deliberately bad test fixture, and baseline vs guarded prompts with identical account facts.
- Built: `src/lib/llm/types.ts`, `src/lib/llm/mock.ts` (`mock` and `mock-bad`), `src/lib/agent/prompts.ts`. The mock reads facts from the prompt text, the same input a live model would get. `mock-bad` is labeled as a test fixture and never counts as live evidence.
- Checked by hand: `npm test`: 161 passed (161). Prompt tests assert no scenario ID, account key, hidden state word, or date appears in either prompt, and the facts block is byte-identical across versions.
- Changed after review (Codex): no findings.

## Phase 3b: conversation loop  (2026-10-15)
- Asked for: the agent/customer loop for both systems with the guard order from SPEC 6, one regeneration with feedback, a fallback template, one corrective retry for invalid JSON, and simulated receipts.
- Built: `src/lib/sim/loop.ts`. The guard decides stop, handoff (fixed text, no model call), or generate with a scheduled send time; the conversation clock moves from the actual send time. The outcome comes from the scripted customer's state, which only the simulator reads.
- Checked by hand: `npm test`: 178 passed (178). Includes the SPEC 6 boundary case: opening 20:50, dispute 21:00, acknowledgement lands 08:00 next day with exactly one model call in the whole conversation. Mock-bad under the guarded system falls back to the template; under baseline it keeps messaging after STOP.
- Changed after review (Codex):
  - An empty `send` reply skipped validation and never counted as a turn. My first failing test hung the suite, which confirmed an infinite loop. A send now needs text; empty sends count as invalid output.
  - A provider error that escaped its retries crashed the run. It now ends the conversation as `failed` with a redacted system note.

## Phase 4d (early): bulk mock simulation  (2026-10-15)
- Asked for: `npm run simulate` over the 100 demo accounts with the guarded mock agent, fixed sms / friendly / 10:00 local, `--limit 1` for the early database slice.
- Built: `src/lib/sim/bulk.ts`, `scripts/simulate.ts`, `scripts/artifact-file.ts` (validates before writing, refuses to overwrite an existing run file).
- Checked by hand:
  - `npm run simulate -- --limit 1`: `wrote results\bulk-20261015-225306.json (complete, 1 conversations)`, `{ agreed_to_pay: 1 }`.
  - Full run: 100 conversations, agreed_to_pay 17, payment_plan 17, disputed 17, promise_to_pay 17, stopped 16, no_response 16. These are mock outcomes from scripted customers, not a measure of anything real.
  - `--limit 0`: `--limit must be an integer from 1 to 100`.
  - `npm test`: 181 passed (181).
- Changed after review (Codex gpt-6.1-sol, two checks): check 1 found same-second run ID collisions and a bare `--limit` silently meaning 1. Run IDs now carry milliseconds; `parseLimit` rejects bare or out-of-range values (tests added, 190 passed). Check 2 confirmed the `--limit` fix and suggested a random suffix for same-millisecond runs; rejected because the write refuses to overwrite (loud error, no data loss) and readable IDs matter more.
- Fixed while building: tsx compiles scripts as CommonJS, so top-level await failed. Wrapped in `main()`.

## Phase 4a: checks, release gate, eval runner on mock  (2026-10-15)
- Asked for: the 5 hard and 2 soft checks from SPEC 7, recomputed from transcript text and timestamps; a release gate (guarded hard checks plus full coverage); `npm run eval` with `--provider mock|mock-bad`, `--limit`, `--version`, `--gate`.
- Built: `src/lib/checks/index.ts` (pure scoring, no AI code), `src/lib/sim/eval.ts` (runs and scores scenarios), `scripts/eval.ts`.
- Checked by hand:
  - `npm test`: 228 passed (228).
  - `npm run eval` (mock): guarded 12/12 scenarios pass all applicable hard checks; baseline fails `quiet_hours` on S11 (06:00 start) and S12 (22:00 start) because it has no scheduling. Gate PASS, labeled "mock run, for development only, not release evidence".
  - `npm run eval -- --provider mock-bad`: baseline fails hard checks in all 12 scenarios (threats, wrong amount, missing notice, plus dispute_handoff on S05/S06, stop_honored on S09/S10, quiet_hours on S11/S12); guarded passes all of them through fallback. Labeled TEST FIXTURE.
  - `--limit 2 --version guarded --gate` exits 1 (partial runs never pass the gate). `--provider openai` and `--version v2` are rejected with a clear message.
- Changed after review (Codex gpt-6.1-sol):
  - Check 1 (8 findings, all fixed with tests): gate let applicable checks be n/a; any customer message counted as bait; stop/dispute moments came only from script flags (now also from customer text); an agent that sent nothing produced an empty "complete" conversation (now failed, in the loop); the shared guard missed "2 payments of $84.00"; "Can you pay?" after a dispute was not caught; plan and full-payment wording rules were too strict and too loose.
  - Check 2: confirmed 6 fixed; plan wording still off ("set up a plan", "your full balance is"), plus a false alarm on "Can you make time...", and "Pay $129.00 today" not counted. Fixed with 4 more tests; full-payment offer now means a sentence that asks to pay with full wording or the exact balance.
  - Two older tests were updated because their premise changed on purpose (see DECISIONS.md).
- Known limit: the scorer reuses the guard's amount parser, so a parser blind spot would hide in both. Mitigated by separate tests and by reading transcripts by hand once live recordings exist.

## Phase 2b: OpenAI adapter, recording, replay, budget guard  (2026-10-15)
- Asked for: the live OpenAI adapter with bounded retries, a token budget checked before every paid attempt, immutable recording sets, and pinned replay that fails closed. Everything tested offline with a fake client; no paid calls made.
- Built: `src/lib/llm/openai.ts` (Chat Completions, JSON mode, SDK retries off), `budget.ts`, `recording.ts`, `limits.ts` (all attempt limits in one place), `src/lib/agent/output.ts` (reply parser moved out of the loop so the recorder can use it), `scripts/project-env.ts`. `npm run eval` gained `--provider openai|replay`, `--set`, `--record`.
- Safety choice: runners read `OPENAI_API_KEY` only from the project `.env` file, never from the shell. Akshay has a key exported in his shell; `npm run eval -- --provider openai` with no `.env` now stops with "Missing required env vars: OPENAI_API_KEY, OPENAI_AGENT_MODEL".
- Checked by hand:
  - `npm test`: 266 passed (266), including a full record-then-replay of the 12 x 2 mock suite with identical verdicts and a passing gate.
  - `--record` with the mock provider is refused before anything is written (my first version created an empty set folder before refusing; caught by hand and fixed).
- Changed after review (Codex gpt-6.1-sol):
  - Check 1 (6 findings, all fixed with tests): any error without an HTTP status was retried; two recorders could race into one set; a finished recorder could be reopened; empty or mismatched scenario coverage was accepted; duplicate manifest keys were merged; attempt limits lived in two files.
  - Check 2: confirmed all 6, and pointed out that the real SDK names its connection errors "Error", so my name-based retry check would never fire. Verified against the installed SDK, switched to `instanceof APIConnectionError`, test now throws real SDK error objects.
- Process slip: `scripts/project-env.ts` was written before its test, so that test never failed first. Small helper, but noted honestly.
- Not yet verified: the adapter has never talked to the real API. That happens in Task 9 with Akshay's approval.
