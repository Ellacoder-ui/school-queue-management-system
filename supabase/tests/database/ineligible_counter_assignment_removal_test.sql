-- Run only on disposable PostgreSQL cluster 7698728238191685666.
-- Synthetic legacy assignment rows, function calls and audit rows roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table fixture(name text primary key,id uuid not null,email text not null);
insert into fixture values
 ('cashier',gen_random_uuid(),'cashier@assignment-removal.invalid'),
 ('student',gen_random_uuid(),'student@assignment-removal.invalid'),
 ('admin',gen_random_uuid(),'admin@assignment-removal.invalid');
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select id,email,clock_timestamp(),false from fixture;
update queue_private.accounts set role='CASHIER' where id=(select id from fixture where name='cashier');
update queue_private.accounts set role='STUDENT' where id=(select id from fixture where name='student');
update queue_private.accounts set role='ADMIN' where id=(select id from fixture where name='admin');

create temporary table fixture_counter as
select c.id from queue_private.counters c
where not exists(select 1 from queue_private.staff_counter_assignments x where x.counter_id=c.id)
 and not exists(select 1 from queue_private.pending_staff_assignments p
  where p.counter_id=c.id and p.role='CASHIER' and p.claimed_at is null and p.canceled_at is null)
order by c.number limit 1;
create temporary table owner_actor as
select account_id from queue_private.staff_management_owner where singleton;
create function pg_temp.actor(p_id uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',
  jsonb_build_object('sub',p_id,'role','authenticated','aal','aal1')::text,true);
end $$;

select ok(to_regprocedure('queue_api.remove_ineligible_counter_assignment(uuid,uuid,uuid)') is not null,
 'owner-only cleanup RPC is installed');
select ok(has_function_privilege('authenticated',
 'queue_api.remove_ineligible_counter_assignment(uuid,uuid,uuid)','EXECUTE'),
 'authenticated callers reach backend owner authorization');
select ok(not has_function_privilege('anon',
 'queue_api.remove_ineligible_counter_assignment(uuid,uuid,uuid)','EXECUTE'),
 'anonymous callers cannot remove assignments');
select is((select count(*) from fixture_counter),1::bigint,
 'test uses an unoccupied counter without a pending reservation');

insert into queue_private.staff_counter_assignments(account_id,counter_id)
select (select id from fixture where name='cashier'),id from fixture_counter;
alter table queue_private.staff_counter_assignments disable trigger enforce_staff_counter_assignment;
drop index queue_private.staff_counter_assignments_one_cashier_per_counter;
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select (select id from fixture where name='student'),id from fixture_counter;
alter table queue_private.staff_counter_assignments enable trigger enforce_staff_counter_assignment;

select pg_temp.actor((select id from fixture where name='admin'));
select throws_ok($q$select queue_api.remove_ineligible_counter_assignment(
 (select id from fixture_counter),(select id from fixture where name='student'),gen_random_uuid())$q$,
 '42501','Staff management owner required',
 'another ADMIN cannot remove a counter assignment');
select pg_temp.actor((select id from fixture where name='cashier'));
select throws_ok($q$select queue_api.remove_ineligible_counter_assignment(
 (select id from fixture_counter),(select id from fixture where name='student'),gen_random_uuid())$q$,
 '42501','Staff management owner required',
 'CASHIER cannot remove a counter assignment');

select pg_temp.actor((select account_id from owner_actor));
select throws_ok($q$select queue_api.remove_ineligible_counter_assignment(
 (select id from fixture_counter),(select id from fixture where name='cashier'),gen_random_uuid())$q$,
 '42501','An enabled CASHIER assignment cannot be removed by this operation',
 'owner cannot use the cleanup RPC to remove an enabled CASHIER assignment');

create temporary table removal_result as
select queue_api.remove_ineligible_counter_assignment(
 (select id from fixture_counter),(select id from fixture where name='student'),
 'f6bf4609-27a2-4c22-a7e9-6a36c2a91629'::uuid) result;
select is((select result->>'role' from removal_result),'STUDENT',
 'owner removes only the requested STUDENT assignment');
select is((select result->>'removed' from removal_result),'true',
 'RPC returns an exact removal receipt');
select is((select count(*) from queue_private.staff_counter_assignments
 where counter_id=(select id from fixture_counter)),1::bigint,
 'the existing cashier assignment is preserved');
select is((select count(*) from queue_private.staff_counter_assignments
 where account_id=(select id from fixture where name='student')),0::bigint,
 'only the requested ineligible assignment is removed');
select is((select role::text from queue_private.accounts where id=(select id from fixture where name='student')),
 'STUDENT','the target account role remains unchanged');

create unique index staff_counter_assignments_one_cashier_per_counter
 on queue_private.staff_counter_assignments(counter_id);
select is(queue_api.remove_ineligible_counter_assignment(
 (select id from fixture_counter),(select id from fixture where name='student'),
 'f6bf4609-27a2-4c22-a7e9-6a36c2a91629'::uuid)::text,
 (select result::text from removal_result),
 'same request key replays the original receipt without another mutation');
select is((select count(*)::integer from queue_private.admin_audit_events
 where actor_id=(select account_id from owner_actor)
  and action='REMOVE_INELIGIBLE_COUNTER_ASSIGNMENT'),1,
 'idempotent replay creates one audit event');

select throws_ok($q$select queue_api.remove_ineligible_counter_assignment(
 (select id from fixture_counter),gen_random_uuid(),gen_random_uuid())$q$,
 '22023','Account not found','unknown target accounts are rejected');
select * from finish();
rollback;
