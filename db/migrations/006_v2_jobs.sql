-- Each accepted message revision owns one durable mock step; future role dispatch is separate.
create table v2_case_jobs (
  business_id text not null,
  workspace_id text not null,
  case_id text not null,
  case_revision bigint not null,
  kind text not null default 'mock_investigation' check (kind = 'mock_investigation'),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  available_at timestamptz not null default now(),
  worker_id text check (worker_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  lease_token uuid,
  lease_until timestamptz,
  result jsonb check (jsonb_typeof(result) = 'object'),
  last_error text check (last_error in ('handler_failed','lease_expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (business_id,workspace_id,case_id,case_revision),
  foreign key (business_id,workspace_id,case_id,case_revision) references v2_case_messages (business_id,workspace_id,case_id,revision),
  check ((state = 'running' and worker_id is not null and lease_token is not null and lease_until is not null)
    or (state <> 'running' and lease_token is null and lease_until is null)),
  check ((state in ('succeeded','failed','cancelled')) = (finished_at is not null)),
  check ((state = 'succeeded') = (result is not null)),
  check (state <> 'running' or attempts > 0)
);

create index v2_case_jobs_ready on v2_case_jobs (available_at,created_at)
  where state in ('queued','running');

-- Backfill pending Phase 4 messages without resetting terminal/suppressed cases.
insert into v2_case_jobs (business_id,workspace_id,case_id,case_revision)
select c.business_id,c.workspace_id,c.case_id,c.revision from v2_cases c
join v2_case_messages m on m.business_id=c.business_id and m.workspace_id=c.workspace_id and m.case_id=c.case_id and m.revision=c.revision
where c.state='investigating' and not c.contact_suppressed and m.role='customer';
