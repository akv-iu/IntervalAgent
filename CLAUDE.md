# Working rules

Read [Collections Simulator PRD.md](<Collections Simulator PRD.md>) for scope and [SPEC.md](SPEC.md) for implementation. PRD wins on scope; keep the documents consistent. [DEMO-NOTES.md](DEMO-NOTES.md) holds the pitch and design review.

Complete one narrow example of each job responsibility before adding depth. Documents describe planned behavior until verified in code.

## Rules

- TypeScript strict, Next.js App Router, Node.js, PostgreSQL with pg, SQL migrations, Vitest, Zod, OpenAI SDK. No ORM or second provider.
- Scripted personas and one live agent model. Mock first; test replay with small fixtures before recording live evidence.
- Eval and picker runners produce typed JSON artifacts without a database. A small importer persists them. No pluggable sink framework.
- Integer cents for money; installment amounts must sum exactly to the balance. Store UTC instants; check quiet hours in the account timezone.
- Seed randomness. No wall clock or random IDs in prompts. Always show source mode and run provenance.
- Guards read customer text, never hidden persona state. Evaluators can use ground truth. The simulator must not silently fix behavior being evaluated.
- Pin one recording set. Missing/mismatched recordings fail closed; never search other folders or fall back to live calls.
- Separate demo/eval accounts. Seed by stable key without truncation. Imports are transactional and reject duplicate run IDs.
- Public pages read PostgreSQL only. No LLM imports in their dependency graph, LLM credentials on the host, or write endpoints, except the Try page exception below.
- Single exception (Akshay, 2026-10-16, widened 2026-10-17): `src/app/api/live/route.ts` powers the Try page and is the only app file that reaches LLM code or writes to the database. `tryMode()` decides where it runs; anything else is a 404.
  - Local: APP_MODE=local on the host and in `.env`; the key comes only from the `.env` file; per-minute and per-process token limits. May turn lessons off and delete them.
  - Public (open to anyone, Akshay's decision): the host opts in with APP_MODE=public, PUBLIC_TRY=live, its own `TRY_OPENAI_API_KEY` and `TRY_OPENAI_MODEL` (a separate OpenAI project with a small hard spend limit), and `DATABASE_URL_LESSONS`, a login that can only add lessons, count their uses and record daily token use (db/ops/try_writer_role.sql). Limits: per visitor per minute, per request, and a daily token cap shared through the `try_usage` table. Visitors cannot turn lessons off or delete them. Pages still read through the read-only login.
  - Never put `OPENAI_API_KEY` or the owner `DATABASE_URL` on the host. tests/import-graph.test.ts and tests/try-mode.test.ts enforce the rest.
- No secrets in git, logs, or artifacts. Ignore .env* but explicitly allow .env.example.
- No network in unit tests or replay CI. Keep tests/db excluded from npm test regardless of env. Explicit npm run test:db uses only TEST_DATABASE_URL and fails if it is missing. Test risky behavior and known regressions, not implementation trivia.
- No fabricated results, forced live baseline failures, legal-compliance claims, or real-world lift claims. No em dashes in project copy.
- Use a short shortcut: comment for a deliberate implementation limit and its upgrade trigger.

## Four slices

1. Early integration: mock conversation core, one-account bulk artifact, final migration/seed/importer, and basic Customer metrics/conversation detail. Request DB access during scaffold. Reuse these modules in the final app.
2. Evidence: complete scenarios/checks, live adapter, recording/replay, independent replay CI job, picker train/test comparison. First live call only after credentials and spending controls are ready; start with two scenarios. Live access gates release, not product work.
3. Product: expand bulk data, finish queries, remaining pages and CSV. Bulk uses fixed sms/friendly/10:00 local settings and never consumes picker artifacts. Explicit test:db and production build.
4. Ship: selected live recordings, regression evidence, read-only deployment, README, rehearsal. Validate the PRD release checklist.

Create commands when functional. No success-returning stubs or knowingly broken replay job before recordings exist. Replay is required in CI before release. Keep changes reviewable; do not commit or push solely because a phase ended.

## Record evidence

Create DEVLOG.md when implementation starts. Record changes, commands and actual outcomes, manual checks, corrections after review, and remaining limits. Distinguish automated checks from Akshay's own review. Use this for the AI-assistance section; never invent contributions.

Use agreed defaults and engineering judgment for reversible choices. Ask only for genuinely missing credentials, external-account actions, or unapproved scope decisions. Continue independent work while waiting. Do not seek repeated approval for this agreed simplification.

## Execution, review, and browser checks

- Plan: [docs/superpowers/plans/2026-10-15-recovery-lab.md](docs/superpowers/plans/2026-10-15-recovery-lab.md). Claude implements every task inline. No Claude reviewer subagents.
- Code review is done by Codex, not Claude, always with model `gpt-6.1-sol`: `env -u OPENAI_API_KEY codex exec -m gpt-6.1-sol -s read-only --ephemeral -o .superpowers/review-tN-K.md "<prompt>"`, then read only that output file. Codex must run on the ChatGPT login, never an API key: always strip `OPENAI_API_KEY` from its environment. (`codex review --uncommitted` rejects a custom prompt, so it is not used.)
- Two Codex checks per task, both before the commit:
  1. Check 1 (implementation review): after the task's tests pass, review the uncommitted changes against the task, its FR/NFR IDs, and SPEC. Bugs and spec violations only, max 10, one line each. Fix confirmed findings test-first.
  2. Check 2 (verification): after fixes, Codex re-reviews the same changes to confirm each finding is fixed and nothing new broke. If check 2 finds something, fix it and note it; no third loop unless it is critical.
- Final check: after all tasks, one Codex review of everything since the initial commit `7a7374c`.
- Keep review output short: never paste full Codex logs into context or docs; summarize findings in one line each.
- DECISIONS.md: after each task, add a plain-language entry for Akshay: what went wrong, what Codex said, what was fixed and why it matters. No jargon without a short explanation.
- Work directly on `main` (no feature branches). Before a push, scan tracked files for secrets.
- One task per turn. After each task, stop and give Akshay a short summary of what the stage does and how to verify it. Do not start the next task until he says "move". When he says "move", push `main` first, then start the next task.
- No `Co-Authored-By` trailer in commit messages and no AI attribution lines in PR descriptions.
- Akshay does all browser testing. Do not use browser automation tools. When a page needs checking, start `npm run dev` if needed, then give Akshay a short checklist (URL, what to click, what to expect) and wait for his results.

## Before declaring done

Run typecheck, offline tests, explicit test:db, pinned replay, and production build. Akshay checks the deployed pages in a private window, CSV, and a hand-calculated reporting example. Establish green replay CI before the temporary guard mutation; verify the independent replay job fails for quiet_hours, return to the restored working branch, confirm green. Never merge the broken branch. Tick release checks from evidence, not file existence.
