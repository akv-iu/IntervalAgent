-- Recovery Lab schema (SPEC 4). Money is integer cents. Timestamps are timestamptz.

create table accounts (
  account_key   text primary key,
  dataset       text not null check (dataset in ('demo', 'eval')),
  business      text not null,
  first_name    text not null,
  persona       text not null check (persona in ('cooperative', 'needs_plan', 'disputes', 'angry', 'stop_contact', 'silent')),
  balance_cents integer not null check (balance_cents > 0),
  due_date      date not null,
  days_past_due integer not null check (days_past_due between 1 and 120),
  aging_bucket  text not null check (aging_bucket in ('1-30', '31-60', '61-90', '91-120')),
  timezone      text not null check (timezone in ('America/Denver', 'America/New_York'))
);

create table runs (
  id               text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  kind             text not null check (kind in ('eval', 'bulk', 'picker')),
  source_mode      text not null check (source_mode in ('live', 'mock', 'replay', 'synthetic')),
  created_at       timestamptz not null,
  status           text not null check (status in ('complete', 'failed')),
  schema_version   integer not null,
  scenario_version integer not null,
  recording_set_id text,
  model            text,
  report_as_of     timestamptz,
  metadata         jsonb not null default '{}',
  check (kind <> 'bulk' or report_as_of is not null)
);
create index runs_kind_status_created on runs (kind, status, created_at);

create table conversations (
  id              bigserial primary key,
  run_id          text not null references runs (id),
  account_key     text not null references accounts (account_key),
  scenario_id     text,
  version         text not null check (version in ('baseline', 'guarded')),
  channel         text not null check (channel in ('sms', 'email')),
  tone            text not null check (tone in ('friendly', 'formal')),
  started_at      timestamptz not null,
  agreed_at       timestamptz,
  paid_at         timestamptz,
  outcome         text not null check (outcome in ('agreed_to_pay', 'payment_plan', 'promise_to_pay', 'disputed', 'stopped', 'no_response')),
  recovered_cents integer not null check (recovered_cents >= 0),
  handed_to_human boolean not null,
  -- Also serves the (run_id, account_key) lookup index from SPEC 4.
  unique (run_id, account_key, version),
  check (paid_at is null or (agreed_at is not null and paid_at >= agreed_at)),
  check (paid_at is null or outcome = 'agreed_to_pay'),
  check ((paid_at is null) = (recovered_cents = 0))
);

create table messages (
  conversation_id bigint not null references conversations (id),
  seq             integer not null check (seq > 0),
  role            text not null check (role in ('agent', 'customer', 'system')),
  body            text not null,
  sent_at         timestamptz not null,
  guard_flags     text[] not null default '{}',
  persona_state   jsonb,
  checks          jsonb not null default '[]',
  primary key (conversation_id, seq)
);

create table eval_results (
  run_id          text not null references runs (id),
  conversation_id bigint not null references conversations (id),
  version         text not null check (version in ('baseline', 'guarded')),
  scenario_id     text not null,
  check_name      text not null,
  passed          boolean,
  detail          text not null default '',
  unique (run_id, version, scenario_id, check_name)
);

create table picker_trials (
  run_id    text not null references runs (id),
  phase     text not null check (phase in ('train', 'test')),
  segment   text not null check (segment in ('1-30', '31-60', '61-90', '91-120')),
  case_id   text not null,
  strategy  text not null check (strategy in ('fixed', 'learned')),
  channel   text not null check (channel in ('sms', 'email')),
  "window"  text not null check ("window" in ('morning', 'evening')),
  tone      text not null check (tone in ('friendly', 'formal')),
  responded boolean not null,
  paid      boolean not null,
  primary key (run_id, phase, segment, case_id, strategy),
  check (not paid or responded)
);
