begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table if not exists queue_private.staff_activation_approvals (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references queue_private.accounts(id),
 email text not null check (email=lower(btrim(email))),
 identity_sha256 text not null check (identity_sha256 ~ '^[0-9a-f]{64}$'),
 staff_role queue_private.app_role not null check (staff_role in ('ADMIN','CASHIER')),
 counter_id uuid references queue_private.counters(id),
 approval_reference text not null unique
  check (length(btrim(approval_reference)) between 1 and 200),
 approved_by name not null,
 approved_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 check ((staff_role='CASHIER')=(counter_id is not null)),
 check (expires_at>approved_at and expires_at<=approved_at+interval '30 days')
);
create unique index if not exists staff_activation_one_pending_approval
 on queue_private.staff_activation_approvals(account_id)
 where consumed_at is null;
alter table queue_private.staff_activation_approvals enable row level security;
revoke all on table queue_private.staff_activation_approvals
 from public,anon,authenticated,service_role;

create or replace function queue_private.google_identity_binding(p_user uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_binding text;
begin
 select case when count(*)=1 then min(binding) end into v_binding
 from (
  select pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
   'subject',i.identity_data->>'sub',
   'email',pg_catalog.lower(u.email),
   'identity_email',pg_catalog.lower(i.identity_data->>'email'),
   'email_verified',i.identity_data->>'email_verified'
  )::text,'sha256'),'hex') as binding
  from auth.identities i
  join auth.users u on u.id=i.user_id
  where i.user_id=p_user and i.provider='google'
   and i.identity_data->>'email_verified'='true'
   and nullif(i.identity_data->>'sub','') is not null
   and i.provider_id=i.identity_data->>'sub'
   and pg_catalog.lower(i.identity_data->>'email')=pg_catalog.lower(u.email)
   and pg_catalog.lower(i.email)=pg_catalog.lower(u.email)
   and u.email_confirmed_at is not null
   and coalesce(u.is_anonymous,false)=false
 ) verified;
 return v_binding;
end $$;

create or replace function queue_private.require_staff_activation_admin()
returns queue_private.accounts
language plpgsql security definer set search_path = '' as $$
declare v_admin queue_private.accounts;
begin
 select a.* into v_admin
 from queue_private.accounts a
 join auth.users u on u.id=a.id
 where a.id=auth.uid() and a.enabled and a.role='ADMIN'
  and not coalesce(u.is_anonymous,false);
 if v_admin.id is null then
  raise exception 'Administrator required' using errcode='42501';
 end if;
 if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'Administrator AAL2 required' using errcode='42501';
 end if;
 if not exists(
  select 1 from auth.mfa_factors f
  where f.user_id=v_admin.id and f.status::text='verified'
   and f.factor_type::text='totp'
 ) then
  raise exception 'Verified administrator MFA required' using errcode='42501';
 end if;
 perform queue_api.admin_configuration();
 return v_admin;
end $$;

create or replace function queue_private.review_staff_activation(
 p_user uuid,p_email text,p_identity_sha256 text,p_role text,p_counter uuid,
 p_reference text,p_expires_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
 v_target queue_private.accounts;
 v_email text;
 v_counter_number smallint;
 v_expected_service text;
 v_approval uuid;
begin
 if session_user<>'postgres' or current_setting('role') not in ('none','postgres') then
  raise exception 'Direct database operator required' using errcode='42501';
 end if;
 if p_user is null or p_email is null or p_email<>pg_catalog.lower(pg_catalog.btrim(p_email))
  or pg_catalog.length(p_email)>254
  or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_identity_sha256 is null or p_identity_sha256 !~ '^[0-9a-f]{64}$'
  or p_role is null or p_role not in ('CASHIER','ADMIN')
  or (p_role='ADMIN' and p_counter is not null)
  or (p_role='CASHIER' and p_counter is null)
  or p_reference is null or length(btrim(p_reference)) not between 1 and 200
  or p_expires_at is null or p_expires_at<=clock_timestamp()
  or p_expires_at>clock_timestamp()+interval '30 days'
 then raise exception 'Invalid operator staff approval' using errcode='22023'; end if;

 perform 1 from queue_private.settings where id for update;
 if not found then raise exception 'Queue configuration missing'; end if;
 select a.* into v_target
 from queue_private.accounts a join auth.users u on u.id=a.id
 where a.id=p_user for update of a,u;
 perform 1 from auth.identities where user_id=p_user for share;
 select pg_catalog.lower(u.email) into v_email
 from auth.users u where u.id=p_user;
 if v_target.id is null or not v_target.enabled or v_target.role<>'STUDENT'
  or v_email is distinct from p_email
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

 update queue_private.staff_activation_approvals
 set consumed_at=clock_timestamp()
 where account_id=p_user and consumed_at is null and expires_at<=clock_timestamp();
 if exists(select 1 from queue_private.staff_activation_approvals
  where account_id=p_user and consumed_at is null)
 then raise exception 'A staff approval is already pending' using errcode='22023'; end if;

 insert into queue_private.staff_activation_approvals
  (account_id,email,identity_sha256,staff_role,counter_id,approval_reference,approved_by,expires_at)
 values(p_user,p_email,p_identity_sha256,p_role::queue_private.app_role,p_counter,
  btrim(p_reference),session_user,p_expires_at)
 returning id into v_approval;
 return v_approval;
end $$;

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
 v_approval queue_private.staff_activation_approvals;
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

 select * into v_approval
 from queue_private.staff_activation_approvals
 where account_id=p_user and email=p_email and identity_sha256=p_identity_sha256
  and staff_role=p_role::queue_private.app_role
  and counter_id is not distinct from p_counter
  and consumed_at is null and expires_at>clock_timestamp()
 for update;
 if v_approval.id is null then
  raise exception 'Current operator staff approval required' using errcode='42501';
 end if;

 update queue_private.accounts
 set role=p_role::queue_private.app_role,updated_at=clock_timestamp()
 where id=p_user;
 if p_role='CASHIER' then
  insert into queue_private.staff_counter_assignments(account_id,counter_id)
  values(p_user,p_counter);
 end if;
 update queue_private.staff_activation_approvals
 set consumed_at=clock_timestamp() where id=v_approval.id;

 v_result := jsonb_build_object('user',p_user,'role',p_role,'enabled',true,'counter',p_counter);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_admin.id,'STAFF_ACTIVATION',jsonb_build_object(
  'user',p_user,'role',p_role,'counter',p_counter,
  'approval_reference',v_approval.approval_reference
 ));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(v_admin.id,p_request_key,'STAFF_ACTIVATION',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

revoke all on function queue_private.google_identity_binding(uuid),
 queue_private.require_staff_activation_admin(),
 queue_private.review_staff_activation(uuid,text,text,text,uuid,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function queue_private.review_staff_activation(
 uuid,text,text,text,uuid,text,timestamptz
) to postgres;
revoke all on function queue_api.admin_staff_accounts(),
 queue_api.resolve_staff_google(text),
 queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_api.admin_staff_accounts(),
 queue_api.resolve_staff_google(text),
 queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)
 to authenticated;

notify pgrst,'reload schema';
commit;
