-- Run in the disposable Supabase test database after migrations 001-008.
-- All fixture accounts, tickets, schedules and counter changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table fixture(name text primary key,id uuid not null);
insert into fixture
select name,case when name='cashier1' then (
 select x.account_id from queue_private.staff_counter_assignments x
 join queue_private.counters c on c.id=x.counter_id where c.number=1
) else gen_random_uuid() end
from unnest(array['cashier1','cashier2','unassigned','student01','student02','student03','student04',
 'student05','student06','student07','student08','student09','student10','student11']) as name;
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='email_confirmed_at') then
  execute 'insert into auth.users(id,email,email_confirmed_at) select id,id::text||''@cutoff.invalid'',clock_timestamp() from pg_temp.fixture on conflict(id) do nothing';
 else
  execute 'insert into auth.users(id,email,confirmed_at) select id,id::text||''@cutoff.invalid'',clock_timestamp() from pg_temp.fixture on conflict(id) do nothing';
 end if;
end $$;
update queue_private.accounts set role='CASHIER'
where id in (select id from fixture where name in ('cashier1','cashier2','unassigned'));
create temporary table target_counters as
select number,id from queue_private.counters where number in (1,2);
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select f.id,c.id from fixture f cross join target_counters c
where f.name='cashier2' and c.number=2;
update queue_private.counters set is_open=true;

create function pg_temp.actor(p_name text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',(select id::text from fixture where name=p_name),true);
end $$;
create function pg_temp.local_instant(p_date date,p_time time) returns timestamptz language sql immutable as $$
 select (p_date+p_time) at time zone 'Asia/Manila';
$$;

select ok(has_function_privilege('authenticated','queue_api.set_counter_open(uuid,boolean,uuid)','EXECUTE'),'cashiers can call the counter-state RPC');
select ok(not has_function_privilege('anon','queue_api.set_counter_open(uuid,boolean,uuid)','EXECUTE'),'anonymous counter-state calls are denied');
select is((select count(*) from cron.job where jobname in ('cqs-issuance-cutoff-publish','cqs-close-counters-at-five')),2::bigint,'both daily schedule jobs are installed');
select ok(not has_function_privilege('authenticated','queue_private.issue_ticket_at(text,uuid,timestamptz)','EXECUTE'),'time-controlled issuance helper is private');
select ok(not has_function_privilege('authenticated','queue_private.evaluate_service_day_cutoffs(timestamptz)','EXECUTE'),'cutoff snapshot helper is private');

select pg_temp.actor('cashier1');
select is(queue_private.set_counter_open_at((select id from target_counters where number=1),false,gen_random_uuid(),
 pg_temp.local_instant(current_date,time '10:00'))->>'open','false','assigned cashier can close Counter 1');
select pg_temp.actor('cashier2');
select is(queue_api.my_context()->'cashier_counters'->0->>'is_open','true','Counter 2 remains independent of Counter 1');
select pg_temp.actor('unassigned');
select throws_ok($q$select queue_private.set_counter_open_at((select id from target_counters where number=1),true,gen_random_uuid(),
 pg_temp.local_instant(current_date,time '10:00'))$q$,'42501','Assigned cashier required','unassigned cashier cannot change a counter');
select pg_temp.actor('cashier2');
select is(queue_private.set_counter_open_at((select id from target_counters where number=2),true,gen_random_uuid(),
 pg_temp.local_instant(current_date,time '10:00'))->>'open','true','assigned cashier can open only Counter 2');
select pg_temp.actor('cashier1');
select is(queue_private.set_counter_open_at((select id from target_counters where number=1),true,gen_random_uuid(),
 pg_temp.local_instant(current_date,time '10:01'))->>'open','true','assigned cashier can reopen Counter 1 independently');

create temporary table test_day as
select (clock_timestamp() at time zone 'Asia/Manila')::date+10 as business_date;
insert into queue_private.queue_days(business_date,timezone_snapshot)
select business_date,'Asia/Manila' from test_day;
insert into queue_private.service_day_state(queue_day_id,service_id,last_number)
select d.id,s.id,case s.code when 'TP' then 9 when 'SOA' then 10 else 11 end
from queue_private.queue_days d cross join queue_private.services s
where d.business_date=(select business_date from test_day);

create temporary table cutoff_fixture(service_code text primary key,active_count integer);
insert into cutoff_fixture values('TP',9),('SOA',10),('PNEP',11);
create temporary table cutoff_base as
select greatest(s.last_wait_position,coalesce((select max(t.wait_position) from queue_private.tickets t),0)) as first_wait_position
from queue_private.settings s where s.id;
update queue_private.settings set last_wait_position=(select first_wait_position+30 from cutoff_base) where id;

with ticket_rows as (
 select s.id as service_id,f.id as owner_id,d.id as queue_day_id,x.service_code,x.active_count,n,
   row_number() over(order by x.service_code,n)::bigint as position_offset,
   pg_temp.local_instant(d.business_date,time '16:29') as issued_at,
   pg_temp.local_instant(d.business_date,time '16:45') as served_at
 from cutoff_fixture x
 join queue_private.services s on s.code=x.service_code
 cross join fixture f cross join queue_private.queue_days d
 cross join lateral generate_series(1,x.active_count) n
 where f.name='student10' and d.business_date=(select business_date from test_day)
), inserted as (
 insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,status,issued_at,served_at)
 select owner_id,queue_day_id,service_id,n,(select first_wait_position from cutoff_base)+position_offset,
  'SERVED',issued_at,served_at from ticket_rows
 returning id,issued_at,served_at
)
insert into queue_private.ticket_events(ticket_id,event_type,from_status,to_status,occurred_at)
select id,'ISSUED',null::queue_private.ticket_status,'WAITING'::queue_private.ticket_status,issued_at from inserted
union all
select id,'SERVED','WAITING'::queue_private.ticket_status,'SERVED'::queue_private.ticket_status,served_at from inserted;

