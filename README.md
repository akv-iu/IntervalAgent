# Recovery Lab

A planned collections simulation demonstrating AI outreach evaluation, a learning outreach picker, and PostgreSQL reporting in a Next.js dashboard.

**Status: documentation only.** There is no runnable app, measured result, or live deployment here yet.

## Plan

- [Scope and release checks](<Collections Simulator PRD.md>)
- [Implementation specification](SPEC.md)
- [Working rules](CLAUDE.md)
- [Pitch, tradeoffs, and design review](DEMO-NOTES.md)

The first release covers one fictional business, 12 eval scenarios, 100 synthetic dashboard accounts, and three pages: Customer, Evals, Picker. A live LLM writes outreach; scripted personas make customer behavior repeatable. The picker learns channel, window, and tone against a synthetic payment reward.

No real messages or payments are sent. Results describe a simulation, not real collection performance or legal compliance.

## Complete this README at release

Replace this planning section with verified evidence:

1. Live site and one-sentence purpose.
2. Actual baseline versus guarded eval table, recording-set ID, model, and scenario count.
3. Held-out picker results, sample counts, and synthetic-reward limitation.
4. Architecture: runner -> JSON artifact -> PostgreSQL -> read-only pages; recordings -> replay CI.
5. Two tested setup paths: keyless/database-free evals; dashboard with PostgreSQL, migrations, seed, and imported artifacts. Document offline npm test separately from npm run test:db, which requires a dedicated TEST_DATABASE_URL. Do not promise a database-free dashboard.
6. Intentional regression evidence and restored green result.
7. Actual AI assistance, Akshay's own checks, and decisions he can explain, drawn from DEVLOG.md.
8. Limits and concrete next steps. Optional two-minute video.

Do not publish invented metrics, placeholder links, or untested setup commands.
