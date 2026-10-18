begin;
insert into queue_private.settings(id) values(true);
insert into queue_private.services(code,name) values
 ('TP','Tuition Payment'),('SOA','Statement of Account'),
 ('PNEP','Promissory Notes and Exam Permits'),('REF','Refund Process'),('ADJ','Adjustment Clerk');
insert into queue_private.counters(number,label) select n,'Counter '||n from generate_series(1,5) n;
-- Fail closed: no inferred cashier assignments, service assignments, or open days.
select queue_private.refresh_display();
revoke all on all functions in schema queue_private from public,anon,authenticated,service_role;
revoke all on all functions in schema queue_api from public,anon,authenticated,service_role;
grant execute on function queue_api.issue_ticket(text,uuid),
 queue_api.call_next(uuid,text,uuid),queue_api.finish_ticket(uuid,text,uuid),
 queue_api.my_tickets(),queue_api.my_ticket_events(uuid),
 queue_api.manage_day(text,date,uuid),queue_api.set_account(uuid,text,boolean,uuid),
 queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid),
 queue_api.configure_service(text,text,boolean,uuid),queue_api.staff_queue(),queue_api.admin_configuration()
 to authenticated;
-- PostgreSQL table owner (migration operator) bypasses RLS inside reviewed definers.
-- Browser roles have no ownership, CREATE, mutation, or private-schema privileges.
revoke create on schema queue_api,queue_display,queue_private from public,anon,authenticated,service_role;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table queue_display.counter_state,queue_display.service_state;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
