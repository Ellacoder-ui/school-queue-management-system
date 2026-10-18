-- Safe on retained local fixtures: new rows only, all rolled back. No day reopening.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();

create temporary table context_fixture(name text primary key,id uuid not null);
insert into context_fixture select n,gen_random_uuid()
from unnest(array['student','other','cashier','unassigned','admin','disabled','anonymous_auth']) n;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_user_meta_data)
select id,id::text||'@example.invalid',clock_timestamp(),name='anonymous_auth','{"role":"ADMIN"}'::jsonb
from context_fixture;
update queue_private.accounts set role='CASHIER' where id in
 (select id from context_fixture where name in ('cashier','unassigned'));
update queue_private.accounts set role='ADMIN' where id=(select id from context_fixture where name='admin');
update queue_private.accounts set enabled=false where id=(select id from context_fixture where name='disabled');
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select f.id,c.id from context_fixture f cross join queue_private.counters c where f.name='cashier' and c.number=5;
insert into queue_private.counter_services(counter_id,service_id)
select c.id,s.id from queue_private.counters c cross join queue_private.services s where c.number=5 and s.code='ADJ'
on conflict do nothing;
create function pg_temp.context_actor(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform pg_catalog.set_config('request.jwt.claim.sub',(select id::text from pg_temp.context_fixture where name=p_name),true);
end $$;

select ok(has_function_privilege('authenticated','queue_api.my_context()','EXECUTE'),'authenticated may execute self-context');
select ok(not has_function_privilege('anon','queue_api.my_context()','EXECUTE'),'anonymous cannot execute self-context');
select ok(not has_schema_privilege('anon','queue_api','USAGE'),'anonymous API schema boundary unchanged');
select ok(has_function_privilege('anon','queue_display.public_queue_context()','EXECUTE'),'anonymous may execute public context');
select ok(has_function_privilege('authenticated','queue_display.public_queue_context()','EXECUTE'),'authenticated may execute public context');
select ok(not has_function_privilege('service_role','queue_api.my_context()','EXECUTE'),'no service-role self-context grant');
select ok(not has_function_privilege('authenticated','queue_private.public_context_at(timestamptz)','EXECUTE'),'clock helper not executable by authenticated');
select ok(not has_function_privilege('anon','queue_private.public_context_at(timestamptz)','EXECUTE'),'clock helper not executable by anonymous');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
 where oid in ('queue_api.my_context()'::regprocedure,'queue_display.public_queue_context()'::regprocedure)),
 'exposed definers pin empty search_path');
select is((select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),15::bigint,'all application tables retain RLS');
select is((select count(*) from pg_publication_tables where pubname='supabase_realtime'),2::bigint,'publication still has only two tables');

set local role anon;
select throws_ok('select queue_api.my_context()','42501',null,'anonymous self-context denied by schema/function boundary');
select lives_ok('select queue_display.public_queue_context()','anonymous public context succeeds');
select throws_ok('select queue_private.public_context_at(now())','42501',null,'anonymous cannot supply a helper clock');
reset role;
select pg_temp.context_actor('student');
set local role authenticated;
select is(queue_api.my_context(),'{"role":"STUDENT","enabled":true,"cashier_counters":[]}'::jsonb,'student gets only its own minimal context despite ADMIN metadata');
select is((select array_agg(k order by k) from jsonb_object_keys(queue_api.my_context()) k),
 array['cashier_counters','enabled','role'],'self-context has exact field allowlist');
select throws_ok('select queue_private.public_context_at(now())','42501',null,'authenticated cannot supply a helper clock');
reset role;
select pg_temp.context_actor('cashier');
set local role authenticated;
select is(queue_api.my_context()->>'role','CASHIER','cashier gets authoritative DB role');
select is(jsonb_array_length(queue_api.my_context()->'cashier_counters'),1,'only own assigned counter returned');
select is(queue_api.my_context()->'cashier_counters'->0->>'counter_number','5','correct assigned counter');
select is(queue_api.my_context()->'cashier_counters'->0->'service_codes','["ADJ"]'::jsonb,'assigned enabled service codes returned');
select is((select array_agg(k order by k) from jsonb_object_keys(queue_api.my_context()->'cashier_counters'->0) k),
 array['counter_id','counter_label','counter_number','is_open','service_codes'],'counter context has exact field allowlist');
