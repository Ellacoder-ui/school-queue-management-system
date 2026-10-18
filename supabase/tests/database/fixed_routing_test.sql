-- Isolated project only. Every fixture and negative DML attempt rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select is((select jsonb_object_agg(c.number::text,s.code) from queue_private.counter_services cs
 join queue_private.counters c on c.id=cs.counter_id join queue_private.services s on s.id=cs.service_id),
 '{"1":"TP","2":"SOA","3":"PNEP","4":"REF","5":"ADJ"}'::jsonb,'exact canonical matrix');
select is((select count(*) from queue_private.counter_services),5::bigint,'exactly five routes');
select is((select count(*) from pg_constraint where conrelid='queue_private.counter_services'::regclass and contype='u'),2::bigint,'both one-to-one upper bounds');
select ok(exists(select 1 from pg_constraint where conrelid='queue_private.tickets'::regclass and confrelid='queue_private.counter_services'::regclass),'existing ticket route FK retained');
select ok(to_regclass('queue_private.one_active_ticket') is not null,'active-ticket index retained');
select ok(to_regclass('queue_private.one_called_per_counter') is not null,'called-counter index retained');
select is((select count(*) from pg_trigger where tgname in ('fixed_routing_complete','fixed_counters_complete','fixed_services_complete') and tgdeferrable and tginitdeferred),3::bigint,'complete-map checks are deferred');
select is((select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),15::bigint,'RLS retained');
select is((select count(*) from pg_publication_tables where pubname='supabase_realtime'),2::bigint,'publication remains two tables');
select ok(not has_schema_privilege('anon','queue_private','USAGE'),'anon private boundary retained');
select ok(not has_schema_privilege('authenticated','queue_private','USAGE'),'authenticated private boundary retained');
select ok(has_function_privilege('authenticated','queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid)','EXECUTE'),'existing ADMIN RPC grant retained');
select ok(not has_function_privilege('anon','queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid)','EXECUTE'),'anonymous configuration denied');
select ok(not has_function_privilege('authenticated','queue_private.assert_fixed_routing()','EXECUTE'),'private validator inaccessible');
select ok(not has_function_privilege('anon','queue_private.fixed_service_code(smallint)','EXECUTE'),'canonical helper inaccessible');
select ok(not has_function_privilege('service_role','queue_private.lock_fixed_routing_statement()','EXECUTE'),'no service-role trigger helper grant');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('queue_private','queue_api') and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false)),
 'definers retain pinned empty search_path');

create function pg_temp.rejection(p_sql text) returns text language plpgsql as $$
begin
 execute p_sql;
 set constraints all immediate;
 return 'NONE';
exception when others then return SQLSTATE;
end $$;
select is(pg_temp.rejection($q$insert into queue_private.counter_services select c.id,s.id from queue_private.counters c cross join queue_private.services s where c.number=1 and s.code='SOA'$q$),'23505','second service rejected by uniqueness');
select is(pg_temp.rejection($q$insert into queue_private.counter_services select c.id,s.id from queue_private.counters c cross join queue_private.services s where c.number=5 and s.code='TP'$q$),'23505','service reused at another counter rejected');
select is(pg_temp.rejection($q$delete from queue_private.counter_services where counter_id=(select id from queue_private.counters where number=5)$q$),'23514','missing mandatory mapping rejected on validation');
select is(pg_temp.rejection($q$delete from queue_private.counter_services where counter_id in(select id from queue_private.counters where number in(1,2));
 insert into queue_private.counter_services select c.id,s.id from queue_private.counters c join queue_private.services s
 on s.code=case c.number when 1 then 'SOA' when 2 then 'TP' end where c.number in(1,2)$q$),'23514','one-to-one but incorrect swapped pairs rejected');
select ok(pg_temp.rejection($q$delete from queue_private.counter_services where counter_id=(select id from queue_private.counters where number=5);
 delete from queue_private.counters where number=5$q$) in ('23514','23503'),'counter deletion rejected by completeness or historical FK');
select ok(pg_temp.rejection($q$delete from queue_private.counter_services where service_id=(select id from queue_private.services where code='ADJ');
 delete from queue_private.services where code='ADJ'$q$) in ('23514','23503'),'service deletion rejected by completeness or historical FK');
