-- Lessons-only login for the public Try page (DATABASE_URL_LESSONS on the host). Run as the database owner,
-- passing the password as a variable so it never lands in a file or in git:
--   psql "$DATABASE_URL" -v password='choose-a-strong-one' -f db/ops/try_writer_role.sql
-- (or paste it into the Neon SQL Editor with the password typed in place of :'password').
-- Create the role with SQL, never with Neon's console "Add role": console roles are made members of
-- neon_superuser, and these grants would not remove that.
-- It can add lessons, turn them on or off, count their uses, and reserve daily token use. It cannot read or
-- change any other table, edit or delete lessons, or change the schema.
create role recovery_try_writer login password :'password';
grant usage on schema public to recovery_try_writer;
grant select, insert on lessons to recovery_try_writer;
grant update (times_used, active) on lessons to recovery_try_writer;
grant usage on sequence lessons_id_seq to recovery_try_writer;
grant select, insert, update on try_usage to recovery_try_writer;
