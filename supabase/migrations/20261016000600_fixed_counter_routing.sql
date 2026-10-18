-- Apply only after target verification and approval. Tested separately from retained development data.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Same lock order as all queue mutations. Never move/forfeit active tickets for a cutover.
do $$ begin
 perform 1 from queue_private.settings where id for update;
 if not found then raise exception 'Queue configuration missing' using errcode='55000'; end if;
 if exists(select 1 from queue_private.tickets where status in ('WAITING','CALLED')) then
  raise exception 'Resolve active tickets before routing cutover' using errcode='55000';
 end if;
 if (select count(*) from queue_private.counters) <> 5 or (select count(*) from queue_private.services) <> 5 then
  raise exception 'Expected five counters and five services' using errcode='55000';
 end if;
end $$;
lock table queue_private.counters,queue_private.services,queue_private.counter_services in access exclusive mode;

create function queue_private.fixed_service_code(p_number smallint) returns text
language sql immutable security invoker set search_path = '' as $$
 select case p_number when 1 then 'TP' when 2 then 'SOA' when 3 then 'PNEP'
   when 4 then 'REF' when 5 then 'ADJ' end;
$$;

create temporary table routing_before on commit drop as
select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('counter',c.number,'service',s.code)
 order by c.number,s.code),'[]'::jsonb) as matrix
from queue_private.counter_services cs join queue_private.counters c on c.id=cs.counter_id
join queue_private.services s on s.id=cs.service_id;

-- Keep already-canonical rows. No ticket/event/account/staff/day/replay changes.
delete from queue_private.counter_services cs using queue_private.counters c,queue_private.services s
where cs.counter_id=c.id and cs.service_id=s.id and s.code<>queue_private.fixed_service_code(c.number);
insert into queue_private.counter_services(counter_id,service_id)
select c.id,s.id from queue_private.counters c join queue_private.services s
on s.code=queue_private.fixed_service_code(c.number) on conflict(counter_id,service_id) do nothing;

alter table queue_private.counter_services add constraint counter_services_one_service unique(counter_id);
alter table queue_private.counter_services add constraint counter_services_one_counter unique(service_id);

create function queue_private.assert_fixed_routing() returns void
language plpgsql security definer set search_path = '' as $$
begin
 if (select count(*) from queue_private.counters)<>5
 or (select count(*) from queue_private.services)<>5
 or (select count(*) from queue_private.counter_services)<>5
 or exists (
   select 1 from queue_private.counters c
   left join queue_private.counter_services cs on cs.counter_id=c.id
   left join queue_private.services s on s.id=cs.service_id
   where s.code is distinct from queue_private.fixed_service_code(c.number)
 ) then
  raise exception 'Fixed routing requires 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ' using errcode='23514';
 end if;
end $$;

-- BEFORE STATEMENT obtains the mutex before tuple locks, including direct SQL.
-- Parent changes cannot escape the deferred coverage check; TRUNCATE is denied.
create function queue_private.lock_fixed_routing_statement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if TG_OP='TRUNCATE' then raise exception 'Fixed routing tables cannot be truncated' using errcode='23514'; end if;
 perform 1 from queue_private.settings where id for update;
 if not found then raise exception 'Queue configuration missing' using errcode='55000'; end if;
 return null;
end $$;
create function queue_private.check_fixed_routing_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 perform queue_private.assert_fixed_routing();
 return null;
end $$;

create trigger fixed_routing_lock before insert or update or delete or truncate on queue_private.counter_services
for each statement execute function queue_private.lock_fixed_routing_statement();
create trigger fixed_counter_lock before insert or update or delete or truncate on queue_private.counters
for each statement execute function queue_private.lock_fixed_routing_statement();
create trigger fixed_service_lock before insert or update or delete or truncate on queue_private.services
for each statement execute function queue_private.lock_fixed_routing_statement();

