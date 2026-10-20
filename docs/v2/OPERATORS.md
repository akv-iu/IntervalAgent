# V2 operator access

Operator login and business-scoped case reads are implemented behind a separate, default-off switch. There is no operator UI, case mutation, financial approval or lesson-management endpoint yet. Visitor cookies grant no operator access.

## Configuration and setup

Prepare a separate V2 database with the numbered migrations through 008 using the existing owner migration process. Do not run migrations with the web login or apply them to the V1 application database implicitly. As owner, provision the login defined in [v2_operator_role.sql](../../db/ops/v2_operator_role.sql), supplying its password outside source control. It can manage the private authentication tables, update request counters and read V2 cases/history; it cannot grant membership, read V1/visitor sessions, edit case facts/state or apply financial effects.

Set server-only environment values and restart Next.js:

| Variable | Required value |
| --- | --- |
| `V2_MODE` | `local` or `public`; missing/off disables all V2 access |
| `V2_OPERATOR_AUTH` | Exactly `true` to enable operator endpoints; missing/false returns 404 |
| `V2_ORIGIN` | Canonical application origin; HTTPS in public mode, HTTP only on loopback in local mode |
| `V2_OPERATOR_DATABASE_URL` | Dedicated operator login; no owner, visitor-web, reader or worker fallback |
| `V2_AUTH_SECRET` | Independently generated random secret of at least 32 characters; keep stable across processes |
| `V2_GITHUB_CLIENT_ID` / `V2_GITHUB_CLIENT_SECRET` | Credentials for your GitHub OAuth application |

Register exactly `V2_ORIGIN` + `/api/v2/auth/callback/github` as the GitHub application's callback URL. The maintained [GitHub provider](https://better-auth.com/docs/authentication/github) handles authorization-code exchange and state/cookie binding. The pinned Better Auth version is 1.7.11; it uses the supplied pg pool, private model names and no runtime migrations. Its transitive adapter implementation uses Kysely; application storage code remains pg/SQL.

## Login and owner-controlled enrollment

1. From the configured origin, POST JSON `{ "provider": "github" }` to `/api/v2/auth/sign-in/social`, with the exact Origin header. Navigate the browser to the returned `url`. The server fixes the post-login destination to `/api/v2/operator/session`; client-specified destinations, providers, tokens and principals are rejected.
2. Complete GitHub consent. A successful callback creates a database session, but `/api/v2/operator/session` returns 403 until the owner grants a business membership. Login never enrolls an operator automatically.
3. As owner, use [v2_operator_membership.sql](../../db/ops/v2_operator_membership.sql) with psql variables `github_account_id` (the stable numeric GitHub user ID, independently verified by the owner) and `business_id` (`northside` or `subscriptions`). Inspect its affected-row count and resulting membership. Emails and mutable usernames are not enrollment keys. Disabled operators remain disabled; re-enabling is a separate explicit owner action.
4. GET `/api/v2/operator/session` with that browser's cookie. It returns only `{ operatorId, businessIds }`, excluding user email, GitHub identifiers, session IDs and tokens.
5. POST JSON `{}` to `/api/v2/auth/sign-out` with the same-origin cookie/Origin to delete the database session and clear authentication cookies. Logout bypasses ordinary request limits.

Only those three authentication-library paths are exposed. Raw `/get-session`, registration, account linking, user deletion and all other library endpoints return 404. Password login is not configured and automatic account linking is disabled. GitHub access/refresh tokens are encrypted at rest; library session rows remain private authentication data. No provider token is returned by the custom operator endpoints. Library logging and telemetry are disabled.

## Protected case reads

GET `/api/v2/operator/cases/{businessId}/{workspaceId}/{caseId}` returns `{ case, facts, history }`. Scope is explicit in the path and checked against current database membership. Operators may read cases in any workspace of their granted business; a visitor's workspace cookie never grants that authority. Facts are re-scoped to that account, while history includes internal audit reasons/actor IDs for the authorized operator. Optional `afterRevision` (default 0) and `limit` (default 50, maximum 100) page history; `history.nextRevision` is the next event cursor. Case IDs/workspace IDs are lowercase slugs, at most 64 characters. Other query fields and duplicate parameters fail validation. No endpoint here updates case state or approves an action.

All responses are private/no-store. Incoming Host must match the canonical origin; forwarded host/protocol headers cannot change callback authority. Mutations require exact Origin, JSON of at most 4096 actual bytes and a five-second body-read deadline. GitHub callbacks are GET requests protected by the library's pending state and state-cookie checks. Failed callbacks return a generic 400 instead of forwarding provider details into an error redirect; successful authentication redirects use `Referrer-Policy: no-referrer`. Database-backed limits allow 60 sign-in/callback requests globally per minute and 120 ordinary requests per operator per minute. Limits are shared across processes, do not trust client IP headers and return 429/Retry-After. A busy or abusive client can exhaust the shared login allowance; deploy behind a suitable ingress limiter before opening login widely.

Operator cookies are distinct from visitor cookies and from explicit local-mode cookies. HTTPS cookies use `__Secure-v2-operator-public.session_token` in public mode, Secure/HttpOnly/SameSite=Lax/Path=/ and no Domain attribute. Sessions expire absolutely after eight hours, without refresh or a cookie session cache. Each protected request validates the database session and current membership. Deleting a session, disabling an operator, or setting a membership's `revoked_at` denies subsequent access immediately. Revocation does not delete accepted case history. Add an owner-operated expired-auth-record retention process before public scale; this phase does not run background deletion.

Missing/expired/forged sessions return 401; absent/revoked business membership returns 403; unknown cases return 404; unavailable configuration/database returns sanitized 503. The visitor API remains separately configured through `V2_WEB_DATABASE_URL`.

## Verification and remaining acceptance

Automated tests use the real authentication library and isolated schemas in `TEST_DATABASE_URL`. GitHub token/profile/email responses are simulated; no real OAuth account, provider credentials, or model call is used. Restricted-role checks prove authentication works while self-enrollment, case changes and V1 reads fail. Real GitHub redirect/consent/private-window logout still need a browser acceptance pass after credentials and an isolated local setup are available. They are not claimed as verified by the mocked callback test. Public V2 activation and deployment are separate work.
