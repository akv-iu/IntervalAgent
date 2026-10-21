-- Visitor web login only. Run as owner after migration 012, supplying the password outside this file.
create role recovery_v2_web login password :'password';

grant usage on schema public to recovery_v2_web;
grant select,insert on v2_visitor_sessions,v2_session_limit,v2_cases,v2_case_events,v2_case_messages to recovery_v2_web;
grant update (revoked_at,request_window,request_count) on v2_visitor_sessions to recovery_v2_web;
grant update (day,count) on v2_session_limit to recovery_v2_web;
grant update (state,revision,contact_suppressed,updated_at) on v2_cases to recovery_v2_web;
grant select (business_id,workspace_id,case_id,case_revision,state) on v2_case_jobs to recovery_v2_web;
grant insert (business_id,workspace_id,case_id,case_revision) on v2_case_jobs to recovery_v2_web;
grant update (state,lease_token,lease_until,finished_at,updated_at) on v2_case_jobs to recovery_v2_web;
grant select on v2_activity_jobs,v2_activity_messages,v2_activity_tools to recovery_v2_web;
-- No V1 access, facts edits, job results/claims, financial effects, deletion or DDL.
