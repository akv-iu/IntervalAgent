alter table v2_run_attempts add unique(business_id,workspace_id,case_id,case_revision,run_id,attempt_id);
create table v2_model_steps (
  business_id text not null, workspace_id text not null, case_id text not null, case_revision bigint not null, run_id text not null,
  operation_key text not null check (operation_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  step jsonb not null check (jsonb_typeof(step)='object' and octet_length(step::text)<=2048),
  requests jsonb not null check (jsonb_typeof(requests)='array' and jsonb_array_length(requests)=2 and octet_length(requests::text)<=65536),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  completed_attempt_id uuid, completed_message_id text, completed_at timestamptz,
  primary key(business_id,workspace_id,case_id,case_revision,operation_key),
  foreign key(business_id,workspace_id,case_id,case_revision,run_id) references v2_case_runs(business_id,workspace_id,case_id,case_revision,run_id),
  foreign key(business_id,workspace_id,case_id,case_revision,run_id,completed_attempt_id) references v2_run_attempts(business_id,workspace_id,case_id,case_revision,run_id,attempt_id),
  foreign key(business_id,workspace_id,case_id,case_revision,run_id,completed_message_id) references v2_agent_messages(business_id,workspace_id,case_id,case_revision,run_id,message_id),
  check ((step->>'operationKey'=operation_key and requests->0->>'model'=requests->1->>'model'
    and requests->0->>'maxOutputTokens'='600' and requests->1->>'maxOutputTokens'='600') is true),
  check ((completed_attempt_id is null)=(completed_message_id is null) and (completed_message_id is null)=(completed_at is null))
);
