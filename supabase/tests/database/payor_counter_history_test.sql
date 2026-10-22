-- Run only against a disposable local Supabase database after migration 018.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();

create temporary table fixture(name text primary key,id uuid not null);
insert into fixture values
 ('student',gen_random_uuid()),('other_student',gen_random_uuid()),
 ('cashier',gen_random_uuid()),('replacement_cashier',gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at)
select id,id::text||'@example.invalid',clock_timestamp() from fixture;
update queue_private.accounts set role='CASHIER' where id in
 ((select id from fixture where name='cashier'),(select id from fixture where name='replacement_cashier'));
insert into fixture select 'counter',id from queue_private.counters where number=4;
create temporary table issued(name text primary key,id uuid not null);

create function pg_temp.actor(p_name text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',(select id::text from fixture where name=p_name),true);
end;
$$;

update queue_private.settings set last_wait_position=(select coalesce(max(wait_position),0) from queue_private.tickets) where id;
select is((select count(*)::int from queue_private.queue_days
 where business_date=(clock_timestamp() at time zone 'Asia/Manila')::date and closed_at is null),1,
 'current queue day exists for transaction test');
update queue_private.counters set is_open=true where id=(select id from fixture where name='counter');
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select id,(select id from fixture where name='counter') from fixture where name='cashier';
select pg_temp.actor('student');
insert into issued select 'tp',(queue_api.issue_ticket('REF',gen_random_uuid())->>'ticket_id')::uuid;
select is((select x->>'counter' from jsonb_array_elements(queue_api.my_tickets()) x
 where x->>'id'=(select id::text from issued where name='tp')),'Awaiting counter','WAITING ticket has no invented counter');

select pg_temp.actor('cashier');
select is(queue_api.call_next((select id from fixture where name='counter'),'REF',gen_random_uuid())->>'ticket_id',
 (select id::text from issued where name='tp'),'call assigns the intended ticket');
select pg_temp.actor('student');
select is((select x->>'counter' from jsonb_array_elements(queue_api.my_tickets()) x
 where x->>'id'=(select id::text from issued where name='tp')),'Counter 04 — Refund Process','CALLED counter comes from the ticket assignment');

select pg_temp.actor('cashier');
select queue_api.finish_ticket((select id from issued where name='tp'),'SERVE',gen_random_uuid());
select pg_temp.actor('student');
select is((select x->>'counter' from jsonb_array_elements(queue_api.my_tickets()) x
 where x->>'id'=(select id::text from issued where name='tp')),'Counter 04 — Refund Process','SERVED event preserves the actual counter');

update queue_private.counters set is_open=false where id=(select id from fixture where name='counter');
delete from queue_private.staff_counter_assignments where counter_id=(select id from fixture where name='counter');
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select id,(select id from fixture where name='counter') from fixture where name='replacement_cashier';
update queue_private.accounts set enabled=false where id=(select id from fixture where name='cashier');
select pg_temp.actor('student');
select is((select x->>'counter' from jsonb_array_elements(queue_api.my_tickets()) x
 where x->>'id'=(select id::text from issued where name='tp')),'Counter 04 — Refund Process','historical counter survives closure, reassignment and cashier disable');

update queue_private.counters set is_open=true where id=(select id from fixture where name='counter');
insert into issued select 'legacy',(queue_api.issue_ticket('REF',gen_random_uuid())->>'ticket_id')::uuid;
update queue_private.counters set is_open=false where id=(select id from fixture where name='counter');
update queue_private.tickets set status='SERVED',served_at=clock_timestamp()
where id=(select id from issued where name='legacy');
select is((select x->>'counter' from jsonb_array_elements(queue_api.my_tickets()) x
 where x->>'id'=(select id::text from issued where name='legacy')),'Counter not recorded','missing evidence is never inferred from service');

select pg_temp.actor('other_student');
insert into issued select 'other',(queue_api.issue_ticket('TP',gen_random_uuid())->>'ticket_id')::uuid;
select pg_temp.actor('student');
select is((select count(*)::int from jsonb_array_elements(queue_api.my_tickets()) x),2,'payor history is restricted to its owner');
select is((select count(*)::int from queue_private.ticket_events where ticket_id=(select id from issued where name='tp')
 and event_type='SERVED' and counter_id=(select id from fixture where name='counter')),1,'serve event records one actual counter');
select * from finish();
rollback;
