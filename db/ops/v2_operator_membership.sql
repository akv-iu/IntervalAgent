-- Owner-only provisioning AFTER the user signs in. Pin the numeric GitHub account ID, never an email/username.
-- psql variables: github_account_id, business_id (northside | subscriptions).
begin;
insert into v2_operators(user_id)
select "userId" from v2_auth_account where "providerId"='github' and "accountId"=:'github_account_id'
on conflict(user_id) do nothing;
insert into v2_operator_memberships(operator_id,business_id)
select o.operator_id,:'business_id' from v2_operators o join v2_auth_account a on a."userId"=o.user_id
where a."providerId"='github' and a."accountId"=:'github_account_id' and o.disabled_at is null
on conflict(operator_id,business_id) do update set revoked_at=null,granted_at=now();
commit;
-- Verify one membership was written; an unknown GitHub ID or disabled operator creates no grant.
