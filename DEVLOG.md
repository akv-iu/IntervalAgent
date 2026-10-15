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
