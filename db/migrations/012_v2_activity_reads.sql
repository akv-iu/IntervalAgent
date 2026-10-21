-- Allowlisted views keep prompts, request payloads and worker identities out of the web role.
create view v2_activity_jobs with (security_barrier=true) as
select j.business_id,j.workspace_id,j.case_id,j.case_revision,j.state,j.attempts,j.available_at,j.finished_at,
  coalesce(j.state='running' and j.lease_until>clock_timestamp(),false) lease_active,
  r.snapshot->>'mode' mode,r.snapshot->>'version' version,r.snapshot->>'policyVersion' policy_version,
  r.model_calls,r.tool_calls,r.charged_tokens,
  (select coalesce(sum(a.actual_input),0) from v2_run_attempts a where a.run_id=r.run_id and a.kind='model') observed_input,
  (select coalesce(sum(a.actual_output),0) from v2_run_attempts a where a.run_id=r.run_id and a.kind='model') observed_output,
  (select count(*) from v2_run_attempts a where a.run_id=r.run_id and a.kind='model' and a.status in ('reserved','unknown')) unknown_model_attempts,
  (select coalesce(sum(a.capacity),0) from v2_run_attempts a where a.run_id=r.run_id and a.kind='model' and a.status in ('reserved','unknown')) held_tokens,
  j.result->'pendingProposal' pending_proposal,j.result->>'projectedBalanceCents' projected_balance,
  coalesce(j.result->>'decision',j.result->'workflow'->>'decision') decision,
  j.result->'guard'->>'decision' guard_decision
from v2_case_jobs j left join v2_case_runs r using(business_id,workspace_id,case_id,case_revision);

create view v2_activity_messages with (security_barrier=true) as
select m.business_id,m.workspace_id,m.case_id,m.case_revision,m.message->>'accountId' account_id,
  m.ordinal,p.ordinal parent_ordinal,m.message->>'sender' sender,m.message->>'recipient' recipient,
  m.message->>'kind' kind,
  case m.message->>'kind'
    when 'task_request' then 'Task handed to the next role.'
    when 'finding' then m.message->'payload'->>'summary'
    when 'clarification_request' then m.message->'payload'->>'question'
    when 'proposal' then 'Internal draft prepared for review. It has not been sent to the customer.'
    when 'review_result' then m.message->'payload'->>'summary'
    when 'escalation' then m.message->'payload'->>'reason'
  end summary,
  case when m.message->>'kind'='review_result' then m.message->'payload'->>'decision' end decision,
  m.message->'evidenceRefs' evidence_refs,m.created_at
from v2_agent_messages m left join v2_agent_messages p
  on (p.business_id,p.workspace_id,p.case_id,p.case_revision,p.run_id,p.message_id)
   = (m.business_id,m.workspace_id,m.case_id,m.case_revision,m.run_id,m.parent_message_id);

create view v2_activity_tools with (security_barrier=true) as
select business_id,workspace_id,case_id,case_revision,request->>'accountId' account_id,
  ordinal,request->>'name' name,
  case when status='reserved' then 'pending' else result->>'status' end status,
  coalesce(result->'evidenceRefs','[]'::jsonb) evidence_refs,created_at,settled_at
from v2_run_attempts where kind='tool';

revoke all on v2_activity_jobs,v2_activity_messages,v2_activity_tools from public;
