-- Run only against a disposable local Supabase database: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
create temporary table fixture(name text primary key,id uuid not null);
insert into fixture values('student',gen_random_uuid()),('other',gen_random_uuid()),
 ('cashier',gen_random_uuid()),('admin',gen_random_uuid()),('unassigned',gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at)
select id,id::text||'@example.invalid',clock_timestamp() from fixture;
select queue_private.bootstrap_admin((select id from fixture where name='admin'));
update queue_private.accounts set role='CASHIER' where id in (select id from fixture where name in ('cashier','unassigned'));
insert into fixture select 'counter',id from queue_private.counters where number=1;

create function pg_temp.actor(p_name text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',(select id::text from fixture where name=p_name),true);
end;
$$;
create function pg_temp.fails(p_sql text,p_message text) returns boolean language plpgsql as $$
begin
 execute p_sql; return false;
exception when others then return position(p_message in sqlerrm)>0;
end $$;

select pg_temp.actor('admin');
select ok(pg_temp.fails($q$select queue_private.bootstrap_admin((select id from fixture where name='other'))$q$,'Bootstrap already completed'),'bootstrap is one-time');
select lives_ok($q$select queue_api.configure_counter((select id from fixture where name='counter'),true,array['TP'],
 array[(select id from fixture where name='cashier')],gen_random_uuid())$q$,'admin configures counter');
select lives_ok($q$select queue_api.manage_day('OPEN',(clock_timestamp() at time zone 'Asia/Manila')::date,gen_random_uuid())$q$,'admin opens day');
select pg_temp.actor('student');
select ok(pg_temp.fails($q$select queue_api.set_account((select id from fixture where name='student'),'ADMIN',true,gen_random_uuid())$q$,'Administrator required'),'student cannot escalate');
create temporary table issued as select queue_api.issue_ticket('TP',gen_random_uuid()) as result;
select is((select result->>'sequence_number' from issued),'1','first TP number is one');
select ok(pg_temp.fails($q$select queue_api.issue_ticket('SOA',gen_random_uuid())$q$,'Active ticket'),'one active ticket across services');
select pg_temp.actor('unassigned');
select ok(pg_temp.fails($q$select queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid())$q$,'Assigned cashier'),'unassigned cashier rejected');
select pg_temp.actor('other');
select queue_api.issue_ticket('TP',gen_random_uuid());
select is(queue_api.my_tickets()->0->>'number','2','other student has next number');
select ok(pg_temp.fails($q$select queue_api.my_ticket_events((select (result->>'ticket_id')::uuid from issued))$q$,'Unauthorized'),'cross-owner history denied');
select pg_temp.actor('cashier');
select is(queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid())->>'ticket_id',
 (select result->>'ticket_id' from issued),'oldest called first');
select queue_api.finish_ticket((select (result->>'ticket_id')::uuid from issued),'SKIP',gen_random_uuid());
select is((select sequence_number::text from queue_private.tickets where id=(select (result->>'ticket_id')::uuid from issued)),'1','skip retains number');
select is((select status::text from queue_private.tickets where id=(select (result->>'ticket_id')::uuid from issued)),'WAITING','skip returns waiting');
select isnt(queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid())->>'ticket_id',
 (select result->>'ticket_id' from issued),'skip moves behind existing waiter');
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid());
select queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid());
select queue_api.finish_ticket((select (result->>'ticket_id')::uuid from issued),'SERVE',gen_random_uuid());
select is((select count(*) from queue_private.tickets where owner_id=(select id from fixture where name='student') and status='SERVED'),1::bigint,'skipped then served counts once');
select pg_temp.actor('student');
select queue_api.issue_ticket('TP',gen_random_uuid());
select pg_temp.actor('cashier');
select queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid());
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid());
select pg_temp.actor('student');
select ok(pg_temp.fails($q$select queue_api.issue_ticket('TP',gen_random_uuid())$q$,'Daily served-ticket limit'),'third same-service ticket refused after two served');
select lives_ok($q$select queue_api.issue_ticket('SOA',gen_random_uuid())$q$,'quota is per service');
select pg_temp.actor('admin');
select queue_api.manage_day('CLOSE',(clock_timestamp() at time zone 'Asia/Manila')::date,gen_random_uuid());
select is((select count(*) from queue_private.tickets where status in ('WAITING','CALLED')),0::bigint,'closure removes all active tickets for day');
select ok(pg_temp.fails($q$select queue_api.manage_day('OPEN',(clock_timestamp() at time zone 'Asia/Manila')::date,gen_random_uuid())$q$,'cannot reopen'),'closed day cannot reopen');
select ok(pg_temp.fails($q$select queue_api.set_account((select id from fixture where name='admin'),'STUDENT',true,gen_random_uuid())$q$,'last enabled administrator'),'last admin protected');

