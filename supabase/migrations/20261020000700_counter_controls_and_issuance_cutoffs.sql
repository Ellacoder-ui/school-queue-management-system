begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- pg_cron uses GMT on this project. Asia/Manila has no daylight-saving changes.
create extension if not exists pg_cron;
do $$ begin
 if current_setting('cron.timezone', true) <> 'GMT' then
  raise exception 'Queue cutoff cron requires cron.timezone=GMT; configure it before applying this migration';
 end if;
end $$;

create function queue_private.ticket_issuance_status(p_service text, p_instant timestamptz)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
 v_local timestamp without time zone := p_instant at time zone 'Asia/Manila';
 v_service uuid;
 v_counter_open boolean;
 v_cutoff timestamptz;
 v_issued bigint;
begin
 if v_local::time >= time '17:00' then return 'AFTER_HOURS'; end if;

 select s.id, c.is_open into v_service, v_counter_open
 from queue_private.services s
 join queue_private.counter_services cs on cs.service_id = s.id
 join queue_private.counters c on c.id = cs.counter_id
 where s.code = p_service and s.enabled;
 if v_service is null then return 'SERVICE_UNAVAILABLE'; end if;
 if not v_counter_open then return 'COUNTER_CLOSED'; end if;

 if v_local::time >= time '16:30' then
  v_cutoff := (v_local::date + time '16:30') at time zone 'Asia/Manila';
  select count(*) into v_issued
  from queue_private.tickets t
  join queue_private.queue_days d on d.id = t.queue_day_id
  where t.service_id = v_service
    and d.business_date = v_local::date
    and t.issued_at <= v_cutoff;
  if v_issued >= 10 then return 'QUEUE_CUTOFF'; end if;
 end if;
 return 'OPEN';
end $$;

-- Publishes the per-service admission state with the existing public Realtime context.
create or replace function queue_private.public_context_at(p_instant timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select pg_catalog.jsonb_build_object(
   'timezone', s.timezone,
   'business_date', (p_instant at time zone s.timezone)::date,
   'queue_day_open', exists (
     select 1 from queue_private.queue_days d
     where d.business_date = (p_instant at time zone s.timezone)::date
       and d.closed_at is null
   ),
   'services', (
     select coalesce(pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_object(
         'code', v.code,
         'name', v.name,
         'issuance_status', queue_private.ticket_issuance_status(v.code, p_instant)
       ) order by v.code
     ), '[]'::jsonb)
     from queue_private.services v where v.enabled
   )
 ) from queue_private.settings s where s.id;
$$;

create function queue_private.issue_ticket_at(p_service text,p_request_key uuid,p_instant timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; s queue_private.services; d queue_private.queue_days;
 t queue_private.tickets; n bigint; pos bigint; args jsonb; result jsonb;
 local_date date; stamp timestamptz; admission text;
begin
 a := queue_private.lock_actor();
 if a.role <> 'STUDENT' then raise exception 'Student access required' using errcode='42501'; end if;
 args := jsonb_build_object('service',p_service);
 result := queue_private.replay(a.id,p_request_key,'ISSUE',args);
 if result is not null then return result; end if;
 stamp := p_instant;
 local_date := (stamp at time zone 'Asia/Manila')::date;
 select * into d from queue_private.queue_days where business_date=local_date and closed_at is null;
 if d.id is null then raise exception 'Current queue day is not open'; end if;
 select * into s from queue_private.services where code=p_service and enabled;
 if s.id is null then raise exception 'Service unavailable'; end if;
 admission := queue_private.ticket_issuance_status(p_service,stamp);
 if admission='AFTER_HOURS' then raise exception 'Ticket issuance closed after 5:00 PM'; end if;
 if admission='QUEUE_CUTOFF' then raise exception 'Queue cutoff reached for today'; end if;
 if admission='COUNTER_CLOSED' then raise exception 'Counter closed'; end if;
 if admission<>'OPEN' then raise exception 'Service unavailable'; end if;
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

create or replace function queue_api.issue_ticket(p_service text,p_request_key uuid) returns jsonb
language sql security definer set search_path = '' as $$
 select queue_private.issue_ticket_at(p_service,p_request_key,clock_timestamp());
$$;

create function queue_private.set_counter_open_at(p_counter uuid,p_open boolean,p_request_key uuid,p_instant timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; args jsonb; result jsonb; v_number smallint;
begin
 a := queue_private.lock_actor();
 if a.role <> 'CASHIER'
   or not exists(select 1 from queue_private.staff_counter_assignments where account_id=a.id and counter_id=p_counter) then
  raise exception 'Assigned cashier required' using errcode='42501';
 end if;
 if p_open is null then raise exception 'Counter state required' using errcode='22023'; end if;
 args := jsonb_build_object('counter',p_counter,'open',p_open);
 result := queue_private.replay(a.id,p_request_key,'COUNTER_OPEN',args);
 if result is not null then return result; end if;
 select number into v_number from queue_private.counters where id=p_counter;
 if v_number is null then raise exception 'Counter not found'; end if;
 if p_open and (p_instant at time zone 'Asia/Manila')::time >= time '17:00' then
  raise exception 'Counter opening is unavailable after 5:00 PM';
 end if;
 update queue_private.counters set is_open=p_open,updated_at=clock_timestamp() where id=p_counter;
 result := jsonb_build_object('counter',p_counter,'open',p_open);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(a.id,'COUNTER_OPEN',args||jsonb_build_object('counter_number',v_number));
 insert into queue_private.operation_requests values(a.id,p_request_key,'COUNTER_OPEN',args,result,clock_timestamp());
 perform queue_private.refresh_display();
 return result;
end $$;

create or replace function queue_api.set_counter_open(p_counter uuid,p_open boolean,p_request_key uuid) returns jsonb
language sql security definer set search_path = '' as $$
 select queue_private.set_counter_open_at(p_counter,p_open,p_request_key,clock_timestamp());
$$;

create function queue_private.close_counters_at(p_instant timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if (p_instant at time zone 'Asia/Manila')::time < time '17:00' then return; end if;
 perform 1 from queue_private.settings where id for update;
 if not found then raise exception 'Queue configuration missing'; end if;
 update queue_private.counters set is_open=false,updated_at=clock_timestamp() where is_open;
 perform queue_private.refresh_display();
end $$;

create function queue_private.close_counters_at_five() returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform queue_private.close_counters_at(clock_timestamp());
end $$;

create function queue_private.publish_cutoff_status() returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform queue_private.refresh_display();
end $$;

revoke all on function queue_private.ticket_issuance_status(text,timestamptz),
 queue_private.issue_ticket_at(text,uuid,timestamptz),queue_private.close_counters_at(timestamptz),
 queue_private.set_counter_open_at(uuid,boolean,uuid,timestamptz),
 queue_private.close_counters_at_five(),queue_private.publish_cutoff_status(),
 queue_api.issue_ticket(text,uuid),queue_api.set_counter_open(uuid,boolean,uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_api.issue_ticket(text,uuid),queue_api.set_counter_open(uuid,boolean,uuid)
 to authenticated;

select cron.schedule('cqs-issuance-cutoff-publish','30 8 * * *',
 'select queue_private.publish_cutoff_status()');
select cron.schedule('cqs-close-counters-at-five','0 9 * * *',
 'select queue_private.close_counters_at_five()');

notify pgrst,'reload schema';
commit;
