-- Run after migration 20261021001000 on disposable cluster 7698728238191685666.
-- All target fixtures, role changes, assignments and audit rows roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table fixture(
 name text primary key,
 id uuid not null,
 email text not null,
 google_sub text not null
);
insert into fixture(name,id,email,google_sub) values
 ('other-admin',gen_random_uuid(),'other-admin@staff-test.invalid','google-other-admin'),
 ('existing-cashier',gen_random_uuid(),'existing-cashier@staff-test.invalid','google-existing-cashier'),
 ('target-cashier',gen_random_uuid(),'target-cashier@staff-test.invalid','google-target-cashier'),
 ('disabled-student',gen_random_uuid(),'disabled-student@staff-test.invalid','google-disabled-student'),
 ('invalid-google',gen_random_uuid(),'invalid-google@staff-test.invalid','google-invalid-expected'),
 ('cashier-actor',gen_random_uuid(),'cashier-actor@staff-test.invalid','google-cashier-actor'),
 ('student-actor',gen_random_uuid(),'student-actor@staff-test.invalid','google-student-actor');

insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select id,email,clock_timestamp(),false from fixture;
insert into auth.identities(provider_id,user_id,identity_data,provider,email)
select case when name='invalid-google' then 'mismatched-provider-sub' else google_sub end,
 id,jsonb_build_object('sub',google_sub,'email',email,'email_verified','true'),
 'google',email from fixture;
update queue_private.accounts a set role='ADMIN'
from fixture f where a.id=f.id and f.name='other-admin';
update queue_private.accounts a set role='CASHIER'
from fixture f where a.id=f.id and f.name in ('existing-cashier','cashier-actor');
update queue_private.accounts a set enabled=false
from fixture f where a.id=f.id and f.name='disabled-student';

insert into queue_private.staff_counter_assignments(account_id,counter_id)
select (select id from fixture where name='existing-cashier'),id
from queue_private.counters where number=3;
create temporary table counter1 as select id from queue_private.counters where number=3;
create temporary table counter2 as select id from queue_private.counters where number=4;
create temporary table assignment_baseline as
select count(*)::bigint as total from queue_private.staff_counter_assignments
where counter_id=(select id from counter1);
create temporary table target_identity as
select queue_private.google_identity_binding(id) as digest
from fixture where name='target-cashier';
create temporary table request_key as select gen_random_uuid() as id;

create function pg_temp.actor(p_id uuid,p_aal text default 'aal1') returns void
language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',
  jsonb_build_object('sub',p_id,'aal',p_aal,'role','authenticated')::text,true);
end $$;

select ok(not has_function_privilege('anon',
 'queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)','EXECUTE'),
 'anonymous users cannot activate staff');
select ok(has_function_privilege('authenticated',
 'queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)','EXECUTE'),
 'authenticated clients reach backend authorization');
select ok(not has_function_privilege('authenticated',
 'queue_private.require_staff_activation_admin()','EXECUTE'),
 'owner authorization helper is not directly callable');
select ok(to_regprocedure('queue_private.review_staff_activation(uuid,text,text,text,uuid,text,timestamp with time zone)') is null,
 'operator approval function is removed');
select ok(to_regclass('queue_private.staff_activation_approvals') is null,
 'one-time operator approval table is removed');

select pg_temp.actor('5c96debb-697f-4cad-805f-92b518e28343');
select is((select role::text from queue_private.accounts where id=auth.uid()),'ADMIN',
 'configured owner fixture is an enabled ADMIN');
select ok(jsonb_array_length(queue_api.admin_staff_accounts())>0,
 'owner can read staff directory in an AAL1 session without an MFA challenge');
select is(queue_api.resolve_staff_google('target-cashier@staff-test.invalid')->>'id',
 (select id::text from fixture where name='target-cashier'),
 'owner resolves an exact verified Google identity');
select is(queue_api.resolve_staff_google('invalid-google@staff-test.invalid'),null::jsonb,
 'mismatched Google provider identity is not resolved');

select throws_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='target-cashier'),'target-cashier@staff-test.invalid',
 (select digest from target_identity),'CASHIER',null,gen_random_uuid())$q$,
 '22023','Invalid verified staff action','invalid counter input is rejected before any account change');
select is((select role::text from queue_private.accounts where id=(select id from fixture where name='target-cashier')),
 'STUDENT','invalid counter rejection leaves target role unchanged');
select is((select count(*) from queue_private.staff_counter_assignments where account_id=(select id from fixture where name='target-cashier')),
 0::bigint,'invalid counter rejection creates no assignment');

select lives_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='target-cashier'),'target-cashier@staff-test.invalid',
 (select digest from target_identity),'CASHIER',(select id from counter2),(select id from request_key))$q$,
 'owner activates a verified Google account as CASHIER on an available counter');
select is((select role::text from queue_private.accounts where id=(select id from fixture where name='target-cashier')),
 'CASHIER','activation sets the requested cashier role');
select is((select count(*) from queue_private.staff_counter_assignments where counter_id=(select id from counter1)),
 (select total from assignment_baseline),'activation preserves the existing cashier assignment');
select is((select count(*) from queue_private.staff_counter_assignments where account_id=(select id from fixture where name='target-cashier')
 and counter_id=(select id from counter2)),1::bigint,'activation assigns only the selected available counter');
select is((select count(*) from queue_private.admin_audit_events where action='STAFF_ACTIVATION'
 and parameters->>'user'=(select id::text from fixture where name='target-cashier')),
 1::bigint,'activation is audited');
