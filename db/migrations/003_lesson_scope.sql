-- Lesson scope (Akshay's review): a lesson applies to its own situation, or to every reply after the opening.
-- Adds the "asks about payment options" situation. A hand-off rule may not apply to every reply.

alter table lessons add column applies_to text not null default 'situation' check (applies_to in ('situation', 'all'));
alter table lessons drop constraint lessons_situation_check;
alter table lessons add constraint lessons_situation_check check (situation in ('wrong_person', 'bereavement', 'lawyer', 'override', 'bot_question',
  'settlement', 'hardship', 'partial', 'promise', 'time_request', 'refusal', 'plan_request', 'proof', 'abusive', 'general'));
alter table lessons add constraint lessons_handoff_scope check (not (hard_rule = 'handoff' and applies_to = 'all'));
