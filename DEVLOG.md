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
