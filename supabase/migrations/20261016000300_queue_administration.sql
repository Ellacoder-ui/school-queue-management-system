begin;
-- One-time operator bootstrap: never granted to API roles, never trusts email/metadata.
create function queue_private.bootstrap_admin(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 if exists(select 1 from queue_private.admin_audit_events where action='BOOTSTRAP')
 or exists(select 1 from queue_private.accounts where role='ADMIN') then raise exception 'Bootstrap already completed'; end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and is_anonymous is not true)
 then raise exception 'Confirmed non-anonymous Auth account required'; end if;
 update queue_private.accounts set role='ADMIN',updated_at=clock_timestamp() where id=p_user and enabled;
 if not found then raise exception 'Enabled account not found'; end if;
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(p_user,'BOOTSTRAP',jsonb_build_object('user',p_user));
end $$;

create function queue_api.manage_day(p_action text,p_date date,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; d queue_private.queue_days; args jsonb; result jsonb; n bigint;
begin
 a := queue_private.lock_actor();
 if a.role <> 'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('OPEN','CLOSE') or p_date is null then raise exception 'Invalid day action' using errcode='22023'; end if;
 args := jsonb_build_object('action',p_action,'date',p_date);
 result := queue_private.replay(a.id,p_request_key,'DAY',args); if result is not null then return result; end if;
 if p_action='OPEN' then
  if p_date <> (clock_timestamp() at time zone 'Asia/Manila')::date then raise exception 'Only current local day may be opened'; end if;
  if exists(select 1 from queue_private.queue_days where business_date=p_date) then raise exception 'Day already exists; closed days cannot reopen'; end if;
  insert into queue_private.queue_days(business_date,timezone_snapshot) values(p_date,'Asia/Manila') returning * into d;
  n := 0;
 else
  select * into d from queue_private.queue_days where business_date=p_date and closed_at is null;
  if d.id is null then raise exception 'Open day not found'; end if;
  insert into queue_private.ticket_events(ticket_id,actor_id,event_type,from_status,to_status,counter_id)
  select id,a.id,'FORFEITED',status,'FORFEITED',counter_id from queue_private.tickets
  where queue_day_id=d.id and status in ('WAITING','CALLED');
  update queue_private.tickets set status='FORFEITED',counter_id=null,forfeited_at=clock_timestamp(),updated_at=clock_timestamp()
  where queue_day_id=d.id and status in ('WAITING','CALLED');
  get diagnostics n = row_count;
  update queue_private.queue_days set closed_at=clock_timestamp(),closed_by=a.id where id=d.id;
 end if;
 result := jsonb_build_object('day_id',d.id,'action',p_action,'forfeited',n);
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(a.id,'DAY_'||p_action,args||result);
 insert into queue_private.operation_requests values(a.id,p_request_key,'DAY',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

create function queue_api.set_account(p_user uuid,p_role text,p_enabled boolean,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; old queue_private.accounts; args jsonb; result jsonb;
begin
 a := queue_private.lock_actor();
 if a.role <> 'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_role is null or p_role not in ('STUDENT','CASHIER','ADMIN') or p_enabled is null then raise exception 'Invalid account settings' using errcode='22023'; end if;
 args := jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled);
 result := queue_private.replay(a.id,p_request_key,'ACCOUNT',args); if result is not null then return result; end if;
 select * into old from queue_private.accounts where id=p_user;
 if old.id is null then raise exception 'Account not found'; end if;
 if old.role='ADMIN' and old.enabled and (p_role <> 'ADMIN' or not p_enabled)
 and (select count(*) from queue_private.accounts where role='ADMIN' and enabled)=1 then raise exception 'Cannot remove last enabled administrator'; end if;
 if exists(select 1 from queue_private.tickets where owner_id=p_user and status in ('WAITING','CALLED'))
 and (not p_enabled or p_role <> old.role::text) then raise exception 'Resolve active ticket before changing account'; end if;
 if old.role='CASHIER' and (p_role <> 'CASHIER' or not p_enabled) and exists
 (select 1 from queue_private.staff_counter_assignments x join queue_private.tickets t on t.counter_id=x.counter_id where x.account_id=p_user and t.status='CALLED')
 then raise exception 'Resolve called tickets before changing cashier'; end if;
 update queue_private.accounts set role=p_role::queue_private.app_role,enabled=p_enabled,updated_at=clock_timestamp() where id=p_user;
 if p_role <> 'CASHIER' or not p_enabled then delete from queue_private.staff_counter_assignments where account_id=p_user; end if;
 result := jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(a.id,'ACCOUNT',args||jsonb_build_object('previous_role',old.role,'previous_enabled',old.enabled));
 insert into queue_private.operation_requests values(a.id,p_request_key,'ACCOUNT',args,result,clock_timestamp());
 return result;
end $$;

create function queue_api.configure_counter(p_counter uuid,p_open boolean,p_services text[],p_cashiers uuid[],p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; args jsonb; result jsonb; previous jsonb;
begin
 a := queue_private.lock_actor();
 if a.role <> 'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_open is null or p_services is null or p_cashiers is null then raise exception 'Explicit configuration required' using errcode='22023'; end if;
 args := jsonb_build_object('counter',p_counter,'open',p_open,'services',p_services,'cashiers',p_cashiers);
 result := queue_private.replay(a.id,p_request_key,'COUNTER',args); if result is not null then return result; end if;
 if not exists(select 1 from queue_private.counters where id=p_counter) then raise exception 'Counter not found'; end if;
 if exists(select 1 from queue_private.tickets where counter_id=p_counter and status='CALLED') then raise exception 'Resolve called ticket before reconfiguration'; end if;
 if exists(select 1 from unnest(p_services) x where x is null or not exists(select 1 from queue_private.services where code=x))
 or exists(select 1 from unnest(p_cashiers) x where x is null or not exists(select 1 from queue_private.accounts where id=x and role='CASHIER' and enabled))
 then raise exception 'Unknown service or ineligible cashier'; end if;
 if p_open and (cardinality(p_services)=0 or cardinality(p_cashiers)=0) then raise exception 'Open counter requires services and cashiers'; end if;
 previous := jsonb_build_object('open',(select is_open from queue_private.counters where id=p_counter),
 'services',(select jsonb_agg(service_id) from queue_private.counter_services where counter_id=p_counter),
 'cashiers',(select jsonb_agg(account_id) from queue_private.staff_counter_assignments where counter_id=p_counter));
 -- Terminal tickets clear counter_id; counter history lives in events, so FK is safe.
 delete from queue_private.counter_services where counter_id=p_counter;
 insert into queue_private.counter_services select p_counter,id from queue_private.services where code=any(p_services);
 delete from queue_private.staff_counter_assignments where counter_id=p_counter;
 insert into queue_private.staff_counter_assignments select distinct x,p_counter from unnest(p_cashiers) x;
 update queue_private.counters set is_open=p_open,updated_at=clock_timestamp() where id=p_counter;
 result := args;
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(a.id,'COUNTER',args||jsonb_build_object('previous',previous));
 insert into queue_private.operation_requests values(a.id,p_request_key,'COUNTER',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

create function queue_api.configure_service(p_code text,p_name text,p_enabled boolean,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts; args jsonb; result jsonb; previous jsonb;
begin
 a := queue_private.lock_actor();
 if a.role <> 'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_name is null or btrim(p_name)='' or p_enabled is null then raise exception 'Invalid service settings' using errcode='22023'; end if;
 args := jsonb_build_object('code',p_code,'name',p_name,'enabled',p_enabled);
 result := queue_private.replay(a.id,p_request_key,'SERVICE',args); if result is not null then return result; end if;
 select jsonb_build_object('name',name,'enabled',enabled) into previous from queue_private.services where code=p_code;
 if previous is null then raise exception 'Unknown service'; end if;
 if not p_enabled and exists(select 1 from queue_private.tickets t join queue_private.services s on s.id=t.service_id where s.code=p_code and t.status in ('WAITING','CALLED'))
 then raise exception 'Resolve active tickets before disabling service'; end if;
 update queue_private.services set name=p_name,enabled=p_enabled,updated_at=clock_timestamp() where code=p_code;
 result := args;
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(a.id,'SERVICE',args||jsonb_build_object('previous',previous));
 insert into queue_private.operation_requests values(a.id,p_request_key,'SERVICE',args,result,clock_timestamp());
 perform queue_private.refresh_display(); return result;
end $$;

-- Staff read endpoints do not expose student identity.
create function queue_api.staff_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a queue_private.accounts;
begin
 select * into a from queue_private.accounts where id=auth.uid() and enabled;
 if a.id is null or a.role not in ('CASHIER','ADMIN') then raise exception 'Staff required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('ticket_id',t.id,'service',s.code,'number',t.sequence_number,
 'business_date',d.business_date,'status',t.status,'counter_id',t.counter_id,'wait_position',t.wait_position) order by t.wait_position)
 from queue_private.tickets t join queue_private.services s on s.id=t.service_id join queue_private.queue_days d on d.id=t.queue_day_id
 where t.status in ('WAITING','CALLED') and (a.role='ADMIN' or exists
 (select 1 from queue_private.staff_counter_assignments x join queue_private.counter_services cs on cs.counter_id=x.counter_id
 where x.account_id=a.id and cs.service_id=t.service_id))), '[]'::jsonb);
end $$;

create function queue_api.admin_configuration() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from queue_private.accounts where id=auth.uid() and role='ADMIN' and enabled) then raise exception 'Administrator required' using errcode='42501'; end if;
 return jsonb_build_object(
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'enabled',enabled)),'[]') from queue_private.accounts),
 'services',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from queue_private.services s),
 'counters',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from queue_private.counters c),
 'counter_services',(select coalesce(jsonb_agg(to_jsonb(cs)),'[]') from queue_private.counter_services cs),
 'staff_assignments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from queue_private.staff_counter_assignments x),
 'days',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from queue_private.queue_days d));
end $$;
commit;
