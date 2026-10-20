-- Run as owner after migration 008; supply the password outside this file.
create role recovery_v2_operator login password :'password';
grant usage on schema public to recovery_v2_operator;
grant select,insert,update,delete on v2_auth_user,v2_auth_session,v2_auth_account,v2_auth_verification to recovery_v2_operator;
grant select,insert on v2_auth_limit to recovery_v2_operator;
grant update (window_start,count) on v2_auth_limit to recovery_v2_operator;
grant select on v2_operators,v2_operator_memberships,v2_cases,v2_case_events,v2_case_messages to recovery_v2_operator;
grant update (request_window,request_count) on v2_operators to recovery_v2_operator;
-- No membership grants, V1/visitor data, case/job changes, financial effects or DDL.
