-- Additive V2 storage. Existing V1 roles receive no grants on these private tables.
create table v2_cases (
  business_id text not null check (business_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  workspace_id text not null check (workspace_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  case_id text not null check (case_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  account_id text not null check (account_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  state text not null check (state in ('open','investigating','awaiting_customer','awaiting_human','resolved','closed')),
  revision bigint not null check (revision between 1 and 9007199254740991),
  contact_suppressed boolean not null default false,
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, workspace_id, case_id)
);

create table v2_case_events (
  business_id text not null,
  workspace_id text not null,
  case_id text not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  kind text not null check (kind in ('created','customer_message','investigate','request_customer','request_human','resolve','close','new_evidence','reopen','stop_contact')),
  actor text not null check (actor in ('customer','operator','system')),
  actor_id text not null check (actor_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  primary key (business_id, workspace_id, case_id, revision),
  foreign key (business_id, workspace_id, case_id) references v2_cases
);

create table v2_case_messages (
  business_id text not null,
  workspace_id text not null,
  case_id text not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  revision bigint not null check (revision between 1 and 9007199254740991),
  role text not null check (role in ('customer','agent')),
  body text not null check (length(body) <= 500 and length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  primary key (business_id, workspace_id, case_id, idempotency_key),
  unique (business_id, workspace_id, case_id, revision),
  foreign key (business_id, workspace_id, case_id, revision) references v2_case_events
);
