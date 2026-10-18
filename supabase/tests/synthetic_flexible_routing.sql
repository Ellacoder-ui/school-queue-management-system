-- Execute only through the isolated upgrade runner, before migration 006.
begin;
create temporary table legacy_people(name text,id uuid) on commit drop;
insert into legacy_people values
 ('admin','10000000-0000-4000-8000-000000000001'),('cashier','10000000-0000-4000-8000-000000000002'),
 ('TP','10000000-0000-4000-8000-000000000003'),('SOA','10000000-0000-4000-8000-000000000004'),
 ('REF','10000000-0000-4000-8000-000000000005'),('ADJ','10000000-0000-4000-8000-000000000006'),
 ('stale','10000000-0000-4000-8000-000000000007');
insert into auth.users(id,email,email_confirmed_at) select id,name||'@routing-synthetic.invalid',clock_timestamp() from legacy_people;
select queue_private.bootstrap_admin((select id from legacy_people where name='admin'));
update queue_private.accounts set role='CASHIER' where id=(select id from legacy_people where name='cashier');
select set_config('request.jwt.claim.sub',(select id::text from legacy_people where name='admin'),true);
select queue_api.configure_counter((select id from queue_private.counters where number=1),true,array['TP','SOA'],
 array[(select id from legacy_people where name='cashier')],'20000000-0000-4000-8000-000000000001');
select queue_api.configure_counter((select id from queue_private.counters where number=2),true,array['TP','SOA'],
 array[(select id from legacy_people where name='cashier')],gen_random_uuid());
select queue_api.configure_counter((select id from queue_private.counters where number=3),true,array['REF'],
 array[(select id from legacy_people where name='cashier')],gen_random_uuid());
select queue_api.configure_counter((select id from queue_private.counters where number=4),true,array['ADJ'],
 array[(select id from legacy_people where name='cashier')],gen_random_uuid());
insert into queue_private.staff_counter_assignments(account_id,counter_id)
select (select id from legacy_people where name='stale'),id from queue_private.counters where number=5;
insert into queue_private.student_profiles(account_id,student_number,display_name)
select id,'SYNTHETIC-PRIVATE-001','PRIVATE-SYNTHETIC-PERSON' from legacy_people where name='TP';

-- Trusted importer models yesterday's issuances; subsequent calls/finishes use actual RPCs.
insert into queue_private.queue_days(business_date,timezone_snapshot,opened_at)
values((clock_timestamp() at time zone 'Asia/Manila')::date-1,'Asia/Manila',clock_timestamp()-interval '1 day');
insert into queue_private.service_day_state(queue_day_id,service_id,last_number)
select d.id,s.id,1 from queue_private.queue_days d cross join queue_private.services s where s.code in ('TP','SOA','REF','ADJ');
update queue_private.settings set last_wait_position=4 where id;
insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,issued_at)
select p.id,d.id,s.id,1,row_number() over(order by s.code),clock_timestamp()-interval '1 day'
from legacy_people p join queue_private.services s on s.code=p.name cross join queue_private.queue_days d;
insert into queue_private.ticket_events(ticket_id,actor_id,event_type,to_status,occurred_at)
select id,owner_id,'ISSUED','WAITING',issued_at from queue_private.tickets;
select set_config('request.jwt.claim.sub',(select id::text from legacy_people where name='cashier'),true);
select queue_api.call_next((select id from queue_private.counters where number=2),'TP','20000000-0000-4000-8000-000000000101');
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid());
select queue_api.call_next((select id from queue_private.counters where number=1),'SOA',gen_random_uuid());
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid());
select queue_api.call_next((select id from queue_private.counters where number=3),'REF',gen_random_uuid());
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid());
select queue_api.call_next((select id from queue_private.counters where number=4),'ADJ',gen_random_uuid());
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SKIP',gen_random_uuid());
select queue_api.call_next((select id from queue_private.counters where number=4),'ADJ',gen_random_uuid());
select queue_api.finish_ticket((select id from queue_private.tickets where status='CALLED'),'SERVE',gen_random_uuid());
select set_config('request.jwt.claim.sub',(select id::text from legacy_people where name='admin'),true);
select queue_api.manage_day('CLOSE',(select business_date from queue_private.queue_days),gen_random_uuid());
commit;
