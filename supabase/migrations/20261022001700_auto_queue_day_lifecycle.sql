begin;

-- Idempotent auto-open for the current Asia/Manila day during operating hours.
create or replace function queue_private.ensure_queue_day_open(p_instant timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_date date; v_time time;
begin
  v_date := (p_instant at time zone 'Asia/Manila')::date;
  v_time := (p_instant at time zone 'Asia/Manila')::time;
  if v_time < time '07:30' or v_time >= time '17:00' then return; end if;
  insert into queue_private.queue_days(business_date, timezone_snapshot)
  values (v_date, 'Asia/Manila')
  on conflict (business_date) do nothing;
end $$;

-- Close queue day at 5 PM.
create or replace function queue_private.close_queue_day_at_five()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update queue_private.queue_days
    set closed_at = clock_timestamp()
    where business_date = (clock_timestamp() at time zone 'Asia/Manila')::date
      and closed_at is null;
  perform queue_private.close_counters_at_five();
end $$;

-- Patch issue_ticket_at to auto-ensure queue day.
create or replace function queue_private.issue_ticket_at(p_service text, p_request_key uuid, p_instant timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 a queue_private.accounts; s queue_private.services; d queue_private.queue_days;
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
 perform queue_private.ensure_queue_day_open(stamp);
 select * into d from queue_private.queue_days where business_date=local_date and closed_at is null;
 if d.id is null then raise exception 'Current queue day is not open'; end if;
 select * into s from queue_private.services where code=p_service and enabled;
 if s.id is null then raise exception 'Service unavailable'; end if;
 perform queue_private.evaluate_service_day_cutoffs(stamp);
 admission := queue_private.ticket_issuance_status(p_service,stamp);
 if admission='AFTER_HOURS' then raise exception 'Ticket issuance closes at 5:00 PM'; end if;
 if admission='QUEUE_CUTOFF' then raise exception 'Ticket issuance for this service has ended today.'; end if;
 if admission='COUNTER_CLOSED' then raise exception 'Counter is currently closed.'; end if;
 if admission<>'OPEN' then raise exception 'Service unavailable'; end if;
 if exists(select 1 from queue_private.tickets where owner_id=a.id and status in ('WAITING','CALLED')) then raise exception 'Active ticket already exists'; end if;
 if (select count(*) from queue_private.tickets where owner_id=a.id and queue_day_id=d.id and service_id=s.id and status='SERVED') >= 2 then raise exception 'Daily served-ticket limit reached'; end if;
 insert into queue_private.service_day_state(queue_day_id,service_id) values(d.id,s.id) on conflict do nothing;
 update queue_private.service_day_state set last_number=last_number+1
 where queue_day_id=d.id and service_id=s.id returning last_number into n;
 update queue_private.settings set last_wait_position=last_wait_position+1 where id returning last_wait_position into pos;
 insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,issued_at)
 values(a.id,d.id,s.id,n,pos,stamp) returning * into t;
 insert into queue_private.ticket_events(ticket_id,actor_id,event_type,to_status)
 values(t.id,a.id,'ISSUED','WAITING');
 result := jsonb_build_object('ticket_id',t.id,'sequence_number',n,'service',s.code,'business_date',local_date,'status','WAITING');
 insert into queue_private.operation_requests values(a.id,p_request_key,'ISSUE',args,result,clock_timestamp());
 perform queue_private.refresh_display();
 return result;
end $$;

-- Patch set_counter_open_at to auto-ensure queue day on open.
create or replace function queue_private.set_counter_open_at(
 p_counter uuid,p_open boolean,p_request_key uuid,p_instant timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
 select number into v_number from queue_private.counters where id=p_counter for update;
 if v_number is null then raise exception 'Counter not found'; end if;
 if p_open then
   perform queue_private.ensure_queue_day_open(p_instant);
   if (p_instant at time zone 'Asia/Manila')::time < time '07:30' then
     raise exception 'Counter opens at 7:30 AM';
   end if;
   if (p_instant at time zone 'Asia/Manila')::time >= time '17:00' then
     raise exception 'Counter opening is unavailable after 5:00 PM';
   end if;
 end if;
 if not p_open and exists(select 1 from queue_private.tickets where counter_id=p_counter and status='CALLED') then
  raise exception 'Resolve called ticket before closing counter';
 end if;
 update queue_private.counters set is_open=p_open,updated_at=clock_timestamp() where id=p_counter;
 result := jsonb_build_object('counter',p_counter,'open',p_open);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(a.id,'COUNTER_OPEN',args||jsonb_build_object('counter_number',v_number));
 insert into queue_private.operation_requests values(a.id,p_request_key,'COUNTER_OPEN',args,result,clock_timestamp());
 perform queue_private.refresh_display();
 return result;
end $$;

-- Cron: open queue day at 7:30 AM Manila (23:30 UTC previous day)
select cron.schedule('cqs-open-queue-day-at-seven-thirty','30 23 * * *',
 'select queue_private.ensure_queue_day_open(clock_timestamp())');

-- Replace 5 PM close job to also close queue day
select cron.unschedule(jobid) from cron.job where jobname='cqs-close-counters-at-five';
select cron.schedule('cqs-close-counters-at-five','0 9 * * *',
 'select queue_private.close_queue_day_at_five()');

select pg_notify('pgrst','reload schema');
commit;