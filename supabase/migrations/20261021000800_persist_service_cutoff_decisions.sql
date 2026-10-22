begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table queue_private.service_day_cutoffs (
 queue_day_id uuid not null,
 service_id uuid not null references queue_private.services(id),
 evaluated_at timestamptz not null,
 active_count integer not null check (active_count >= 0),
 cut_off boolean not null,
 primary key(queue_day_id,service_id),
 foreign key(queue_day_id,service_id)
   references queue_private.service_day_state(queue_day_id,service_id),
 check (cut_off = (active_count >= 10))
);

create function queue_private.evaluate_service_day_cutoffs(p_instant timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare
 v_local timestamp without time zone := p_instant at time zone 'Asia/Manila';
 v_cutoff timestamptz;
 v_day_id uuid;
 v_service record;
 v_count integer;
begin
 if p_instant is null then raise exception 'Cutoff time required'; end if;
 if v_local::time < time '16:30' then return; end if;
 v_cutoff := (v_local::date + time '16:30') at time zone 'Asia/Manila';

 perform 1 from queue_private.settings where id for update;
 if not found then raise exception 'Queue configuration missing'; end if;
 select id into v_day_id from queue_private.queue_days
 where business_date = v_local::date and closed_at is null;
 if v_day_id is null then return; end if;

 for v_service in
  select id from queue_private.services where enabled order by code
 loop
  insert into queue_private.service_day_state(queue_day_id,service_id)
  values(v_day_id,v_service.id) on conflict do nothing;

  select count(*)::integer into v_count
  from queue_private.tickets t
  where t.queue_day_id = v_day_id
    and t.service_id = v_service.id
    and t.issued_at <= v_cutoff
    and (
      select e.to_status
      from queue_private.ticket_events e
      where e.ticket_id = t.id and e.occurred_at <= v_cutoff
      order by e.occurred_at desc,e.id desc
      limit 1
    ) in ('WAITING','CALLED');

  insert into queue_private.service_day_cutoffs
   (queue_day_id,service_id,evaluated_at,active_count,cut_off)
  values(v_day_id,v_service.id,v_cutoff,v_count,v_count >= 10)
  on conflict(queue_day_id,service_id) do nothing;
 end loop;
end $$;

create or replace function queue_private.ticket_issuance_status(p_service text, p_instant timestamptz)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
 v_local timestamp without time zone := p_instant at time zone 'Asia/Manila';
 v_service uuid;
 v_counter_open boolean;
 v_cut_off boolean;
begin
 if v_local::time >= time '17:00' then return 'AFTER_HOURS'; end if;

 select s.id,c.is_open into v_service,v_counter_open
 from queue_private.services s
 join queue_private.counter_services cs on cs.service_id=s.id
 join queue_private.counters c on c.id=cs.counter_id
 where s.code=p_service and s.enabled;
 if v_service is null then return 'SERVICE_UNAVAILABLE'; end if;
 if not v_counter_open then return 'COUNTER_CLOSED'; end if;

 if v_local::time >= time '16:30' then
  select cutoff.cut_off into v_cut_off
  from queue_private.service_day_cutoffs cutoff
  join queue_private.queue_days d on d.id=cutoff.queue_day_id
  where d.business_date=v_local::date and cutoff.service_id=v_service;
  if v_cut_off is null then return 'SERVICE_UNAVAILABLE'; end if;
  if v_cut_off then return 'QUEUE_CUTOFF'; end if;
 end if;
 return 'OPEN';
end $$;

-- The public board read and ticket mutation both ensure the scheduled snapshot exists.
create or replace function queue_private.public_context_at(p_instant timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
 perform queue_private.evaluate_service_day_cutoffs(p_instant);
 return (
  select pg_catalog.jsonb_build_object(
   'timezone',s.timezone,
   'business_date',(p_instant at time zone s.timezone)::date,
   'queue_day_open',exists(
    select 1 from queue_private.queue_days d
    where d.business_date=(p_instant at time zone s.timezone)::date and d.closed_at is null
   ),
   'services',(
    select coalesce(pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object(
      'code',v.code,
      'name',v.name,
      'issuance_status',queue_private.ticket_issuance_status(v.code,p_instant)
     ) order by v.code
    ),'[]'::jsonb)
    from queue_private.services v where v.enabled
   )
  ) from queue_private.settings s where s.id
 );
end $$;

create or replace function queue_private.issue_ticket_at(p_service text,p_request_key uuid,p_instant timestamptz)
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

create or replace function queue_private.evaluate_and_publish_service_cutoffs()
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform queue_private.evaluate_service_day_cutoffs(clock_timestamp());
 perform queue_private.refresh_display();
end $$;

revoke all on table queue_private.service_day_cutoffs from public,anon,authenticated,service_role;
revoke all on function queue_private.evaluate_service_day_cutoffs(timestamptz),
 queue_private.evaluate_and_publish_service_cutoffs()
 from public,anon,authenticated,service_role;

select cron.unschedule(jobid) from cron.job where jobname='cqs-issuance-cutoff-publish';
select cron.schedule('cqs-issuance-cutoff-publish','30 8 * * *',
 'select queue_private.evaluate_and_publish_service_cutoffs()');

notify pgrst,'reload schema';
commit;