-- Trusted fixture models a ticket issued yesterday, still active after midnight.
-- Reopen today's fixture directly ONLY to model a fresh open day after closure tests.
update queue_private.queue_days set closed_at=null,closed_by=null where business_date=(clock_timestamp() at time zone 'Asia/Manila')::date;
insert into queue_private.queue_days(business_date,timezone_snapshot)
values((clock_timestamp() at time zone 'Asia/Manila')::date-1,'Asia/Manila');
insert into queue_private.service_day_state(queue_day_id,service_id,last_number)
select d.id,s.id,1 from queue_private.queue_days d cross join queue_private.services s
where d.business_date=(clock_timestamp() at time zone 'Asia/Manila')::date-1 and s.code='TP';
update queue_private.settings set last_wait_position=last_wait_position+1;
insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,issued_at)
select f.id,ds.queue_day_id,ds.service_id,1,st.last_wait_position,clock_timestamp()-interval '1 day'
from fixture f cross join queue_private.settings st cross join queue_private.service_day_state ds
join queue_private.queue_days d on d.id=ds.queue_day_id
where f.name='student' and d.business_date=(clock_timestamp() at time zone 'Asia/Manila')::date-1;
select pg_temp.actor('student');
select ok(pg_temp.fails($q$select queue_api.issue_ticket('TP',gen_random_uuid())$q$,'Active ticket'),'prior-day active ticket blocks new-day issuance');
select pg_temp.actor('cashier');
select lives_ok($q$select queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid())$q$,'prior-day active ticket can be called');
select lives_ok($q$select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid())$q$,'prior-day quota independent of two served today');
select is((select count(*) from queue_private.tickets t join queue_private.queue_days d on d.id=t.queue_day_id
where t.owner_id=(select id from fixture where name='student') and t.status='SERVED' and d.business_date=(clock_timestamp() at time zone 'Asia/Manila')::date-1),1::bigint,'midnight completion charges issuance day');

-- Numbering is independent of the previous day's allocation.
insert into queue_private.service_day_state(queue_day_id,service_id,last_number)
select d.id,s.id,99 from queue_private.queue_days d cross join queue_private.services s
where d.business_date=(clock_timestamp() at time zone 'Asia/Manila')::date-1 and s.code='REF';
select pg_temp.actor('other');
select is(queue_api.issue_ticket('REF',gen_random_uuid())->>'sequence_number','1','new-day service numbering starts at one despite yesterday allocation');
select pg_temp.actor('student');
select ok(pg_temp.fails($q$select queue_api.issue_ticket('TP',gen_random_uuid())$q$,'Daily served-ticket limit'),'prior-day completion does not change current-day quota');

-- Defensive completion check even if a future trusted import admits an extra ticket.
update queue_private.settings set last_wait_position=last_wait_position+1;
update queue_private.service_day_state set last_number=last_number+1
where queue_day_id=(select id from queue_private.queue_days where business_date=(clock_timestamp() at time zone 'Asia/Manila')::date)
and service_id=(select id from queue_private.services where code='TP');
insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position)
select f.id,ds.queue_day_id,ds.service_id,ds.last_number,st.last_wait_position
from fixture f cross join queue_private.settings st cross join queue_private.service_day_state ds
join queue_private.queue_days d on d.id=ds.queue_day_id join queue_private.services s on s.id=ds.service_id
where f.name='student' and d.business_date=(clock_timestamp() at time zone 'Asia/Manila')::date and s.code='TP';
select pg_temp.actor('cashier');
select queue_api.call_next((select id from fixture where name='counter'),'TP',gen_random_uuid());
select ok(pg_temp.fails($q$select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid())$q$,'Daily served-ticket limit'),'completion also enforces served quota');
select pg_temp.actor('admin');
select queue_api.manage_day('CLOSE',(clock_timestamp() at time zone 'Asia/Manila')::date,gen_random_uuid());
select is((select count(*) from queue_private.tickets where status='CALLED'),0::bigint,'closure releases called counter');

select ok(not has_schema_privilege('authenticated','queue_private','USAGE'),'private schema unavailable');
select ok(not has_function_privilege('anon','queue_api.issue_ticket(text,uuid)','EXECUTE'),'anonymous issuance denied');
select ok(not has_function_privilege('authenticated','queue_private.bootstrap_admin(uuid)','EXECUTE'),'browser bootstrap denied');
select ok(not has_table_privilege('authenticated','queue_private.accounts','UPDATE'),'browser role update denied');
select ok(not exists(select 1 from pg_tables where schemaname in ('queue_private','queue_display') and not rowsecurity),'all application tables have RLS');
select ok(not exists(select 1 from information_schema.columns where table_schema='queue_display' and column_name in ('owner_id','student_number','display_name','actor_id')),'display has no private identity columns');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_api','queue_private')
 and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false)),'definers pin empty search path');
-- Actual browser execution context: direct private reads and writes must fail.
grant select on fixture to authenticated;
select pg_temp.actor('student');
set local role authenticated;
do $$ begin
 begin perform 1 from queue_private.accounts; raise exception 'TEST FAILED: private read allowed';
 exception when insufficient_privilege then null; end;
 begin update queue_private.accounts set role='ADMIN'; raise exception 'TEST FAILED: private update allowed';
 exception when insufficient_privilege then null; end;
 perform queue_api.my_tickets();
 perform 1 from queue_display.counter_state;
end $$;
reset role;
select pass('authenticated context enforces private access and permits owner RPC/display');
select * from finish();
rollback;
