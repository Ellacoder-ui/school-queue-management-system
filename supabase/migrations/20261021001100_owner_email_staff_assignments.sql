begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table queue_private.pending_staff_assignments (
 id uuid primary key default extensions.gen_random_uuid(),
 email text not null check (email=pg_catalog.lower(pg_catalog.btrim(email))
  and pg_catalog.length(email)<=254
  and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 role text not null check (role in ('CASHIER','ADMIN')),
 counter_id uuid references queue_private.counters(id),
 assigned_by uuid not null references queue_private.accounts(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 claimed_by uuid references queue_private.accounts(id),
 claimed_at timestamptz,
 canceled_at timestamptz,
 check ((role='CASHIER' and counter_id is not null) or (role='ADMIN' and counter_id is null)),
 check ((claimed_by is null)=(claimed_at is null)),
 check (claimed_at is null or canceled_at is null)
);
create unique index pending_staff_assignments_email
 on queue_private.pending_staff_assignments(email)
 where claimed_at is null and canceled_at is null;
alter table queue_private.pending_staff_assignments enable row level security;
revoke all on table queue_private.pending_staff_assignments
 from public,anon,authenticated,service_role;

create function queue_private.assert_staff_route(p_role text,p_counter uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_number smallint; v_code text;
begin
 if p_role='ADMIN' then
  if p_counter is not null then raise exception 'ADMIN access cannot include a cashier counter' using errcode='22023'; end if;
  return;
 end if;
 if p_role<>'CASHIER' or p_counter is null then raise exception 'Choose CASHIER with a fixed counter or ADMIN' using errcode='22023'; end if;
 select number into v_number from queue_private.counters where id=p_counter;
 v_code := queue_private.fixed_service_code(v_number);
 if v_code is null or not exists(
  select 1 from queue_private.counter_services cs
  join queue_private.services s on s.id=cs.service_id
  where cs.counter_id=p_counter and s.code=v_code and s.enabled
 ) then raise exception 'Choose an enabled fixed-service counter' using errcode='22023'; end if;
end $$;
revoke all on function queue_private.assert_staff_route(text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_private.assert_staff_route(text,uuid) to postgres;

create function queue_api.assign_staff_by_email(
 p_email text,p_role text,p_counter uuid,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts; v_target queue_private.accounts; v_user_id uuid;
 v_auth_email text; v_confirmed timestamptz; v_auth_matches integer; v_args jsonb; v_result jsonb;
 v_identity text; v_invitation queue_private.pending_staff_assignments;
begin
 v_admin := queue_private.require_staff_activation_admin();
 v_admin := queue_private.lock_actor();
 if p_email is null or p_email<>pg_catalog.lower(pg_catalog.btrim(p_email))
  or pg_catalog.length(p_email)>254
  or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_role is null or p_role not in ('CASHIER','ADMIN') or p_request_key is null
 then raise exception 'Invalid staff email assignment' using errcode='22023'; end if;
 perform queue_private.assert_staff_route(p_role,p_counter);
 v_args := jsonb_build_object('email',p_email,'role',p_role,'counter',p_counter);
 v_result := queue_private.replay(v_admin.id,p_request_key,'STAFF_EMAIL_ASSIGNMENT',v_args);
 if v_result is not null then return v_result; end if;

 select count(*) into v_auth_matches from auth.users u where pg_catalog.lower(u.email)=p_email;
 if v_auth_matches>1 then raise exception 'Multiple Auth accounts match this email; no role was changed' using errcode='23505'; end if;
 select u.id,pg_catalog.lower(u.email),u.email_confirmed_at
 into v_user_id,v_auth_email,v_confirmed
 from auth.users u where pg_catalog.lower(u.email)=p_email for update;
 if v_user_id is not null then
  select * into v_target from queue_private.accounts where id=v_user_id for update;
  v_identity := queue_private.google_identity_binding(v_target.id);
  if v_target.id=v_admin.id or not v_target.enabled or v_target.role<>'STUDENT'
   or v_auth_email is distinct from p_email or v_confirmed is null or v_identity is null
   or exists(select 1 from queue_private.staff_counter_assignments where account_id=v_target.id)
   or exists(select 1 from queue_private.tickets where owner_id=v_target.id and status in ('WAITING','CALLED'))
  then raise exception 'Verified eligible Google student required; existing staff access and active tickets are preserved' using errcode='42501'; end if;
  update queue_private.accounts set role=p_role::queue_private.app_role,updated_at=clock_timestamp()
   where id=v_target.id;
  if p_role='CASHIER' then
   insert into queue_private.staff_counter_assignments(account_id,counter_id) values(v_target.id,p_counter);
  end if;
  update queue_private.pending_staff_assignments set claimed_by=v_target.id,claimed_at=clock_timestamp(),
   updated_at=clock_timestamp()
   where email=p_email and claimed_at is null and canceled_at is null;
  v_result := jsonb_build_object('status','ASSIGNED','user',v_target.id,'email',p_email,
   'role',p_role,'counter',p_counter);
  insert into queue_private.admin_audit_events(actor_id,action,parameters)
   values(v_admin.id,'STAFF_EMAIL_ASSIGNMENT',jsonb_build_object(
    'user',v_target.id,'email',p_email,'role',p_role,'counter',p_counter));
 else
  if exists(select 1 from queue_private.pending_staff_assignments where email=p_email
   and claimed_at is null and canceled_at is null) then
   raise exception 'Pending staff assignment already exists for this email' using errcode='23505';
  end if;
  insert into queue_private.pending_staff_assignments(email,role,counter_id,assigned_by)
   values(p_email,p_role,p_counter,v_admin.id) returning * into v_invitation;
  v_result := jsonb_build_object('status','PENDING_FIRST_LOGIN','invitation',v_invitation.id,
   'email',p_email,'role',p_role,'counter',p_counter);
  insert into queue_private.admin_audit_events(actor_id,action,parameters)
   values(v_admin.id,'PENDING_STAFF_ASSIGNMENT',jsonb_build_object(
    'invitation',v_invitation.id,'email',p_email,'role',p_role,'counter',p_counter));
 end if;
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
  values(v_admin.id,p_request_key,'STAFF_EMAIL_ASSIGNMENT',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

create function queue_api.manage_pending_staff(
 p_invitation uuid,p_action text,p_email text,p_role text,p_counter uuid,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts; v_row queue_private.pending_staff_assignments;
 v_args jsonb; v_result jsonb;
begin
 v_admin := queue_private.require_staff_activation_admin();
 v_admin := queue_private.lock_actor();
 if p_invitation is null or p_action is null or p_action not in ('UPDATE','CANCEL') or p_request_key is null then
  raise exception 'Invalid pending staff action' using errcode='22023';
 end if;
 if p_action='UPDATE' then
  if p_email is null or p_email<>pg_catalog.lower(pg_catalog.btrim(p_email))
   or pg_catalog.length(p_email)>254
   or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or p_role not in ('CASHIER','ADMIN')
  then raise exception 'Invalid pending staff assignment' using errcode='22023'; end if;
  perform queue_private.assert_staff_route(p_role,p_counter);
 elsif p_email is not null or p_role is not null or p_counter is not null then
  raise exception 'Cancel action cannot change assignment details' using errcode='22023';
 end if;
 v_args := jsonb_build_object('invitation',p_invitation,'action',p_action,
  'email',p_email,'role',p_role,'counter',p_counter);
 v_result := queue_private.replay(v_admin.id,p_request_key,'PENDING_STAFF_MANAGEMENT',v_args);
 if v_result is not null then return v_result; end if;
 select * into v_row from queue_private.pending_staff_assignments
 where id=p_invitation and claimed_at is null and canceled_at is null for update;
 if v_row.id is null then raise exception 'Pending assignment is no longer available' using errcode='22023'; end if;
 if p_action='CANCEL' then
  update queue_private.pending_staff_assignments set canceled_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_invitation;
  v_result := jsonb_build_object('invitation',p_invitation,'status','CANCELLED');
  insert into queue_private.admin_audit_events(actor_id,action,parameters)
   values(v_admin.id,'CANCEL_PENDING_STAFF',jsonb_build_object('invitation',p_invitation,'email',v_row.email));
 else
  if exists(select 1 from auth.users where pg_catalog.lower(email)=p_email) then
   raise exception 'Email already belongs to an Auth account; use verified account assignment' using errcode='23505';
  end if;
  update queue_private.pending_staff_assignments
   set email=p_email,role=p_role,counter_id=p_counter,updated_at=clock_timestamp()
   where id=p_invitation returning * into v_row;
  v_result := jsonb_build_object('invitation',v_row.id,'email',v_row.email,
   'role',v_row.role,'counter',v_row.counter_id,'status','PENDING_FIRST_LOGIN');
  insert into queue_private.admin_audit_events(actor_id,action,parameters)
   values(v_admin.id,'UPDATE_PENDING_STAFF',jsonb_build_object(
    'invitation',v_row.id,'email',v_row.email,'role',v_row.role,'counter',v_row.counter_id));
 end if;
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
  values(v_admin.id,p_request_key,'PENDING_STAFF_MANAGEMENT',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

create function queue_api.admin_pending_staff()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin queue_private.accounts; v_result jsonb;
begin
 v_admin := queue_private.require_staff_activation_admin();
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'email',p.email,'role',p.role,'counter',p.counter_id,'created_at',p.created_at
 ) order by p.created_at,p.id),'[]'::jsonb)
 into v_result from queue_private.pending_staff_assignments p
 where p.claimed_at is null and p.canceled_at is null;
 return v_result;
end $$;

create function queue_private.claim_pending_staff()
returns void language plpgsql security definer set search_path = '' as $$
declare
 v_actor queue_private.accounts; v_email text; v_invitation queue_private.pending_staff_assignments;
begin
 select pg_catalog.lower(u.email) into v_email
 from auth.users u
 where u.id=auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  and queue_private.google_identity_binding(u.id) is not null;
 if v_email is null or not exists(
  select 1 from queue_private.pending_staff_assignments
  where email=v_email and claimed_at is null and canceled_at is null
 ) then return; end if;
 perform 1 from queue_private.settings where id for update;
 select a.* into v_actor from queue_private.accounts a
 join auth.users u on u.id=a.id
 where a.id=auth.uid() and a.enabled and a.role='STUDENT'
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  and queue_private.google_identity_binding(a.id) is not null
 for update of a;
 if v_actor.id is null or v_actor.role<>'STUDENT' or not v_actor.enabled
  or exists(select 1 from queue_private.staff_counter_assignments where account_id=v_actor.id)
  or exists(select 1 from queue_private.tickets where owner_id=v_actor.id and status in ('WAITING','CALLED'))
 then return; end if;
 select * into v_invitation from queue_private.pending_staff_assignments
 where email=v_email and claimed_at is null and canceled_at is null for update;
 if v_invitation.id is null then return; end if;
 perform queue_private.assert_staff_route(v_invitation.role,v_invitation.counter_id);
 update queue_private.accounts set role=v_invitation.role::queue_private.app_role,updated_at=clock_timestamp()
 where id=v_actor.id;
 if v_invitation.role='CASHIER' then
  insert into queue_private.staff_counter_assignments(account_id,counter_id)
  values(v_actor.id,v_invitation.counter_id);
 end if;
 update queue_private.pending_staff_assignments set claimed_by=v_actor.id,claimed_at=clock_timestamp(),
  updated_at=clock_timestamp() where id=v_invitation.id;
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_actor.id,'CLAIM_PENDING_STAFF',jsonb_build_object(
  'invitation',v_invitation.id,'role',v_invitation.role,'counter',v_invitation.counter_id));
end $$;
revoke all on function queue_private.claim_pending_staff()
 from public,anon,authenticated,service_role;
grant execute on function queue_private.claim_pending_staff() to postgres;

create or replace function queue_api.my_context() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_role queue_private.app_role; v_enabled boolean; v_counters jsonb;
begin
 perform queue_private.claim_pending_staff();
 select a.role,a.enabled into v_role,v_enabled
 from queue_private.accounts a join auth.users u on u.id=a.id
 where a.id=auth.uid() and not coalesce(u.is_anonymous,false);
 if not found then raise exception 'Authenticated account required' using errcode='42501'; end if;
 if not v_enabled then
  return pg_catalog.jsonb_build_object('role',null,'enabled',false,'cashier_counters','[]'::jsonb);
 end if;
 v_counters := '[]'::jsonb;
 if v_role='CASHIER'::queue_private.app_role then
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'counter_id',c.id,'counter_number',c.number,'counter_label',c.label,'is_open',c.is_open,
   'service_codes',(select coalesce(pg_catalog.jsonb_agg(s.code order by s.code),'[]'::jsonb)
    from queue_private.counter_services cs join queue_private.services s on s.id=cs.service_id
    where cs.counter_id=c.id and s.enabled)
  ) order by c.number),'[]'::jsonb) into v_counters
  from queue_private.staff_counter_assignments x
  join queue_private.counters c on c.id=x.counter_id where x.account_id=auth.uid();
 end if;
 return pg_catalog.jsonb_build_object('role',v_role::text,'enabled',true,'cashier_counters',v_counters);
end $$;

revoke all on function queue_api.assign_staff_by_email(text,text,uuid,uuid),
 queue_api.manage_pending_staff(uuid,text,text,text,uuid,uuid),queue_api.admin_pending_staff()
 from public,anon,authenticated,service_role;
grant execute on function queue_api.assign_staff_by_email(text,text,uuid,uuid),
 queue_api.manage_pending_staff(uuid,text,text,text,uuid,uuid),queue_api.admin_pending_staff()
 to authenticated;
notify pgrst,'reload schema';
commit;
