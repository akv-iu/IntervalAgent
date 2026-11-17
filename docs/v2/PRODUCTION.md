# Hosted V2 demo

The homepage and `/v2` render the same workspace. `/customer` retains the original V1 dashboard. This deployment uses synthetic records and simulated financial effects; it does not establish that the live acceptance failures in [STATUS.md](STATUS.md) are fixed.

## Vercel configuration

Production requires these server-only environment variables:

| Variable | Value |
| --- | --- |
| `V2_ENABLED` | `true` |
| `V2_PUBLIC_ORIGIN` | `https://interval-agent.vercel.app` |
| `V2_DATABASE_URL` | Restricted login to a separate Neon database named `intervalagent_v2`, with `sslmode=verify-full` |
| `V2_OPENAI_API_KEY` | Configured V2 model key |

Vercel supplies `VERCEL=1`. Hosted configuration reads its environment, never local `.env.v2`. Local development retains the existing loopback database restriction and `.env.v2` setup. Preview deployment hosts are rejected unless explicitly configured as the public origin in their own environment.

Run the existing `v2:migrate` command once with the hosted settings and a database-owner connection to the dedicated V2 database. Do not give the owner connection to the deployed app. The runtime login needs `CONNECT` on that database, `USAGE` on `rebuild_v2`, and `SELECT`, `INSERT`, `UPDATE`, `DELETE` on its tables. It needs no schema/table creation, role management or V1 table privileges. V1 records and local V2 histories are not migrated into the public demo.

Requests require the exact configured HTTPS origin/host; writes additionally require the matching Origin header. Sessions use random, hashed workspace tokens in HttpOnly, Secure, SameSite=Strict cookies. Existing expiry, admission, turn, call and per-workspace controls remain enforced.

Hosted chat and learning share a $5 lifetime accounting cap in PostgreSQL. Each model request reserves $0.02 atomically; known usage reconciles the reservation, while failed/unknown calls retain it. It is conservative application accounting, not a guarantee about the provider invoice. Set a separate provider spending limit as well. Rebuilding, reloading or resetting a workspace does not replenish the shared budget.

After settings or source changes, deploy and verify the actual production domain: homepage/workspace CSS, session creation, both businesses, authenticated history reload, cross-origin rejection, and one bounded model turn. A successful build alone does not verify these paths.
