create table v2_case_runs (
  business_id text not null, workspace_id text not null, case_id text not null, case_revision bigint not null,
  run_id text not null default ('run-'||gen_random_uuid()::text) unique,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=32768),
  started_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null default (clock_timestamp()+interval '180 seconds'),
  model_calls integer not null default 0 check (model_calls between 0 and 12),
  tool_calls integer not null default 0 check (tool_calls between 0 and 16),
  charged_tokens integer not null default 0 check (charged_tokens>=0),
  blocked_reason text check (blocked_reason in ('model_requests','tool_calls','tokens','daily_tokens','deadline','operation_attempts','reservation_overrun')),
  primary key(business_id,workspace_id,case_id,case_revision),
  unique(business_id,workspace_id,case_id,case_revision,run_id),
  foreign key(business_id,workspace_id,case_id,case_revision) references v2_case_jobs(business_id,workspace_id,case_id,case_revision)
);
create table v2_run_daily_usage (
  day date primary key, charged_tokens bigint not null check (charged_tokens>=0)
);
create table v2_run_attempts (
  business_id text not null, workspace_id text not null, case_id text not null, case_revision bigint not null, run_id text not null,
  attempt_id uuid primary key, operation_key text not null check (operation_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  ordinal integer not null check (ordinal between 1 and 28), lease_token uuid not null,
  role text not null check (role in ('customer','coordinator','investigator','reviewer')),
  kind text not null check (kind in ('model','tool')),
  request jsonb not null check (jsonb_typeof(request)='object' and octet_length(request::text)<=4096),
  capacity integer not null check (capacity between 0 and 24000), day date not null,
  status text not null default 'reserved' check (status in ('reserved','succeeded','failed','unknown')),
  actual_input integer check (actual_input between 0 and 1000000), actual_output integer check (actual_output between 0 and 1000000),
  result jsonb check (jsonb_typeof(result)='object' and octet_length(result::text)<=65536),
  created_at timestamptz not null default clock_timestamp(), settled_at timestamptz,
  unique(business_id,workspace_id,case_id,case_revision,ordinal),
  foreign key(business_id,workspace_id,case_id,case_revision,run_id) references v2_case_runs(business_id,workspace_id,case_id,case_revision,run_id),
  check ((status='reserved')=(settled_at is null)),
  check ((kind='tool' and role='investigator' and capacity=0 and actual_input is null and actual_output is null and status<>'unknown')
    or (kind='model' and capacity>600 and result is null and status<>'failed')),
  check ((kind='tool' and status<>'reserved')=(result is not null)),
  check ((kind='model' and status='succeeded')=(actual_input is not null and actual_output is not null))
);
create index on v2_run_attempts(business_id,workspace_id,case_id,case_revision,operation_key,ordinal);
alter table v2_case_jobs drop constraint v2_case_jobs_last_error_check;
alter table v2_case_jobs add check (last_error in ('handler_failed','lease_expired','resource_limit'));
