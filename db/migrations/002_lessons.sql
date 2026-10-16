-- Lessons taught on the local Try page (plan Part D, FR-85). Written only by the local live route;
-- the public site reads them. A lesson is saved only after the person accepted a retried reply.

create table lessons (
  id           serial primary key,
  created_at   timestamptz not null default now(),
  situation    text not null check (situation in ('wrong_person', 'bereavement', 'lawyer', 'override', 'bot_question', 'settlement', 'hardship',
                                                  'partial', 'promise', 'time_request', 'refusal', 'proof', 'abusive', 'general')),
  reason       text not null check (reason in ('gave_up', 'wrong_amount', 'tone', 'ignored_customer', 'other')),
  instruction  text not null check (char_length(btrim(instruction)) between 1 and 300),
  hard_rule    text check (hard_rule in ('no_close', 'mention_plan', 'offer_person', 'handoff')),
  scenario_id  text not null check (scenario_id ~ '^S[0-9]{2}$'),
  moment       jsonb not null check (jsonb_typeof(moment) = 'array'),
  before_text  text not null check (char_length(before_text) <= 4000),
  after_text   text not null check (char_length(after_text) <= 4000),
  active       boolean not null default true,
  times_used   integer not null default 0 check (times_used >= 0)
);
