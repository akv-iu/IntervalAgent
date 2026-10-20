# V2 visitor API

These endpoints connect a private anonymous demo workspace to the persistent mock worker. [Operator login and scoped reads](OPERATORS.md) have their own opt-in and credential. Model-backed agents, financial actions and a V2 browser interface are later phases.

## Configuration

The API is off unless `V2_MODE` is explicitly `local` or `public`; disabled handlers return 404. Incomplete/invalid enabled configuration returns a sanitized 503.

- `V2_ORIGIN`: one canonical origin, without credentials, path, query or fragment. Public mode requires HTTPS. Local mode permits HTTP only on `localhost`, `127.0.0.1` or `::1`.
- `V2_WEB_DATABASE_URL`: dedicated visitor-web login on a separately prepared V2 database with migrations 001-007 applied. There is no fallback to the V1 reader, lessons writer, migration owner or worker credential. [v2_web_role.sql](../../db/ops/v2_web_role.sql) defines its grants; apply it as the owner with a password supplied outside source control.
- Next.js uses its standard environment loading. Do not put database URLs in `NEXT_PUBLIC_*` variables. Restart the process after changing database/configuration values. The default deployment remains off; no production setup is implied by this document.

Public sessions use `__Host-recovery-v2` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and a 24-hour maximum age. Explicit local mode uses the separate `recovery-v2-local` cookie; HTTP local cookies omit `Secure`. No cookie has a Domain attribute. Tokens contain 32 random bytes; only SHA-256 hashes are stored. Expiry is absolute and checked against the database clock, not extended by repeated session starts or reads. Logout revokes the server record and clears the cookie. Expired, revoked, malformed, duplicate or unknown cookies grant no access.

## Requests

All writes require `Origin` to exactly equal `V2_ORIGIN`; the incoming Host must match its canonical host/port. Forwarded-host headers do not establish trust. JSON writes require `Content-Type: application/json`; actual body size is limited to 4096 bytes and body reads to five seconds. Do not send business/workspace/actor/role/principal fields beyond the explicitly listed session-business selection.

| Method | Path | Body / behavior |
| --- | --- | --- |
| POST | `/api/v2/session` | `{ "businessId": "northside" }` or `subscriptions`; creates a private server-assigned workspace and cookie (201). Same-business valid session returns 200 without renewing expiry. End the session before switching businesses. |
| GET | `/api/v2/session` | Returns the current business/workspace and expiry, never the token/hash/session record ID. |
| DELETE | `/api/v2/session` | Revokes the matching token and clears its cookie (204). |
| POST | `/api/v2/cases` | `{ "caseId": "case-1", "accountId": "account-1" }`; account-1 through account-3 are available. Creates a scoped synthetic-record snapshot (201). Same ID/account is idempotent within this workspace. |
| GET | `/api/v2/cases/case-1` | Returns current case state, customer/agent transcript messages and a revision cursor. Optional `afterRevision` defaults to 0; `limit` defaults to 50 and is at most 100. |
| POST | `/api/v2/cases/case-1/messages` | `{ "text": "I already paid", "idempotencyKey": "message-1", "expectedRevision": 1 }`; accepts once and queues a mock job atomically (201), or returns the original message on an identical retry (200). |

Case IDs and idempotency keys are lowercase slugs of at most 64 characters. Text is trimmed, nonempty and at most 500 characters; revisions are positive safe integers. A changed body under the same key, stale ordinary revision or closed-case mutation returns 409. STOP can use an old revision and closes/suppresses the case immediately after session verification; it also cancels pending work.

The revision cursor pages case events internally, returning only their transcript messages. A page can contain no messages and still have `nextRevision`; continue until that value is null. Customer responses exclude internal audit reasons, caller/worker IDs, raw record snapshots, job results, token hashes and hidden evaluation data. Reads are private/no-store and vary on Cookie. Case state and transcript are polled views; clients should refresh/retry on a revision conflict.

## Isolation and limits

The server takes business/workspace/session identity from a current database session. Every new workspace gets a separately scoped copy of the development records. Knowing another case ID or supplying forged scope/role fields cannot move a request into that workspace. Unknown or foreign-workspace case IDs return 404. Visitor writes recheck and share-lock the session inside the case transaction before locking the case/jobs; logout/revocation cannot silently race that authorized write.

The database enforces a shared limit of 200 new workspaces per UTC day and 120 ordinary authenticated requests per session per minute. Counters survive web-process restarts; competing starts cannot reserve the same final slot. Requests rejected by these limits return 429 with a minimum retry delay. Valid authenticated STOP requests and logout bypass the ordinary counter so a used-up request budget cannot prevent contact suppression or ending a session.

These are demo resource limits, not a complete abuse-prevention system. Visitor-session expiration denies access but does not delete case/audit history or cancel already accepted internal work. Closing a browser/logging out loses anonymous access to its old workspace; operator access and retention/cleanup policy remain later work. No expired-session/case deletion job or load-test claim is included in this phase.

## Verification and next work

The implementation uses the installed Next.js authentication, data-security, cookies, connection and route/config guides. It follows the existing planned opaque visitor-session design; the maintained-library decision for operator GitHub OAuth remains separate. Operator login/membership/review routes are the next bounded phase; no operator bypass, password login or fake identity endpoint exists here.

Use [WORKER.md](WORKER.md) for the separate mock process. Accepted messages remain queued if no worker is running. Routine tests use isolated schemas in `TEST_DATABASE_URL`; no application database migration or public enablement is required to validate this slice. The V2 UI/browser acceptance check comes with its implementation phase.