select is(queue_private.ticket_issuance_status('TP',
 pg_temp.local_instant((select business_date from test_day),time '16:29:59')),'OPEN','normal admission remains open before 4:30 PM');
select lives_ok($q$select queue_private.evaluate_service_day_cutoffs(
 pg_temp.local_instant((select business_date from test_day),time '16:30'))$q$,
 'server evaluation stores each service cutoff decision');
select is((select active_count from queue_private.service_day_cutoffs c join queue_private.services s on s.id=c.service_id
 join queue_private.queue_days d on d.id=c.queue_day_id where d.business_date=(select business_date from test_day) and s.code='TP'),9,'TP snapshot records nine active tickets');
select is((select active_count from queue_private.service_day_cutoffs c join queue_private.services s on s.id=c.service_id
 join queue_private.queue_days d on d.id=c.queue_day_id where d.business_date=(select business_date from test_day) and s.code='SOA'),10,'SOA snapshot records ten active tickets');
select is((select active_count from queue_private.service_day_cutoffs c join queue_private.services s on s.id=c.service_id
 join queue_private.queue_days d on d.id=c.queue_day_id where d.business_date=(select business_date from test_day) and s.code='PNEP'),11,'PNEP snapshot records eleven active tickets');
select is(queue_private.ticket_issuance_status('TP',
 pg_temp.local_instant((select business_date from test_day),time '16:30')),'OPEN','nine active tickets remain eligible');
select is(queue_private.ticket_issuance_status('SOA',
 pg_temp.local_instant((select business_date from test_day),time '16:30')),'QUEUE_CUTOFF','ten active tickets cut off SOA');
select is(queue_private.ticket_issuance_status('PNEP',
 pg_temp.local_instant((select business_date from test_day),time '16:30')),'QUEUE_CUTOFF','eleven active tickets cut off PNEP');
select is(queue_private.ticket_issuance_status('SOA',
 pg_temp.local_instant((select business_date from test_day),time '16:45')),'QUEUE_CUTOFF','served tickets do not erase the stored cutoff decision');
select lives_ok($q$select queue_private.evaluate_service_day_cutoffs(
 pg_temp.local_instant((select business_date from test_day),time '16:50'))$q$,
 're-evaluation leaves the one-time decision unchanged');
select is((select active_count from queue_private.service_day_cutoffs c join queue_private.services s on s.id=c.service_id
 join queue_private.queue_days d on d.id=c.queue_day_id where d.business_date=(select business_date from test_day) and s.code='TP'),9,'repeat evaluation does not rewrite cutoff counts');

select pg_temp.actor('student11');
select is(queue_private.issue_ticket_at('TP',gen_random_uuid(),
 pg_temp.local_instant((select business_date from test_day),time '16:40'))->>'status','WAITING','service below ten at cutoff can still issue after 4:30 PM');
select pg_temp.actor('cashier1');
select queue_private.set_counter_open_at((select id from target_counters where number=1),false,gen_random_uuid(),
 pg_temp.local_instant((select business_date from test_day),time '16:20'));
select is(queue_private.ticket_issuance_status('TP',
 pg_temp.local_instant((select business_date from test_day),time '16:20')),'COUNTER_CLOSED',
 'closed counter is unavailable before the cutoff');
create temporary table closed_issue_count as
select count(*)::bigint as total from queue_private.tickets where owner_id=(select id from fixture where name='student01');
select pg_temp.actor('student01');
select throws_ok($q$select queue_private.issue_ticket_at('TP',gen_random_uuid(),
 pg_temp.local_instant((select business_date from test_day),time '16:20'))$q$,
 'P0001','Counter is currently closed.','closed counter rejects issuance in the backend');
select is((select count(*) from queue_private.tickets where owner_id=(select id from fixture where name='student01')),
 (select total from closed_issue_count),'closed-counter rejection does not create a ticket');
select pg_temp.actor('cashier1');
select queue_private.set_counter_open_at((select id from target_counters where number=1),true,gen_random_uuid(),
 pg_temp.local_instant((select business_date from test_day),time '16:21'));
select pg_temp.actor('student01');
select throws_ok($q$select queue_private.issue_ticket_at('SOA',gen_random_uuid(),
 pg_temp.local_instant((select business_date from test_day),time '16:40'))$q$,
 'P0001','Ticket issuance for this service has ended today.','stored cutoff blocks issuance in the backend');
select throws_ok($q$select queue_private.issue_ticket_at('SOA',gen_random_uuid(),
 pg_temp.local_instant((select business_date from test_day),time '17:00'))$q$,
 'P0001','Ticket issuance closes at 5:00 PM','all services reject issuance at 5:00 PM');
select is(queue_private.ticket_issuance_status('TP',
 pg_temp.local_instant((select business_date from test_day),time '17:00')),'AFTER_HOURS','after-hours status takes precedence');

select lives_ok($q$select queue_private.close_counters_at(pg_temp.local_instant((select business_date from test_day),time '16:59'))$q$,
 'scheduled close is safe before 5:00 PM');
select is((select count(*) from queue_private.counters where is_open),5::bigint,'all counters remain open before close time');
select lives_ok($q$select queue_private.close_counters_at(pg_temp.local_instant((select business_date from test_day),time '17:00'))$q$,
 'scheduled close runs at 5:00 PM Manila time');
select is((select count(*) from queue_private.counters where is_open),0::bigint,'all counters close at the 5:00 PM boundary');
select * from finish();
rollback;
