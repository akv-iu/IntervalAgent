create table v2_agent_messages (
  business_id text not null, workspace_id text not null, case_id text not null, case_revision bigint not null, run_id text not null,
  operation_key text not null check (operation_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  message_id text not null, parent_message_id text,
  ordinal integer not null check (ordinal between 1 and 18),
  message jsonb not null check (jsonb_typeof(message)='object' and octet_length(message::text)<=16384),
  created_at timestamptz not null default clock_timestamp(),
  primary key(business_id,workspace_id,case_id,case_revision,operation_key),
  unique(business_id,workspace_id,case_id,case_revision,run_id,message_id),
  unique(business_id,workspace_id,case_id,case_revision,ordinal),
  foreign key(business_id,workspace_id,case_id,case_revision,run_id) references v2_case_runs(business_id,workspace_id,case_id,case_revision,run_id),
  foreign key(business_id,workspace_id,case_id,case_revision,run_id,parent_message_id) references v2_agent_messages(business_id,workspace_id,case_id,case_revision,run_id,message_id),
  check ((message->>'businessId'=business_id and message->>'workspaceId'=workspace_id and message->>'caseId'=case_id
    and message->>'runId'=run_id and message->>'messageId'=message_id and message->>'idempotencyKey'=operation_key
    and message->>'taskId'=operation_key and message->>'schemaVersion'='2'
    and (message->>'parentMessageId') is not distinct from parent_message_id) is true)
);
alter table v2_case_runs drop constraint v2_case_runs_blocked_reason_check;
alter table v2_case_runs add check (blocked_reason in ('model_requests','tool_calls','tokens','daily_tokens','deadline','operation_attempts','reservation_overrun','agent_messages'));
