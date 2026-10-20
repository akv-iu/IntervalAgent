-- Run as database owner after migration 011, with a password supplied to psql as a variable.
-- Create with SQL, not a console-created admin role. Use its URL only in V2_WORKER_DATABASE_URL.
create role recovery_v2_worker login password :'password';

grant usage on schema public to recovery_v2_worker;
grant select on v2_cases, v2_case_jobs to recovery_v2_worker;
grant update (state,revision,contact_suppressed,updated_at) on v2_cases to recovery_v2_worker;
grant update (state,attempts,available_at,worker_id,lease_token,lease_until,result,last_error,updated_at,finished_at)
  on v2_case_jobs to recovery_v2_worker;
grant insert (business_id,workspace_id,case_id,revision,kind,actor,actor_id,reason)
  on v2_case_events to recovery_v2_worker;
grant select,insert on v2_case_runs,v2_run_attempts,v2_run_daily_usage to recovery_v2_worker;
grant select,insert on v2_model_steps to recovery_v2_worker;
grant update (completed_attempt_id,completed_message_id,completed_at) on v2_model_steps to recovery_v2_worker;
grant select,insert on v2_agent_messages to recovery_v2_worker;
grant select (business_id,workspace_id,case_id,revision,body) on v2_case_messages to recovery_v2_worker;
grant update (model_calls,tool_calls,charged_tokens,blocked_reason) on v2_case_runs to recovery_v2_worker;
grant update (status,actual_input,actual_output,result,settled_at) on v2_run_attempts to recovery_v2_worker;
grant update (charged_tokens) on v2_run_daily_usage to recovery_v2_worker;
-- No V1 access, facts edits, new jobs, customer messages, deletion or DDL.