select is(pg_temp.rejection($q$truncate queue_private.counter_services cascade$q$),'23514','TRUNCATE bypass rejected before data removal');
select is(pg_temp.rejection($q$update queue_private.counters set number=6 where number=5$q$),'23514','renumber bypass rejected');
select is(pg_temp.rejection($q$update queue_private.services set code='OTHER' where code='ADJ'$q$),'23514','service code bypass rejected');
set constraints all deferred;
select lives_ok($q$delete from queue_private.counter_services where counter_id=(select id from queue_private.counters where number=5);
 insert into queue_private.counter_services select c.id,s.id from queue_private.counters c cross join queue_private.services s where c.number=5 and s.code='ADJ';
 set constraints all immediate$q$,'atomic remove/restore of canonical pair validates final complete state');
set constraints all deferred;
update queue_private.services set enabled=false where code='ADJ';
select is((select count(*) from queue_private.counter_services where service_id=(select id from queue_private.services where code='ADJ')),1::bigint,'disabled service retains its mandatory route');
select ok(not exists(select 1 from jsonb_array_elements(queue_display.public_queue_context()->'services') s where s->>'code'='ADJ'),'disabled service excluded from public catalog');
update queue_private.services set enabled=true where code='ADJ';

create temporary table routing_fixture(name text primary key,id uuid);
insert into routing_fixture select n,gen_random_uuid() from unnest(array['admin','cashier','student','disabled']) n;
insert into auth.users(id,email,email_confirmed_at) select id,id::text||'@fixed-routing.invalid',clock_timestamp() from routing_fixture;
update queue_private.accounts set role='ADMIN' where id=(select id from routing_fixture where name='admin');
update queue_private.accounts set role='CASHIER' where id=(select id from routing_fixture where name='cashier');
update queue_private.accounts set enabled=false where id=(select id from routing_fixture where name='disabled');
insert into routing_fixture select 'counter',id from queue_private.counters where number=1;
grant select on routing_fixture to authenticated;
create function pg_temp.actor(p_name text) returns void language plpgsql security definer set search_path='' as $$
begin perform set_config('request.jwt.claim.sub',(select id::text from pg_temp.routing_fixture where name=p_name),true); end $$;
select pg_temp.actor('admin');
set local role authenticated;
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array['TP','SOA'],array[]::uuid[],gen_random_uuid())$q$,'22023','Counter requires its single fixed service','ADMIN multiple services rejected');
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array[]::text[],array[]::uuid[],gen_random_uuid())$q$,'22023','Counter requires its single fixed service','ADMIN empty mapping rejected even while closed');
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array['SOA'],array[]::uuid[],gen_random_uuid())$q$,'22023','Counter requires its single fixed service','ADMIN wrong service rejected');
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array['TP','TP'],array[]::uuid[],gen_random_uuid())$q$,'22023','Counter requires its single fixed service','ADMIN duplicate service items rejected');
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),true,array['TP'],array[(select id from routing_fixture where name='student')],gen_random_uuid())$q$,'P0001','Unknown service or ineligible cashier','student cannot become eligible staffing');
select lives_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),true,array['TP'],array[(select id from routing_fixture where name='cashier')],gen_random_uuid())$q$,'ADMIN opens counter with eligible cashier and fixed service');
reset role;
select is((select count(*) from queue_private.counter_services),5::bigint,'opening counter preserves every route');
select pg_temp.actor('cashier');
set local role authenticated;
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array['TP'],array[]::uuid[],gen_random_uuid())$q$,'42501','Administrator required','cashier cannot administer mapping');
select throws_ok($q$select queue_api.call_next((select id from routing_fixture where name='counter'),'SOA',gen_random_uuid())$q$,'P0001','Service not assigned or disabled','cashier cannot spoof another service at assigned counter');
reset role;
select pg_temp.actor('student');
set local role authenticated;
select throws_ok($q$select queue_api.call_next((select id from routing_fixture where name='counter'),'TP',gen_random_uuid())$q$,'42501','Assigned cashier required','student cannot call queue');
select throws_ok('select queue_private.assert_fixed_routing()','42501',null,'authenticated cannot invoke invariant helper');
reset role;
select pg_temp.actor('disabled');
set local role authenticated;
select throws_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array['TP'],array[]::uuid[],gen_random_uuid())$q$,'42501','Unauthorized','disabled account denied before replay/configuration');
reset role;
select pg_temp.actor('admin');
set local role authenticated;
select lives_ok($q$select queue_api.configure_counter((select id from routing_fixture where name='counter'),false,array['TP'],array[]::uuid[],gen_random_uuid())$q$,'ADMIN closes counter while keeping fixed service');
reset role;
select is((select count(*) from queue_private.counter_services),5::bigint,'closed counters remain mapped');
select lives_ok('select queue_private.assert_fixed_routing()','final routing invariant valid');
select * from finish();
rollback;
