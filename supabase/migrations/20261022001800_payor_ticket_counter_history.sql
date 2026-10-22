begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- A called ticket's counter is preserved in ticket_events when finish_ticket
-- clears tickets.counter_id. Project that persisted evidence for payor history.
create or replace function queue_api.my_tickets() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from queue_private.accounts where id=auth.uid() and enabled) then
  raise exception 'Unauthorized' using errcode='42501';
 end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',t.id,'service',s.code,'number',t.sequence_number,
   'business_date',d.business_date,'status',t.status,
   'counter',case
     when t.status='WAITING' then 'Awaiting counter'
     when c.id is null then 'Counter not recorded'
     else 'Counter '||pg_catalog.lpad(c.number::text,2,'0')||' — '||s.name
   end,
   'issued_at',t.issued_at
  ) order by t.issued_at desc)
  from queue_private.tickets t
  join queue_private.services s on s.id=t.service_id
  join queue_private.queue_days d on d.id=t.queue_day_id
  left join lateral (
   select e.counter_id
   from queue_private.ticket_events e
   where e.ticket_id=t.id and e.counter_id is not null and (
    (t.status='CALLED' and e.event_type='CALLED') or
    (t.status='SERVED' and e.event_type in ('SERVED','CALLED')) or
    (t.status='FORFEITED' and e.event_type='FORFEITED')
   )
   order by case e.event_type when 'SERVED' then 0 when 'CALLED' then 1 else 2 end,
    e.occurred_at desc,e.id desc
   limit 1
  ) evidence on true
  left join queue_private.counters c on c.id=case when t.status='CALLED' then t.counter_id else evidence.counter_id end
  where t.owner_id=auth.uid()
 ),'[]'::jsonb);
end;
$$;

comment on function queue_api.my_tickets() is
 'Returns only the caller’s tickets and resolves historical serving counters from persisted CALLED/SERVED/FORFEITED event counter IDs. No service-prefix counter inference.';

commit;
