begin;

create or replace function queue_private.set_counter_open_at(
 p_counter uuid,p_open boolean,p_request_key uuid,p_instant timestamptz
) returns jsonb
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
 select number into v_number from queue_private.counters where id=p_counter for update;
 if v_number is null then raise exception 'Counter not found'; end if;
 if p_open then
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

-- Also block after-hours reconfiguration via configure_counter
create or replace function queue_api.configure_counter(
 p_counter uuid,p_open boolean,p_services text[],p_cashiers uuid[],p_request_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 a queue_private.accounts;
 args jsonb; result jsonb; previous jsonb; expected text;
 current_cashiers uuid[]; requested_cashiers uuid[];
begin
 a := queue_private.lock_actor();
 if a.role<>'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_open is null or p_services is null or p_cashiers is null or p_request_key is null then
  raise exception 'Explicit configuration required' using errcode='22023';
 end if;
 if exists(select 1 from unnest(p_cashiers) x where x is null) then
  raise exception 'Unknown service or ineligible cashier' using errcode='22023';
 end if;
 perform 1 from queue_private.counters where id=p_counter for update;
 if not found then raise exception 'Counter not found'; end if;
 if p_open then
   if (clock_timestamp() at time zone 'Asia/Manila')::time < time '07:30' then
     raise exception 'Counter opens at 7:30 AM';
   end if;
   if (clock_timestamp() at time zone 'Asia/Manila')::time >= time '17:00' then
     raise exception 'Counter opening is unavailable after 5:00 PM';
   end if;
 end if;
 select coalesce(array_agg(x.account_id order by x.account_id),'{}'::uuid[])
 into current_cashiers from queue_private.staff_counter_assignments x where x.counter_id=p_counter;
 select coalesce(array_agg(q.account_id order by q.account_id),'{}'::uuid[])
 into requested_cashiers from (select distinct x as account_id from unnest(p_cashiers) x) q;
 if current_cashiers is distinct from requested_cashiers then
  perform queue_private.require_staff_activation_admin();
 end if;
 args := jsonb_build_object('counter',p_counter,'open',p_open,'services',p_services,'cashiers',p_cashiers);
 result := queue_private.replay(a.id,p_request_key,'COUNTER',args);
 if result is not null then return result; end if;
 select queue_private.fixed_service_code(number) into expected from queue_private.counters where id=p_counter;
 if expected is null then raise exception 'Counter not found'; end if;
 if cardinality(p_services)<>1 or array_ndims(p_services)<>1
  or p_services[array_lower(p_services,1)] is distinct from expected then
  raise exception 'Counter requires its single fixed service' using errcode='22023';
 end if;
 if exists(select 1 from unnest(p_cashiers) x where not exists(select 1 from queue_private.accounts where id=x and role='CASHIER' and enabled)) then
  raise exception 'Unknown service or ineligible cashier';
 end if;
 if exists(select 1 from queue_private.tickets where counter_id=p_counter and status='CALLED') then
  raise exception 'Resolve called ticket before reconfiguration';
 end if;
 if p_open and cardinality(p_cashiers)=0 then raise exception 'Open counter requires services and cashiers'; end if;
 perform queue_private.assert_fixed_routing();
 previous := jsonb_build_object('open',(select is_open from queue_private.counters where id=p_counter),
   'services',(select jsonb_agg(service_id) from queue_private.counter_services where counter_id=p_counter),
   'cashiers',(select jsonb_agg(account_id) from queue_private.staff_counter_assignments where counter_id=p_counter));
 delete from queue_private.staff_counter_assignments where counter_id=p_counter;
 insert into queue_private.staff_counter_assignments select distinct x,p_counter from unnest(p_cashiers) x;
 update queue_private.counters set is_open=p_open,updated_at=clock_timestamp() where id=p_counter;
 result := args;
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(a.id,'COUNTER',args||jsonb_build_object('previous',previous));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at) values(a.id,p_request_key,'COUNTER',args,result,clock_timestamp());
 perform queue_private.refresh_display();
 return result;
end $$;

select pg_notify('pgrst','reload schema');
commit;