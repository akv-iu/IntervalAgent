-- Better Auth 1.7.11 core schema, with private model names. No V1 table changes.
create table v2_auth_user (
  id text primary key, name text not null, email text not null unique, "emailVerified" boolean not null default false,
  image text, "createdAt" timestamptz not null, "updatedAt" timestamptz not null
);
create table v2_auth_session (
  id text primary key, token text not null unique, "userId" text not null references v2_auth_user(id) on delete cascade,
  "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "updatedAt" timestamptz not null,
  "ipAddress" text, "userAgent" text
);
create index on v2_auth_session("userId");
create table v2_auth_account (
  id text primary key, "accountId" text not null, "providerId" text not null check ("providerId"='github'),
  "userId" text not null references v2_auth_user(id) on delete cascade,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
  "createdAt" timestamptz not null, "updatedAt" timestamptz not null,
  unique("providerId","accountId")
);
create index on v2_auth_account("userId");
create table v2_auth_verification (
  id text primary key, identifier text not null, value text not null, "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null, "updatedAt" timestamptz not null
);
create index on v2_auth_verification(identifier);
create table v2_operators (
  operator_id text primary key default ('operator-'||gen_random_uuid()::text) check (operator_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  user_id text not null unique references v2_auth_user(id), disabled_at timestamptz,
  request_window timestamptz not null default now(), request_count integer not null default 0 check (request_count between 0 and 120)
);
create table v2_operator_memberships (
  operator_id text not null references v2_operators(operator_id),
  business_id text not null check (business_id in ('northside','subscriptions')),
  granted_at timestamptz not null default now(), revoked_at timestamptz,
  primary key(operator_id,business_id)
);
create table v2_auth_limit (
  singleton boolean primary key default true check(singleton), window_start timestamptz not null,
  count integer not null check (count between 1 and 60)
);
