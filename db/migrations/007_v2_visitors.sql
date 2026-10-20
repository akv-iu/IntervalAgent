create table v2_visitor_sessions (
  session_id text primary key check (session_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  business_id text not null check (business_id in ('northside','subscriptions')),
  workspace_id text not null check (workspace_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  revoked_at timestamptz,
  request_window timestamptz not null default now(),
  request_count integer not null default 0 check (request_count between 0 and 120),
  unique (business_id,workspace_id),
  check (expires_at > created_at)
);

-- One shared UTC-day counter, not an ever-growing per-minute/IP table.
create table v2_session_limit (
  singleton boolean primary key default true check (singleton),
  day date not null,
  count integer not null check (count between 1 and 200)
);
