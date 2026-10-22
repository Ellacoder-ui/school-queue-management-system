begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table queue_private.staff_management_owner (
 singleton boolean primary key default true check (singleton),
 account_id uuid not null unique references queue_private.accounts(id),
 google_identity_sha256 text not null check (google_identity_sha256 ~ '^[0-9a-f]{64}$')
);
alter table queue_private.staff_management_owner enable row level security;
revoke all on table queue_private.staff_management_owner
 from public,anon,authenticated,service_role;

do $$
declare v_owner queue_private.accounts;
begin
 select a.* into v_owner
 from queue_private.accounts a
 join auth.users u on u.id=a.id
 where a.id='5c96debb-697f-4cad-805f-92b518e28343'
  and a.role='ADMIN' and a.enabled
  and not coalesce(u.is_anonymous,false);
 if v_owner.id is null
  or queue_private.google_identity_binding(v_owner.id) is null then
  raise exception 'Configured staff-management owner must be an enabled ADMIN with a verified Google identity';
 end if;

 insert into queue_private.staff_management_owner(singleton,account_id,google_identity_sha256)
 values(true,v_owner.id,queue_private.google_identity_binding(v_owner.id));

 if exists(select 1 from queue_private.staff_activation_approvals) then
  raise exception 'Legacy staff approvals exist; preserve and review them before removing the approval workflow';
 end if;
end $$;

create or replace function queue_private.require_staff_activation_admin()
returns queue_private.accounts
language plpgsql security definer set search_path = '' as $$
declare v_admin queue_private.accounts;
begin
 select a.* into v_admin
 from queue_private.accounts a
 join auth.users u on u.id=a.id
 join queue_private.staff_management_owner o
  on o.singleton and o.account_id=a.id
  and o.google_identity_sha256=queue_private.google_identity_binding(a.id)
 where a.id=auth.uid() and a.enabled and a.role='ADMIN'
  and not coalesce(u.is_anonymous,false);
 if v_admin.id is null then
  raise exception 'Staff management owner required' using errcode='42501';
 end if;
 perform queue_api.admin_configuration();
 return v_admin;
end $$;
revoke all on function queue_private.require_staff_activation_admin()
 from public,anon,authenticated,service_role;
grant execute on function queue_private.require_staff_activation_admin() to postgres;

create or replace function queue_api.admin_staff_accounts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin queue_private.accounts; v_result jsonb;
begin
 v_admin := queue_private.require_staff_activation_admin();
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,
  'email',case when queue_private.google_identity_binding(a.id) is not null then u.email else null end,
  'role',a.role::text,
  'enabled',a.enabled,
  'google_verified',queue_private.google_identity_binding(a.id) is not null
 ) order by a.id),'[]'::jsonb) into v_result
 from queue_private.accounts a join auth.users u on u.id=a.id
 where a.role in ('ADMIN','CASHIER');
 return v_result;
end $$;

