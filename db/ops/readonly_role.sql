-- Read-only role for the public site. Run as the database owner with psql, passing the password
-- as a variable so it never lands in a file or in git:
--   psql "$DATABASE_URL" -v password='choose-a-strong-one' -f db/ops/readonly_role.sql
-- Then build DATABASE_URL_READONLY from the same host and database with user recovery_reader.
-- (or paste it into the Neon SQL Editor with the password typed in place of :'password').
-- Create the role with SQL, never with Neon's console "Add role": console roles are made members of
-- neon_superuser, and these grants would not remove that.
create role recovery_reader login password :'password';
grant usage on schema public to recovery_reader;
grant select on accounts, runs, conversations, messages, eval_results, picker_trials, lessons to recovery_reader;
-- No insert, update, delete, truncate, or DDL is granted.
