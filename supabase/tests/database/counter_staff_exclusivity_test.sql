-- Run after migration 20261022001400 on disposable cluster 7698728238191685666.
-- All synthetic users, assignments, reservations and audit entries roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table fixture(name text primary key,id uuid not null,email text not null);
insert into fixture values
 ('cashier1',gen_random_uuid(),'cashier1@staff-exclusivity.invalid'),
 ('cashier2',gen_random_uuid(),'cashier2@staff-exclusivity.invalid'),
 ('cashier3',gen_random_uuid(),'cashier3@staff-exclusivity.invalid'),
 ('student',gen_random_uuid(),'student@staff-exclusivity.invalid');
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select id,email,clock_timestamp(),false from fixture;
insert into auth.identities(provider_id,user_id,identity_data,provider,email)
select 'staff-exclusivity-'||id::text,id,
 jsonb_build_object('sub','staff-exclusivity-'||id::text,'email',email,'email_verified','true'),
 'google',email from fixture where name='cashier3';
update queue_private.accounts set role='CASHIER'
where id in (select id from fixture where name like 'cashier%');
update queue_private.accounts set role='STUDENT'
where id=(select id from fixture where name='student');

create temporary table counters as
select number,id from queue_private.counters where number in (2,3,4,5);
create temporary table admin_actor as
select account_id from queue_private.staff_management_owner where singleton;
create function pg_temp.actor(p_id uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',
  jsonb_build_object('sub',p_id,'role','authenticated','aal','aal1')::text,true);
end $$;

select ok(to_regclass('queue_private.staff_counter_assignments_one_counter_per_cashier') is not null,
 'active cashiers have a unique counter assignment');
select ok(to_regclass('queue_private.staff_counter_assignments_one_cashier_per_counter') is not null,
 'a counter has at most one active cashier');
select ok(to_regclass('queue_private.pending_staff_one_counter_reservation') is not null,
 'a counter has at most one active pending reservation');
select ok(has_function_privilege('authenticated',
 'queue_api.set_staff_access(uuid,text,boolean,uuid,uuid)','EXECUTE'),
 'authenticated RPC calls are guarded in the backend');
select ok(not has_function_privilege('anon',
 'queue_api.set_staff_access(uuid,text,boolean,uuid,uuid)','EXECUTE'),
 'anonymous users cannot change staff access');

insert into queue_private.staff_counter_assignments(account_id,counter_id)
select (select id from fixture where name='cashier1'),id from counters where number=3;
select throws_ok($q$insert into queue_private.staff_counter_assignments(account_id,counter_id)
 select (select id from fixture where name='cashier2'),id from counters where number=3$q$,
 '23505','Cashier or counter already has an active assignment',
 'a second cashier cannot be assigned to an occupied counter');
select throws_ok($q$insert into queue_private.staff_counter_assignments(account_id,counter_id)
 select (select id from fixture where name='cashier1'),id from counters where number=4$q$,
 '23505','Cashier or counter already has an active assignment',
 'a cashier cannot be assigned to a second counter');

insert into queue_private.pending_staff_assignments(email,role,counter_id,assigned_by)
select 'reserved@staff-exclusivity.invalid','CASHIER',id,(select account_id from admin_actor)
from counters where number=4;
select throws_ok($q$insert into queue_private.staff_counter_assignments(account_id,counter_id)
 select (select id from fixture where name='cashier2'),id from counters where number=4$q$,
 '23505','Counter has a pending cashier reservation',
 'an active reservation blocks a new active assignment');
select throws_ok($q$insert into queue_private.pending_staff_assignments(email,role,counter_id,assigned_by)
 select 'second-reservation@staff-exclusivity.invalid','CASHIER',id,(select account_id from admin_actor)
 from counters where number=4$q$,
 '23505','Counter already has a pending cashier reservation',
 'a counter cannot hold a second pending cashier reservation');

insert into queue_private.staff_counter_assignments(account_id,counter_id)
select (select id from fixture where name='cashier2'),id from counters where number=5;
select throws_ok($q$insert into queue_private.pending_staff_assignments(email,role,counter_id,assigned_by)
 select 'reserved-active@staff-exclusivity.invalid','CASHIER',id,(select account_id from admin_actor)
 from counters where number=5$q$,
 '23505','Counter already has an active assignment',
 'a pending reservation cannot take an actively assigned counter');
select throws_ok($q$insert into queue_private.staff_counter_assignments(account_id,counter_id)
 select (select id from fixture where name='student'),id from counters where number=3$q$,
 '23514','Only an enabled CASHIER can be assigned to a counter',
 'STUDENT accounts cannot be added to cashier assignments');

select is((select count(*) from queue_private.staff_counter_assignments
 where account_id in (select id from fixture)),2::bigint,
 'rejected duplicate operations leave only the two valid synthetic assignments');

select pg_temp.actor((select account_id from admin_actor));
select is(queue_api.set_staff_access(
 (select id from fixture where name='cashier3'),'CASHIER',true,
 (select id from counters where number=2),gen_random_uuid())->>'counter',
 (select id::text from counters where number=2),
 'the designated ADMIN atomically assigns a verified cashier to an available counter');
select throws_ok($q$select queue_api.set_staff_access(
 (select id from fixture where name='cashier3'),'CASHIER',true,
 (select id from counters where number=3),gen_random_uuid())$q$,
 '23505','Counter already has an assigned cashier',
 'staff editing cannot take an occupied counter');
select pg_temp.actor((select id from fixture where name='cashier1'));
select throws_ok($q$select queue_api.set_staff_access(
 (select id from fixture where name='cashier3'),'ADMIN',true,null,gen_random_uuid())$q$,
 '42501','Staff management owner required',
 'cashiers cannot change staff roles');
select pg_temp.actor((select account_id from admin_actor));
select is(queue_api.set_account(
 (select id from fixture where name='cashier3'),'STUDENT',true,gen_random_uuid())->>'role',
 'STUDENT','Remove Staff preserves the account while revoking staff access');
select is((select count(*) from queue_private.staff_counter_assignments
 where account_id=(select id from fixture where name='cashier3')),0::bigint,
 'removing staff access releases the counter assignment');
select * from finish();
rollback;