create or replace function queue_api.resolve_staff_google(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin queue_private.accounts; v_result jsonb;
begin
 v_admin := queue_private.require_staff_activation_admin();
 if p_email is null or p_email<>pg_catalog.lower(pg_catalog.btrim(p_email))
  or pg_catalog.length(p_email)>254
  or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 then raise exception 'Invalid staff email' using errcode='22023'; end if;

 select jsonb_build_object(
  'id',a.id,'email',u.email,'role',a.role::text,'enabled',a.enabled,
  'identity_sha256',queue_private.google_identity_binding(a.id),
  'counter_ids',coalesce((
   select jsonb_agg(x.counter_id order by x.counter_id)
   from queue_private.staff_counter_assignments x where x.account_id=a.id
  ),'[]'::jsonb)
 ) into v_result
 from queue_private.accounts a join auth.users u on u.id=a.id
 where pg_catalog.lower(u.email)=p_email
  and queue_private.google_identity_binding(a.id) is not null;
 return v_result;
end $$;

create or replace function queue_api.add_verified_staff(
 p_user uuid,p_email text,p_identity_sha256 text,p_role text,p_counter uuid,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts;
 v_target queue_private.accounts;
 v_email text;
 v_args jsonb;
 v_result jsonb;
 v_counter_number smallint;
 v_expected_service text;
begin
 v_admin := queue_private.require_staff_activation_admin();
 v_admin := queue_private.lock_actor();
 if p_user is null or p_email is null or p_email<>pg_catalog.lower(pg_catalog.btrim(p_email))
  or p_identity_sha256 is null or p_identity_sha256 !~ '^[0-9a-f]{64}$'
  or p_role is null or p_role not in ('CASHIER','ADMIN')
  or (p_role='ADMIN' and p_counter is not null)
  or (p_role='CASHIER' and p_counter is null)
  or p_request_key is null
 then raise exception 'Invalid verified staff action' using errcode='22023'; end if;

 v_args := jsonb_build_object('user',p_user,'email',p_email,'identity_sha256',p_identity_sha256,
  'role',p_role,'counter',p_counter);
 v_result := queue_private.replay(v_admin.id,p_request_key,'STAFF_ACTIVATION',v_args);
 if v_result is not null then return v_result; end if;

 select a.* into v_target
 from queue_private.accounts a join auth.users u on u.id=a.id
 where a.id=p_user for update of a,u;
 perform 1 from auth.identities where user_id=p_user for share;
 select pg_catalog.lower(u.email) into v_email
 from auth.users u where u.id=p_user;
 if v_target.id is null or v_target.id=v_admin.id or not v_target.enabled
  or v_target.role<>'STUDENT' or v_email is distinct from p_email
  or queue_private.google_identity_binding(p_user) is distinct from p_identity_sha256
 then raise exception 'Verified eligible Google student required' using errcode='42501'; end if;
 if exists(select 1 from queue_private.staff_counter_assignments where account_id=p_user)
  or exists(select 1 from queue_private.tickets where owner_id=p_user and status in ('WAITING','CALLED'))
 then raise exception 'Resolve existing assignments or active tickets first'; end if;

 if p_role='CASHIER' then
  select number into v_counter_number
  from queue_private.counters where id=p_counter;
  v_expected_service := queue_private.fixed_service_code(v_counter_number);
  if v_expected_service is null or not exists(
   select 1 from queue_private.counter_services cs
   join queue_private.services s on s.id=cs.service_id
   where cs.counter_id=p_counter and s.code=v_expected_service and s.enabled
  ) then raise exception 'Choose an enabled fixed-service counter' using errcode='22023'; end if;
 end if;

 update queue_private.accounts
 set role=p_role::queue_private.app_role,updated_at=clock_timestamp()
 where id=p_user;
 if p_role='CASHIER' then
  insert into queue_private.staff_counter_assignments(account_id,counter_id)
  values(p_user,p_counter);
 end if;

 v_result := jsonb_build_object('user',p_user,'role',p_role,'enabled',true,'counter',p_counter);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_admin.id,'STAFF_ACTIVATION',jsonb_build_object(
  'user',p_user,'role',p_role,'counter',p_counter
 ));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(v_admin.id,p_request_key,'STAFF_ACTIVATION',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

create or replace function queue_api.set_account(
 p_user uuid,p_role text,p_enabled boolean,p_request_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts;
 v_old queue_private.accounts;
 v_args jsonb;
 v_result jsonb;
begin
 v_admin := queue_private.require_staff_activation_admin();
 v_admin := queue_private.lock_actor();
 if p_user is null or p_role is null or p_role not in ('STUDENT','CASHIER','ADMIN')
  or p_enabled is null or p_request_key is null then
  raise exception 'Invalid account settings' using errcode='22023';
 end if;

 v_args := jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled);
 v_result := queue_private.replay(v_admin.id,p_request_key,'ACCOUNT',v_args);
 if v_result is not null then return v_result; end if;

 select a.* into v_old
 from queue_private.accounts a
 join auth.users u on u.id=a.id
 where a.id=p_user
 for update of a,u;
 if v_old.id is null then raise exception 'Account not found'; end if;
 if exists(select 1 from queue_private.staff_management_owner o where o.account_id=p_user)
  and (p_role<>'ADMIN' or not p_enabled) then
  raise exception 'The configured staff-management owner cannot be demoted or disabled' using errcode='42501';
 end if;
 if p_role in ('ADMIN','CASHIER')
  and queue_private.google_identity_binding(p_user) is null then
  raise exception 'Verified Google identity required for staff access' using errcode='42501';
 end if;
 if v_old.role='ADMIN' and v_old.enabled and (p_role<>'ADMIN' or not p_enabled)
  and (select count(*) from queue_private.accounts where role='ADMIN' and enabled)=1 then
  raise exception 'Cannot remove last enabled administrator';
 end if;
 if exists(select 1 from queue_private.tickets where owner_id=p_user and status in ('WAITING','CALLED'))
  and (not p_enabled or p_role<>v_old.role::text) then
  raise exception 'Resolve active ticket before changing account';
 end if;
 if v_old.role='CASHIER' and (p_role<>'CASHIER' or not p_enabled) and exists
  (select 1 from queue_private.staff_counter_assignments x
   join queue_private.tickets t on t.counter_id=x.counter_id where x.account_id=p_user and t.status='CALLED') then
  raise exception 'Resolve called tickets before changing cashier';
 end if;

 update queue_private.accounts
 set role=p_role::queue_private.app_role,enabled=p_enabled,updated_at=clock_timestamp()
 where id=p_user;
 if p_role<>'CASHIER' or not p_enabled then
  delete from queue_private.staff_counter_assignments where account_id=p_user;
 end if;
 v_result := jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_admin.id,'ACCOUNT',v_args||jsonb_build_object(
  'previous_role',v_old.role,'previous_enabled',v_old.enabled
 ));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(v_admin.id,p_request_key,'ACCOUNT',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

create or replace function queue_api.configure_counter(
 p_counter uuid,p_open boolean,p_services text[],p_cashiers uuid[],p_request_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 a queue_private.accounts;
 args jsonb;
 result jsonb;
 previous jsonb;
 expected text;
 current_cashiers uuid[];
 requested_cashiers uuid[];
begin
 a := queue_private.lock_actor();
 if a.role<>'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_open is null or p_services is null or p_cashiers is null or p_request_key is null then
  raise exception 'Explicit configuration required' using errcode='22023';
 end if;
 if exists(select 1 from unnest(p_cashiers) x where x is null) then
  raise exception 'Unknown service or ineligible cashier' using errcode='22023';
 end if;

 select coalesce(array_agg(x.account_id order by x.account_id),'{}'::uuid[])
 into current_cashiers
 from queue_private.staff_counter_assignments x
 where x.counter_id=p_counter;
 select coalesce(array_agg(q.account_id order by q.account_id),'{}'::uuid[])
 into requested_cashiers
 from (select distinct x as account_id from unnest(p_cashiers) x) q;
 if current_cashiers is distinct from requested_cashiers then
  perform queue_private.require_staff_activation_admin();
 end if;

 args := jsonb_build_object('counter',p_counter,'open',p_open,'services',p_services,'cashiers',p_cashiers);
 result := queue_private.replay(a.id,p_request_key,'COUNTER',args);
 if result is not null then return result; end if;

 select queue_private.fixed_service_code(number) into expected
 from queue_private.counters where id=p_counter;
 if expected is null then raise exception 'Counter not found'; end if;
 if cardinality(p_services)<>1 or array_ndims(p_services)<>1
  or p_services[array_lower(p_services,1)] is distinct from expected then
  raise exception 'Counter requires its single fixed service' using errcode='22023';
 end if;
 if exists(
  select 1 from unnest(p_cashiers) x
  where not exists(select 1 from queue_private.accounts where id=x and role='CASHIER' and enabled)
 ) then raise exception 'Unknown service or ineligible cashier'; end if;
 if exists(select 1 from queue_private.tickets where counter_id=p_counter and status='CALLED') then
  raise exception 'Resolve called ticket before reconfiguration';
 end if;
 if p_open and cardinality(p_cashiers)=0 then raise exception 'Open counter requires services and cashiers'; end if;
 perform queue_private.assert_fixed_routing();
 previous := jsonb_build_object(
  'open',(select is_open from queue_private.counters where id=p_counter),
  'services',(select jsonb_agg(service_id) from queue_private.counter_services where counter_id=p_counter),
  'cashiers',(select jsonb_agg(account_id) from queue_private.staff_counter_assignments where counter_id=p_counter)
 );
 delete from queue_private.staff_counter_assignments where counter_id=p_counter;
 insert into queue_private.staff_counter_assignments
 select distinct x,p_counter from unnest(p_cashiers) x;
 update queue_private.counters set is_open=p_open,updated_at=clock_timestamp() where id=p_counter;
 result := args;
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(a.id,'COUNTER',args||jsonb_build_object('previous',previous));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(a.id,p_request_key,'COUNTER',args,result,clock_timestamp());
 perform queue_private.refresh_display();
 return result;
end $$;

drop function queue_private.review_staff_activation(
 uuid,text,text,text,uuid,text,timestamptz
);
drop table queue_private.staff_activation_approvals;

comment on table queue_private.staff_management_owner is
 'The single staff-role management owner, pinned to the verified Google identity at migration time.';

revoke all on function queue_private.google_identity_binding(uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_private.google_identity_binding(uuid) to postgres;

notify pgrst,'reload schema';
commit;
