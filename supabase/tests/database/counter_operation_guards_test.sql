-- Run only against the disposable Supabase test database. All fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table fixture(name text primary key,id uuid not null);
insert into fixture
select name,gen_random_uuid()
from unnest(array['cashier1','cashier2','admin','student']) as name;

do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='email_confirmed_at') then
  execute 'insert into auth.users(id,email,email_confirmed_at) select id,id::text||''@counter-lock.invalid'',clock_timestamp() from pg_temp.fixture';
 else
  execute 'insert into auth.users(id,email,confirmed_at) select id,id::text||''@counter-lock.invalid'',clock_timestamp() from pg_temp.fixture';
 end if;
end $$;

update queue_private.accounts set role='CASHIER'
where id in (select id from fixture where name in ('cashier1','cashier2'));
update queue_private.accounts set role='ADMIN'
where id=(select id from fixture where name='admin');
create temporary table target_counter as
select id,number from queue_private.counters where number=3;
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select f.id,c.id from fixture f cross join target_counter c
where f.name='cashier1';
select throws_ok($q$insert into queue_private.staff_counter_assignments(account_id,counter_id)
 select (select id from fixture where name='cashier2'),id from target_counter$q$,
 '23505','Cashier or counter already has an active assignment',
 'a second cashier cannot be assigned to an occupied counter');
update queue_private.counters set is_open=true where id=(select id from target_counter);

create temporary table test_day as
select (clock_timestamp() at time zone 'Asia/Manila')::date+100 as business_date;
insert into queue_private.queue_days(business_date,timezone_snapshot)
select business_date,'Asia/Manila' from test_day;
insert into queue_private.service_day_state(queue_day_id,service_id,last_number)
select d.id,s.id,0
from queue_private.queue_days d cross join queue_private.services s
where d.business_date=(select business_date from test_day);

create temporary table wait_position as
with updated as (
 update queue_private.settings
 set last_wait_position=greatest(last_wait_position,coalesce((select max(wait_position) from queue_private.tickets),0))+1
 where id returning last_wait_position
)
select last_wait_position from updated;
insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,status)
select f.id,d.id,s.id,1,p.last_wait_position,'WAITING'
from fixture f cross join queue_private.queue_days d
cross join queue_private.services s cross join wait_position p
where f.name='student' and d.business_date=(select business_date from test_day) and s.code='PNEP';

create function pg_temp.actor(p_name text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',(select id::text from fixture where name=p_name),true);
end $$;
create function pg_temp.local_instant(p_time time) returns timestamptz language sql immutable as $$
 select ((select business_date from test_day)+p_time) at time zone 'Asia/Manila';
$$;

select ok(has_function_privilege('authenticated','queue_api.call_next(uuid,text,uuid)','EXECUTE'),
 'authenticated cashier call privilege remains installed');
select ok(not has_function_privilege('anon','queue_api.call_next(uuid,text,uuid)','EXECUTE'),
 'anonymous call privilege remains denied');
select ok(position('for update' in lower(pg_get_functiondef('queue_api.call_next(uuid,text,uuid)'::regprocedure)))>0,
 'call_next serializes callers on a counter row');
select ok(position('for update' in lower(pg_get_functiondef('queue_api.call_next(uuid,text,uuid)'::regprocedure)))
 < position('staff_counter_assignments' in lower(pg_get_functiondef('queue_api.call_next(uuid,text,uuid)'::regprocedure))),
 'call_next revalidates cashier assignment after acquiring the counter lock');
select ok(position('for update' in lower(pg_get_functiondef('queue_private.set_counter_open_at(uuid,boolean,uuid,timestamptz)'::regprocedure)))
 < position('staff_counter_assignments' in lower(pg_get_functiondef('queue_private.set_counter_open_at(uuid,boolean,uuid,timestamptz)'::regprocedure))),
 'counter toggles revalidate cashier assignment after acquiring the counter lock');
select ok(position('assert_counter_opening_allowed' in lower(pg_get_functiondef('queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid)'::regprocedure)))>0,
 'ADMIN counter configuration shares the after-hours opening guard');
select lives_ok($q$select queue_private.assert_counter_opening_allowed(true,pg_temp.local_instant(time '16:59:59'))$q$,
 'counter opening remains allowed before 5 PM Manila');
select throws_ok($q$select queue_private.assert_counter_opening_allowed(true,pg_temp.local_instant(time '17:00'))$q$,
 'P0001','Counter opening is unavailable after 5:00 PM','counter opening is blocked exactly at 5 PM Manila');
select lives_ok($q$select queue_private.assert_counter_opening_allowed(false,pg_temp.local_instant(time '17:00'))$q$,
 'closing remains allowed at and after 5 PM Manila');

select pg_temp.actor('cashier1');
select is(queue_api.call_next((select id from target_counter),'PNEP',gen_random_uuid())->>'status','CALLED',
 'assigned cashier calls the waiting ticket');
select throws_ok($q$select queue_api.call_next((select id from target_counter),'PNEP',gen_random_uuid())$q$,
 'P0001','Counter busy','a cashier cannot call another ticket while the counter has an active call');
select throws_ok($q$select queue_private.set_counter_open_at((select id from target_counter),false,gen_random_uuid(),
 pg_temp.local_instant(time '16:00'))$q$,
 'P0001','Resolve called ticket before closing counter','cashier cannot close a counter with an active call');
select pg_temp.actor('student');
select throws_ok($q$select queue_api.set_counter_open((select id from target_counter),false,gen_random_uuid())$q$,
 '42501','Assigned cashier required','student cannot change shared counter state');

rollback;
