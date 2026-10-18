begin;
-- All API mutations serialize here, including authorization changes and closure.
-- This intentionally favors correctness over throughput at one five-counter location.
create function queue_private.lock_actor() returns queue_private.accounts
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts;
begin
 perform 1 from queue_private.settings where id for update;
 if not found then raise exception 'Queue configuration missing'; end if;
 select * into a from queue_private.accounts where id = auth.uid();
 if a.id is null or not a.enabled or exists(select 1 from auth.users where id=a.id and is_anonymous is true)
 then raise exception 'Unauthorized' using errcode='42501'; end if;
 return a;
end $$;

create function queue_private.replay(p_actor uuid,p_key uuid,p_op text,p_args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare r queue_private.operation_requests;
begin
 if p_key is null then raise exception 'Request key required' using errcode='22023'; end if;
 select * into r from queue_private.operation_requests where actor_id=p_actor and request_key=p_key;
 if found then
  if r.operation <> p_op or r.parameters <> p_args then raise exception 'Request key reused with different parameters' using errcode='22023'; end if;
  return r.result;
 end if;
 return null;
end $$;

create function queue_private.refresh_display() returns void
language plpgsql set search_path = '' as $$
begin
 insert into queue_display.counter_state(counter_id,counter_label,is_open,ticket_label,service_code,business_date,updated_at)
 select c.id,c.label,c.is_open,
  case when t.id is not null then s.code||'-'||case when t.sequence_number < 1000 then lpad(t.sequence_number::text,3,'0') else t.sequence_number::text end end,
  s.code,d.business_date,clock_timestamp()
 from queue_private.counters c
 left join queue_private.tickets t on t.counter_id=c.id and t.status='CALLED'
 left join queue_private.services s on s.id=t.service_id
 left join queue_private.queue_days d on d.id=t.queue_day_id
 on conflict(counter_id) do update set counter_label=excluded.counter_label,is_open=excluded.is_open,
 ticket_label=excluded.ticket_label,service_code=excluded.service_code,business_date=excluded.business_date,updated_at=excluded.updated_at;
 -- Keep only open days on the public aggregate display.
 delete from queue_display.service_state ds where not exists
 (select 1 from queue_private.queue_days d where d.business_date=ds.business_date and d.closed_at is null);
 insert into queue_display.service_state(service_code,business_date,waiting_count,updated_at)
 select s.code,d.business_date,count(t.id),clock_timestamp()
 from queue_private.queue_days d cross join queue_private.services s
 left join queue_private.tickets t on t.queue_day_id=d.id and t.service_id=s.id and t.status='WAITING'
 where d.closed_at is null group by s.code,d.business_date
 on conflict(service_code,business_date) do update set waiting_count=excluded.waiting_count,updated_at=excluded.updated_at;
end $$;

create function queue_private.provision_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into queue_private.accounts(id) values(new.id);
 return new;
end $$;
create trigger queue_account_created after insert on auth.users for each row execute function queue_private.provision_account();
insert into queue_private.accounts(id) select id from auth.users on conflict(id) do nothing;

create function queue_api.issue_ticket(p_service text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; s queue_private.services; d queue_private.queue_days;
 t queue_private.tickets; n bigint; pos bigint; args jsonb; result jsonb; local_date date; stamp timestamptz;
begin
 a := queue_private.lock_actor();
 if a.role <> 'STUDENT' then raise exception 'Student access required' using errcode='42501'; end if;
 args := jsonb_build_object('service',p_service);
 result := queue_private.replay(a.id,p_request_key,'ISSUE',args);
 if result is not null then return result; end if;
 stamp := clock_timestamp(); local_date := (stamp at time zone 'Asia/Manila')::date;
 select * into d from queue_private.queue_days where business_date=local_date and closed_at is null;
 if d.id is null then raise exception 'Current queue day is not open'; end if;
 select * into s from queue_private.services where code=p_service and enabled;
 if s.id is null then raise exception 'Service unavailable'; end if;
 if exists(select 1 from queue_private.tickets where owner_id=a.id and status in ('WAITING','CALLED')) then raise exception 'Active ticket already exists'; end if;
 if (select count(*) from queue_private.tickets where owner_id=a.id and queue_day_id=d.id and service_id=s.id and status='SERVED') >= 2 then raise exception 'Daily served-ticket limit reached'; end if;
 insert into queue_private.service_day_state(queue_day_id,service_id) values(d.id,s.id) on conflict do nothing;
 update queue_private.service_day_state set last_number=last_number+1
 where queue_day_id=d.id and service_id=s.id returning last_number into n;
 update queue_private.settings set last_wait_position=last_wait_position+1 where id returning last_wait_position into pos;
 insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,issued_at)
 values(a.id,d.id,s.id,n,pos,stamp) returning * into t;
 insert into queue_private.ticket_events(ticket_id,actor_id,event_type,to_status) values(t.id,a.id,'ISSUED','WAITING');
 result := jsonb_build_object('ticket_id',t.id,'sequence_number',n,'service',s.code,'business_date',local_date,'status','WAITING');
 insert into queue_private.operation_requests values(a.id,p_request_key,'ISSUE',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

create function queue_api.call_next(p_counter uuid,p_service text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; s uuid; t queue_private.tickets; args jsonb; result jsonb;
begin
 a := queue_private.lock_actor();
 if a.role <> 'CASHIER' or not exists(select 1 from queue_private.staff_counter_assignments where account_id=a.id and counter_id=p_counter)
 then raise exception 'Assigned cashier required' using errcode='42501'; end if;
 args := jsonb_build_object('counter',p_counter,'service',p_service);
 result := queue_private.replay(a.id,p_request_key,'CALL',args); if result is not null then return result; end if;
 if not exists(select 1 from queue_private.counters where id=p_counter and is_open) then raise exception 'Counter closed'; end if;
 select s1.id into s from queue_private.services s1 join queue_private.counter_services cs on cs.service_id=s1.id
 where cs.counter_id=p_counter and s1.code=p_service and s1.enabled;
 if s is null then raise exception 'Service not assigned or disabled'; end if;
 if exists(select 1 from queue_private.tickets where counter_id=p_counter and status='CALLED') then raise exception 'Counter busy'; end if;
 select t1.* into t from queue_private.tickets t1 join queue_private.queue_days d on d.id=t1.queue_day_id
 where t1.service_id=s and t1.status='WAITING' and d.closed_at is null
 order by t1.wait_position,t1.id limit 1 for update of t1;
 if t.id is null then result := jsonb_build_object('ticket_id',null);
 else
  update queue_private.tickets set status='CALLED',counter_id=p_counter,updated_at=clock_timestamp() where id=t.id;
  insert into queue_private.ticket_events(ticket_id,actor_id,event_type,from_status,to_status,counter_id)
  values(t.id,a.id,'CALLED','WAITING','CALLED',p_counter);
  result := jsonb_build_object('ticket_id',t.id,'status','CALLED');
 end if;
 insert into queue_private.operation_requests values(a.id,p_request_key,'CALL',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

create function queue_api.finish_ticket(p_ticket uuid,p_action text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; t queue_private.tickets; args jsonb; result jsonb; pos bigint;
begin
 a := queue_private.lock_actor();
 if a.role <> 'CASHIER' then raise exception 'Cashier required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('SERVE','SKIP') then raise exception 'Invalid action' using errcode='22023'; end if;
 args := jsonb_build_object('ticket',p_ticket,'action',p_action);
 result := queue_private.replay(a.id,p_request_key,'FINISH',args); if result is not null then return result; end if;
 select * into t from queue_private.tickets where id=p_ticket for update;
 if t.id is null or t.status <> 'CALLED' or not exists
 (select 1 from queue_private.staff_counter_assignments where account_id=a.id and counter_id=t.counter_id)
 then raise exception 'Ticket not called at an assigned counter' using errcode='42501'; end if;
 if not exists(select 1 from queue_private.queue_days where id=t.queue_day_id and closed_at is null) then raise exception 'Queue day closed'; end if;
 if p_action='SERVE' then
  if (select count(*) from queue_private.tickets where owner_id=t.owner_id and queue_day_id=t.queue_day_id and service_id=t.service_id and status='SERVED') >= 2
  then raise exception 'Daily served-ticket limit reached'; end if;
  update queue_private.tickets set status='SERVED',counter_id=null,served_at=clock_timestamp(),updated_at=clock_timestamp() where id=t.id;
  insert into queue_private.ticket_events(ticket_id,actor_id,event_type,from_status,to_status,counter_id)
  values(t.id,a.id,'SERVED','CALLED','SERVED',t.counter_id);
  result := jsonb_build_object('ticket_id',t.id,'status','SERVED');
 else
  update queue_private.settings set last_wait_position=last_wait_position+1 where id returning last_wait_position into pos;
  update queue_private.tickets set status='WAITING',counter_id=null,wait_position=pos,updated_at=clock_timestamp() where id=t.id;
  insert into queue_private.ticket_events(ticket_id,actor_id,event_type,from_status,to_status,counter_id)
  values(t.id,a.id,'SKIPPED','CALLED','WAITING',t.counter_id);
  result := jsonb_build_object('ticket_id',t.id,'status','WAITING');
 end if;
 insert into queue_private.operation_requests values(a.id,p_request_key,'FINISH',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

create function queue_api.my_tickets() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from queue_private.accounts where id=auth.uid() and enabled) then raise exception 'Unauthorized' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'service',s.code,'number',t.sequence_number,
 'business_date',d.business_date,'status',t.status,'counter',c.label,'issued_at',t.issued_at) order by t.issued_at desc)
 from queue_private.tickets t join queue_private.services s on s.id=t.service_id
 join queue_private.queue_days d on d.id=t.queue_day_id left join queue_private.counters c on c.id=t.counter_id
 where t.owner_id=auth.uid()),'[]'::jsonb);
end $$;
create function queue_api.my_ticket_events(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from queue_private.accounts a join queue_private.tickets t on t.owner_id=a.id
 where a.id=auth.uid() and a.enabled and t.id=p_ticket) then raise exception 'Unauthorized' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('event',event_type,'at',occurred_at,'status',to_status) order by occurred_at,id)
 from queue_private.ticket_events where ticket_id=p_ticket),'[]'::jsonb);
end $$;
commit;
