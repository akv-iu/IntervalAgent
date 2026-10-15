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
- Public pages read PostgreSQL only. No LLM imports in their dependency graph, LLM credentials on the host, or write endpoints.
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
- Code review is done by Codex, not Claude. After a task's tests pass and before committing, `codex exec -s read-only --ephemeral -o .superpowers/review-tN.md "<review uncommitted changes; task N, FR/NFR IDs, plan path; bugs and spec violations only, max 10, one line each>"` and read only that output file (`codex review --uncommitted` rejects a custom prompt). Fix confirmed findings, note rejected ones with a reason in DEVLOG. At the end, run one whole-branch review with `--base main`.
- Keep review output short: never paste full Codex logs into context or DEVLOG; summarize findings in one line each.
- One task per turn. After each task, stop and give Akshay a review summary: what the task is, what was built, Codex findings, and exact commands to verify it. Do not start the next task until he approves.
- Akshay does all browser testing. Do not use browser automation tools. When a page needs checking, start `npm run dev` if needed, then give Akshay a short checklist (URL, what to click, what to expect) and wait for his results.

## Before declaring done

Run typecheck, offline tests, explicit test:db, pinned replay, and production build. Akshay checks the deployed pages in a private window, CSV, and a hand-calculated reporting example. Establish green replay CI before the temporary guard mutation; verify the independent replay job fails for quiet_hours, return to the restored working branch, confirm green. Never merge the broken branch. Tick release checks from evidence, not file existence.
