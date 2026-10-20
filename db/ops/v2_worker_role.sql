-- Run as database owner after migration 006, with a password supplied to psql as a variable.
-- Create with SQL, not a console-created admin role. Use its URL only in V2_WORKER_DATABASE_URL.
create role recovery_v2_worker login password :'password';

grant usage on schema public to recovery_v2_worker;
grant select on v2_cases, v2_case_jobs to recovery_v2_worker;
grant update (state,revision,contact_suppressed,updated_at) on v2_cases to recovery_v2_worker;
grant update (state,attempts,available_at,worker_id,lease_token,lease_until,result,last_error,updated_at,finished_at)
  on v2_case_jobs to recovery_v2_worker;
grant insert (business_id,workspace_id,case_id,revision,kind,actor,actor_id,reason)
  on v2_case_events to recovery_v2_worker;
-- No V1 access, facts edits, new jobs, customer messages, deletion or DDL.