reset role;
select pg_temp.context_actor('unassigned');
set local role authenticated;
select is(queue_api.my_context()->'cashier_counters','[]'::jsonb,'unassigned cashier gets empty assignments');
reset role;
select pg_temp.context_actor('admin');
set local role authenticated;
select is(queue_api.my_context(),'{"role":"ADMIN","enabled":true,"cashier_counters":[]}'::jsonb,'admin receives no cashier override or account directory');
reset role;
select pg_temp.context_actor('disabled');
set local role authenticated;
select is(queue_api.my_context(),'{"role":null,"enabled":false,"cashier_counters":[]}'::jsonb,'disabled policy masks role and assignments');
select throws_ok('select queue_api.my_tickets()','42501',null,'disabled protected reads remain denied');
reset role;
select pg_temp.context_actor('anonymous_auth');
set local role authenticated;
select throws_ok('select queue_api.my_context()','42501','Authenticated account required','anonymous Auth identity is rejected');
reset role;
do $$ begin perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true); end $$;
set local role authenticated;
select throws_ok('select queue_api.my_context()','42501','Authenticated account required','unknown authenticated subject rejected');
reset role;
do $$ begin perform set_config('request.jwt.claim.sub','',true); end $$;
set local role authenticated;
select throws_ok('select queue_api.my_context()','42501','Authenticated account required','authenticated role without subject rejected');
reset role;
-- Change only this transaction's new fixture accounts, retaining their JWT subject.
select pg_temp.context_actor('cashier');
update queue_private.accounts set role='STUDENT' where id=(select id from context_fixture where name='cashier');
set local role authenticated;
select is(queue_api.my_context(),'{"role":"STUDENT","enabled":true,"cashier_counters":[]}'::jsonb,'revoked cashier role takes effect even with stale assignment rows');
select throws_ok('select queue_api.staff_queue()','42501',null,'revoked cashier loses staff read');
reset role;
select pg_temp.context_actor('admin');
update queue_private.accounts set role='STUDENT' where id=(select id from context_fixture where name='admin');
set local role authenticated;
select is(queue_api.my_context()->>'role','STUDENT','revoked admin current role replaces original role');
select throws_ok('select queue_api.admin_configuration()','42501',null,'revoked admin loses admin read');
reset role;

-- New, unused dates only. Do not touch any pre-existing day, even within rollback.
create temporary table context_dates as
select d::date business_date from generate_series(date '2090-01-01',date '2090-12-30',interval '1 day') d
where not exists(select 1 from queue_private.queue_days q where q.business_date in (d::date,d::date+1))
order by d limit 1;
insert into queue_private.queue_days(business_date,timezone_snapshot)
select business_date,'Asia/Manila' from context_dates;
create temporary table context_instants as select
 (business_date::timestamp+interval '12 hours') at time zone 'Asia/Manila' noon,
 ((business_date+1)::timestamp at time zone 'Asia/Manila') midnight
from context_dates;
select is(queue_private.public_context_at((select noon from context_instants))->>'queue_day_open','true','new open day reported open by identical internal projection');
select is(queue_private.public_context_at((select midnight-interval '1 microsecond' from context_instants))->>'business_date',
 (select business_date::text from context_dates),'instant before Manila midnight uses prior date');
select is(queue_private.public_context_at((select midnight from context_instants))->>'business_date',
 (select (business_date+1)::text from context_dates),'exact Manila midnight advances date');
select is(queue_private.public_context_at((select midnight from context_instants))->>'queue_day_open','false','missing new day reports not open');
select is(queue_private.public_context_at((select noon from context_instants))->>'timezone','Asia/Manila','configured institution timezone returned');
select is(queue_private.public_context_at((select noon from context_instants))->'services',
 (select jsonb_agg(jsonb_build_object('code',code,'name',name) order by code) from queue_private.services where enabled),
 'public catalog exactly matches enabled codes and names in stable code order');
select is((select array_agg(k order by k) from jsonb_object_keys(queue_private.public_context_at((select noon from context_instants))) k),
 array['business_date','queue_day_open','services','timezone'],'public context exact field allowlist');
select is((select array_agg(k order by k) from jsonb_object_keys(queue_display.public_queue_context()->'services'->0) k),
 array['code','name'],'public service exact field allowlist');
update queue_private.queue_days set closed_at=clock_timestamp(),closed_by=(select id from context_fixture where name='admin')
where business_date=(select business_date from context_dates);
select is(queue_private.public_context_at((select noon from context_instants))->>'queue_day_open','false','formally closed new fixture day reports not open');
select is(queue_display.public_queue_context()->>'business_date',(clock_timestamp() at time zone 'Asia/Manila')::date::text,
 'public wrapper uses server clock, not deterministic test time');
select is(queue_display.public_queue_context()->>'queue_day_open',
 (exists(select 1 from queue_private.queue_days where business_date=(clock_timestamp() at time zone 'Asia/Manila')::date and closed_at is null))::text,
 'public wrapper matches authoritative current day');
select * from finish();
rollback;