select is((queue_api.add_verified_staff(
 (select id from fixture where name='target-cashier'),'target-cashier@staff-test.invalid',
 (select digest from target_identity),'CASHIER',(select id from counter2),(select id from request_key))->>'role'),
 'CASHIER','same request key replays the original activation receipt');
select is((select count(*) from queue_private.admin_audit_events where action='STAFF_ACTIVATION'
 and parameters->>'user'=(select id::text from fixture where name='target-cashier')),
 1::bigint,'idempotent replay does not duplicate the audit event');

select pg_temp.actor((select id from fixture where name='target-cashier'));
select is(queue_api.my_context()->>'role','CASHIER',
 'activated account receives CASHIER role through my_context');
select is((queue_api.my_context()->'cashier_counters'->0->>'counter_number')::integer,4,
 'activated cashier is routed to Counter 4');
select is(((queue_api.my_context()->'cashier_counters'->0)->'service_codes'->>0),'REF',
 'Counter 4 context retains the fixed Refund Process service code');

select pg_temp.actor((select id from fixture where name='other-admin'));
select throws_ok($q$select queue_api.admin_staff_accounts()$q$,
 '42501','Staff management owner required','another ADMIN cannot read through the owner-only staff RPC');
select throws_ok($q$select queue_api.resolve_staff_google('target-cashier@staff-test.invalid')$q$,
 '42501','Staff management owner required','another ADMIN cannot resolve Google staff identities');
select throws_ok($q$select queue_api.set_account(
 (select id from fixture where name='target-cashier'),'STUDENT',true,gen_random_uuid())$q$,
 '42501','Staff management owner required','another ADMIN cannot change staff roles');
select throws_ok($q$select queue_api.configure_counter(
 (select id from counter2),false,array['REF'],array[]::uuid[],gen_random_uuid())$q$,
 '42501','Staff management owner required','another ADMIN cannot change cashier assignments');

select pg_temp.actor((select id from fixture where name='cashier-actor'));
select throws_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='target-cashier'),'target-cashier@staff-test.invalid',
 (select digest from target_identity),'ADMIN',null,gen_random_uuid())$q$,
 '42501','Staff management owner required','CASHIER cannot assign roles');
select pg_temp.actor((select id from fixture where name='student-actor'));
select throws_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='target-cashier'),'target-cashier@staff-test.invalid',
 (select digest from target_identity),'ADMIN',null,gen_random_uuid())$q$,
 '42501','Staff management owner required','STUDENT cannot assign roles');
select pg_temp.actor((select id from fixture where name='disabled-student'));
select throws_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='target-cashier'),'target-cashier@staff-test.invalid',
 (select digest from target_identity),'ADMIN',null,gen_random_uuid())$q$,
 '42501','Staff management owner required','disabled accounts cannot assign roles');

select pg_temp.actor('5c96debb-697f-4cad-805f-92b518e28343');
select throws_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='disabled-student'),'disabled-student@staff-test.invalid',
 queue_private.google_identity_binding((select id from fixture where name='disabled-student')),
 'CASHIER',(select id from counter1),gen_random_uuid())$q$,
 '42501','Verified eligible Google student required','disabled target accounts cannot be promoted');
select throws_ok($q$select queue_api.add_verified_staff(
 (select id from fixture where name='invalid-google'),'invalid-google@staff-test.invalid',
 repeat('0',64),'CASHIER',(select id from counter1),gen_random_uuid())$q$,
 '42501','Verified eligible Google student required','unverified Google identities cannot be promoted');

select lives_ok($q$select queue_api.configure_counter(
 (select id from counter2),false,array['REF'],array[(select id from fixture where name='target-cashier')],gen_random_uuid())$q$,
 'owner can assign a verified cashier to another fixed counter');
select is((select count(*) from queue_private.staff_counter_assignments
 where account_id=(select id from fixture where name='target-cashier')
 and counter_id=(select id from counter2)),1::bigint,'owner assignment change is persisted');
select lives_ok($q$select queue_api.configure_counter(
 (select id from counter2),false,array['REF'],array[]::uuid[],gen_random_uuid())$q$,
 'owner can revoke a counter assignment');
select is((select count(*) from queue_private.staff_counter_assignments
 where account_id=(select id from fixture where name='target-cashier')
 and counter_id=(select id from counter2)),0::bigint,'counter assignment revocation is persisted');

select lives_ok($q$select queue_api.set_account(
 (select id from fixture where name='target-cashier'),'STUDENT',true,gen_random_uuid())$q$,
 'owner can revoke an existing cashier role');
select is((select role::text from queue_private.accounts where id=(select id from fixture where name='target-cashier')),
 'STUDENT','role revocation updates the account');
select is((select count(*) from queue_private.staff_counter_assignments where account_id=(select id from fixture where name='target-cashier')),
 0::bigint,'role revocation removes only that account assignments');
select is((select count(*) from queue_private.staff_counter_assignments where account_id=(select id from fixture where name='existing-cashier')),
 1::bigint,'other cashier assignments remain intact');

select throws_ok($q$select queue_api.set_account(
 '5c96debb-697f-4cad-805f-92b518e28343','STUDENT',false,gen_random_uuid())$q$,
 '42501','The configured staff-management owner cannot be demoted or disabled',
 'configured owner cannot be accidentally removed or disabled');

select * from finish();
rollback;
