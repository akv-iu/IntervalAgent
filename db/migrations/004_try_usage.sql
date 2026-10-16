-- Tokens the public Try page used per UTC day, shared by every server instance, so a daily cap holds
-- no matter how many instances Vercel runs (Akshay, 2026-10-17: public live Try page).
create table try_usage (
  day    date primary key,
  tokens bigint not null default 0 check (tokens >= 0)
);