create constraint trigger fixed_routing_complete after insert or update or delete on queue_private.counter_services
deferrable initially deferred for each row execute function queue_private.check_fixed_routing_trigger();
create constraint trigger fixed_counters_complete after insert or update or delete on queue_private.counters
deferrable initially deferred for each row execute function queue_private.check_fixed_routing_trigger();
create constraint trigger fixed_services_complete after insert or update or delete on queue_private.services
deferrable initially deferred for each row execute function queue_private.check_fixed_routing_trigger();

create or replace function queue_api.configure_counter(p_counter uuid,p_open boolean,p_services text[],p_cashiers uuid[],p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; args jsonb; result jsonb; previous jsonb; expected text;
begin
 a := queue_private.lock_actor();
 if a.role <> 'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_open is null or p_services is null or p_cashiers is null then raise exception 'Explicit configuration required' using errcode='22023'; end if;
 args := jsonb_build_object('counter',p_counter,'open',p_open,'services',p_services,'cashiers',p_cashiers);
 -- Historical results are immutable receipts, not current route state. No old mutation is re-executed.
 result := queue_private.replay(a.id,p_request_key,'COUNTER',args); if result is not null then return result; end if;
 select queue_private.fixed_service_code(number) into expected from queue_private.counters where id=p_counter;
 if expected is null then raise exception 'Counter not found'; end if;
 if cardinality(p_services)<>1 or array_ndims(p_services)<>1 or p_services[array_lower(p_services,1)] is distinct from expected then
  raise exception 'Counter requires its single fixed service' using errcode='22023';
 end if;
 if exists(select 1 from queue_private.tickets where counter_id=p_counter and status='CALLED') then raise exception 'Resolve called ticket before reconfiguration'; end if;
 if exists(select 1 from unnest(p_cashiers) x where x is null or not exists(select 1 from queue_private.accounts where id=x and role='CASHIER' and enabled))
 then raise exception 'Unknown service or ineligible cashier'; end if;
 if p_open and cardinality(p_cashiers)=0 then raise exception 'Open counter requires services and cashiers'; end if;
 perform queue_private.assert_fixed_routing();
 previous := jsonb_build_object('open',(select is_open from queue_private.counters where id=p_counter),
 'services',(select jsonb_agg(service_id) from queue_private.counter_services where counter_id=p_counter),
 'cashiers',(select jsonb_agg(account_id) from queue_private.staff_counter_assignments where counter_id=p_counter));
 -- Fixed route is never deleted/reinserted by this RPC. Staff semantics remain unchanged.
 delete from queue_private.staff_counter_assignments where counter_id=p_counter;
 insert into queue_private.staff_counter_assignments select distinct x,p_counter from unnest(p_cashiers) x;
 update queue_private.counters set is_open=p_open,updated_at=clock_timestamp() where id=p_counter;
 result := args;
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(a.id,'COUNTER',args||jsonb_build_object('previous',previous));
 insert into queue_private.operation_requests values(a.id,p_request_key,'COUNTER',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

revoke all on function queue_private.fixed_service_code(smallint),queue_private.assert_fixed_routing(),
 queue_private.lock_fixed_routing_statement(),queue_private.check_fixed_routing_trigger()
 from public,anon,authenticated,service_role;
-- CREATE OR REPLACE preserves the existing configure_counter owner/ACL/signature.
select queue_private.assert_fixed_routing();
insert into queue_private.admin_audit_events(actor_id,action,parameters)
select null,'FIXED_ROUTING_CUTOVER',jsonb_build_object('migration','20261016000600','before',b.matrix,
 'after',(select jsonb_agg(jsonb_build_object('counter',c.number,'service',s.code) order by c.number)
   from queue_private.counter_services cs join queue_private.counters c on c.id=cs.counter_id
   join queue_private.services s on s.id=cs.service_id)) from routing_before b;
select queue_private.refresh_display();
notify pgrst,'reload schema';
commit;
