begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $$
declare
 v_conflicts text[] := array[]::text[];
 v_detail text;
begin
 select string_agg(format('counter %s has %s active assignments',counter_id,n),'; ')
 into v_detail
 from (
  select counter_id,count(*) n from queue_private.staff_counter_assignments
  group by counter_id having count(*)>1
 ) q;
 if v_detail is not null then v_conflicts:=array_append(v_conflicts,v_detail); end if;

 select string_agg(format('cashier %s has %s counter assignments',account_id,n),'; ')
 into v_detail
 from (
  select account_id,count(*) n from queue_private.staff_counter_assignments
  group by account_id having count(*)>1
 ) q;
 if v_detail is not null then v_conflicts:=array_append(v_conflicts,v_detail); end if;

 select string_agg(format('account %s has a counter assignment but is not an enabled CASHIER',x.account_id),'; ')
 into v_detail
 from queue_private.staff_counter_assignments x
 join queue_private.accounts a on a.id=x.account_id
 where a.role<>'CASHIER' or not a.enabled;
 if v_detail is not null then v_conflicts:=array_append(v_conflicts,v_detail); end if;

 select string_agg(format('counter %s has both an active assignment and pending CASHIER reservation',p.counter_id),'; ')
 into v_detail
 from queue_private.pending_staff_assignments p
 join queue_private.staff_counter_assignments x on x.counter_id=p.counter_id
 where p.role='CASHIER' and p.claimed_at is null and p.canceled_at is null;
 if v_detail is not null then v_conflicts:=array_append(v_conflicts,v_detail); end if;

 select string_agg(format('counter %s has %s pending CASHIER reservations',counter_id,n),'; ')
 into v_detail
 from (
  select counter_id,count(*) n from queue_private.pending_staff_assignments
  where role='CASHIER' and claimed_at is null and canceled_at is null
  group by counter_id having count(*)>1
 ) q;
 if v_detail is not null then v_conflicts:=array_append(v_conflicts,v_detail); end if;

 if cardinality(v_conflicts)>0 then
  raise exception 'Staff counter exclusivity migration requires explicit conflict resolution'
   using detail=array_to_string(v_conflicts,E'\n');
 end if;
end $$;

create unique index staff_counter_assignments_one_counter_per_cashier
 on queue_private.staff_counter_assignments(account_id);
create unique index staff_counter_assignments_one_cashier_per_counter
 on queue_private.staff_counter_assignments(counter_id);
create unique index pending_staff_one_counter_reservation
 on queue_private.pending_staff_assignments(counter_id)
 where role='CASHIER' and claimed_at is null and canceled_at is null;

create function queue_private.lock_staff_assignment_changes()
returns void language sql volatile security definer set search_path = '' as $$
 select pg_catalog.pg_advisory_xact_lock(782410992031::bigint)
$$;
revoke all on function queue_private.lock_staff_assignment_changes()
 from public,anon,authenticated,service_role;
grant execute on function queue_private.lock_staff_assignment_changes() to postgres;

create function queue_private.enforce_staff_counter_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
 v_role text;
 v_enabled boolean;
begin
 perform queue_private.lock_staff_assignment_changes();
 if tg_op='DELETE' then return old; end if;

 select role::text,enabled into v_role,v_enabled
 from queue_private.accounts where id=new.account_id;
 if v_role is distinct from 'CASHIER' or v_enabled is distinct from true then
  raise exception 'Only an enabled CASHIER can be assigned to a counter' using errcode='23514';
 end if;
 if exists(
  select 1 from queue_private.staff_counter_assignments x
  where ((x.account_id=new.account_id and x.counter_id<>new.counter_id)
     or (x.counter_id=new.counter_id and x.account_id<>new.account_id))
    and not (tg_op='UPDATE' and x.account_id=old.account_id and x.counter_id=old.counter_id)
 ) then
  raise exception 'Cashier or counter already has an active assignment' using errcode='23505';
 end if;
 if exists(
  select 1 from queue_private.pending_staff_assignments p
  where p.counter_id=new.counter_id and p.role='CASHIER'
   and p.claimed_at is null and p.canceled_at is null
 ) then
  raise exception 'Counter has a pending cashier reservation' using errcode='23505';
 end if;
 return new;
end $$;
revoke all on function queue_private.enforce_staff_counter_assignment()
 from public,anon,authenticated,service_role;
create trigger enforce_staff_counter_assignment
 before insert or update or delete on queue_private.staff_counter_assignments
 for each row execute function queue_private.enforce_staff_counter_assignment();

create function queue_private.enforce_pending_staff_counter_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform queue_private.lock_staff_assignment_changes();
 if tg_op='DELETE' then return old; end if;
 if new.role='CASHIER' and new.claimed_at is null and new.canceled_at is null then
  if exists(select 1 from queue_private.staff_counter_assignments x where x.counter_id=new.counter_id) then
   raise exception 'Counter already has an active assignment' using errcode='23505';
  end if;
  if exists(
   select 1 from queue_private.pending_staff_assignments p
   where p.counter_id=new.counter_id and p.role='CASHIER'
    and p.claimed_at is null and p.canceled_at is null
    and not (tg_op='UPDATE' and p.id=old.id)
  ) then
   raise exception 'Counter already has a pending cashier reservation' using errcode='23505';
  end if;
  if exists(
   select 1 from auth.users u
   join queue_private.accounts a on a.id=u.id and a.role='CASHIER' and a.enabled
   join queue_private.staff_counter_assignments x on x.account_id=a.id
   where pg_catalog.lower(u.email)=new.email
  ) then
   raise exception 'Email already belongs to an assigned cashier' using errcode='23505';
  end if;
 end if;
 return new;
end $$;
revoke all on function queue_private.enforce_pending_staff_counter_reservation()
 from public,anon,authenticated,service_role;
create trigger enforce_pending_staff_counter_reservation
 before insert or update or delete on queue_private.pending_staff_assignments
 for each row execute function queue_private.enforce_pending_staff_counter_reservation();

create function queue_api.set_staff_access(
 p_user uuid,p_role text,p_enabled boolean,p_counter uuid,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts;
 v_old queue_private.accounts;
 v_email text;
 v_old_counter uuid;
 v_args jsonb;
 v_result jsonb;
begin
 v_admin:=queue_private.require_staff_activation_admin();
 v_admin:=queue_private.lock_actor();
 if p_user is null or p_role not in ('ADMIN','CASHIER') or p_enabled is null
  or p_request_key is null
  or (p_role='CASHIER' and p_enabled and p_counter is null)
  or ((p_role='ADMIN' or not p_enabled) and p_counter is not null) then
  raise exception 'Invalid staff access configuration' using errcode='22023';
 end if;
 perform queue_private.lock_staff_assignment_changes();

 v_args:=jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled,'counter',p_counter);
 v_result:=queue_private.replay(v_admin.id,p_request_key,'STAFF_ACCESS',v_args);
 if v_result is not null then return v_result; end if;

 select a.* into v_old
 from queue_private.accounts a join auth.users u on u.id=a.id
 where a.id=p_user for update of a,u;
 if v_old.id is null then raise exception 'Account not found'; end if;
 if exists(select 1 from queue_private.staff_management_owner o where o.account_id=p_user)
  and (p_role<>'ADMIN' or not p_enabled) then
  raise exception 'The configured staff-management owner cannot be demoted or disabled' using errcode='42501';
 end if;
 if queue_private.google_identity_binding(p_user) is null then
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
 select counter_id into v_old_counter from queue_private.staff_counter_assignments
 where account_id=p_user;
 if v_old.role='CASHIER' and exists(
  select 1 from queue_private.tickets where counter_id=v_old_counter and status='CALLED'
 ) and (p_role<>'CASHIER' or not p_enabled or v_old_counter is distinct from p_counter) then
  raise exception 'Resolve called tickets before changing cashier assignment';
 end if;
 if p_role='CASHIER' and p_enabled then
  perform queue_private.assert_staff_route(p_role,p_counter);
  if exists(select 1 from queue_private.staff_counter_assignments
    where counter_id=p_counter and account_id<>p_user) then
   raise exception 'Counter already has an assigned cashier' using errcode='23505';
  end if;
  if exists(select 1 from queue_private.pending_staff_assignments
    where counter_id=p_counter and role='CASHIER' and claimed_at is null and canceled_at is null) then
   raise exception 'Counter has a pending cashier reservation' using errcode='23505';
  end if;
  select pg_catalog.lower(email) into v_email from auth.users where id=p_user;
  if exists(select 1 from queue_private.pending_staff_assignments
    where email=v_email and claimed_at is null and canceled_at is null) then
   raise exception 'A pending staff assignment exists for this email' using errcode='23505';
  end if;
 end if;

 update queue_private.accounts set role=p_role::queue_private.app_role,enabled=p_enabled,updated_at=clock_timestamp()
 where id=p_user;
 delete from queue_private.staff_counter_assignments where account_id=p_user;
 if p_role='CASHIER' and p_enabled then
  insert into queue_private.staff_counter_assignments(account_id,counter_id) values(p_user,p_counter);
 end if;
 v_result:=jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled,
  'counter',case when p_role='CASHIER' and p_enabled then p_counter else null end);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_admin.id,'STAFF_ACCESS',v_args||jsonb_build_object(
  'previous_role',v_old.role,'previous_enabled',v_old.enabled,'previous_counter',v_old_counter));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(v_admin.id,p_request_key,'STAFF_ACCESS',v_args,v_result,clock_timestamp());
 return v_result;
end $$;
revoke all on function queue_api.set_staff_access(uuid,text,boolean,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_api.set_staff_access(uuid,text,boolean,uuid,uuid) to authenticated;

create or replace function queue_api.set_account(
 p_user uuid,p_role text,p_enabled boolean,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts;
 v_old queue_private.accounts;
 v_args jsonb;
 v_result jsonb;
begin
 v_admin:=queue_private.require_staff_activation_admin();
 v_admin:=queue_private.lock_actor();
 if p_user is null or p_role is null or p_role not in ('STUDENT','CASHIER','ADMIN')
  or p_enabled is null or p_request_key is null then
  raise exception 'Invalid account settings' using errcode='22023';
 end if;
 v_args:=jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled);
 v_result:=queue_private.replay(v_admin.id,p_request_key,'ACCOUNT',v_args);
 if v_result is not null then return v_result; end if;
 select a.* into v_old from queue_private.accounts a join auth.users u on u.id=a.id
 where a.id=p_user for update of a,u;
 if v_old.id is null then raise exception 'Account not found'; end if;
 if p_role='CASHIER' and p_enabled
  and (v_old.role<>'CASHIER' or not exists(
   select 1 from queue_private.staff_counter_assignments where account_id=p_user
  )) then
  raise exception 'Use set_staff_access to assign a cashier counter' using errcode='42501';
 end if;
 if exists(select 1 from queue_private.staff_management_owner o where o.account_id=p_user)
  and (p_role<>'ADMIN' or not p_enabled) then
  raise exception 'The configured staff-management owner cannot be demoted or disabled' using errcode='42501';
 end if;
 if p_role in ('ADMIN','CASHIER') and queue_private.google_identity_binding(p_user) is null then
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
 if v_old.role='CASHIER' and (p_role<>'CASHIER' or not p_enabled) and exists(
  select 1 from queue_private.staff_counter_assignments x
  join queue_private.tickets t on t.counter_id=x.counter_id where x.account_id=p_user and t.status='CALLED'
 ) then raise exception 'Resolve called tickets before changing cashier'; end if;
 update queue_private.accounts set role=p_role::queue_private.app_role,enabled=p_enabled,updated_at=clock_timestamp()
 where id=p_user;
 if p_role<>'CASHIER' or not p_enabled then
  delete from queue_private.staff_counter_assignments where account_id=p_user;
 end if;
 v_result:=jsonb_build_object('user',p_user,'role',p_role,'enabled',p_enabled);
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_admin.id,'ACCOUNT',v_args||jsonb_build_object('previous_role',v_old.role,'previous_enabled',v_old.enabled));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(v_admin.id,p_request_key,'ACCOUNT',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

create or replace function queue_private.claim_pending_staff()
returns void language plpgsql security definer set search_path = '' as $$
declare
 v_actor queue_private.accounts; v_email text; v_invitation queue_private.pending_staff_assignments;
begin
 select pg_catalog.lower(u.email) into v_email from auth.users u
 where u.id=auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  and queue_private.google_identity_binding(u.id) is not null;
 if v_email is null or not exists(select 1 from queue_private.pending_staff_assignments
  where email=v_email and claimed_at is null and canceled_at is null) then return; end if;
 perform 1 from queue_private.settings where id for update;
 select a.* into v_actor from queue_private.accounts a join auth.users u on u.id=a.id
 where a.id=auth.uid() and a.enabled and a.role='STUDENT'
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  and queue_private.google_identity_binding(a.id) is not null for update of a;
 if v_actor.id is null or v_actor.role<>'STUDENT' or not v_actor.enabled
  or exists(select 1 from queue_private.staff_counter_assignments where account_id=v_actor.id)
  or exists(select 1 from queue_private.tickets where owner_id=v_actor.id and status in ('WAITING','CALLED')) then return; end if;
 select * into v_invitation from queue_private.pending_staff_assignments
 where email=v_email and claimed_at is null and canceled_at is null for update;
 if v_invitation.id is null then return; end if;
 perform queue_private.assert_staff_route(v_invitation.role,v_invitation.counter_id);
 perform queue_private.lock_staff_assignment_changes();
 update queue_private.pending_staff_assignments set claimed_by=v_actor.id,claimed_at=clock_timestamp(),
  updated_at=clock_timestamp() where id=v_invitation.id;
 update queue_private.accounts set role=v_invitation.role::queue_private.app_role,updated_at=clock_timestamp()
 where id=v_actor.id;
 if v_invitation.role='CASHIER' then
  insert into queue_private.staff_counter_assignments(account_id,counter_id)
  values(v_actor.id,v_invitation.counter_id);
 end if;
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_actor.id,'CLAIM_PENDING_STAFF',jsonb_build_object(
  'invitation',v_invitation.id,'role',v_invitation.role,'counter',v_invitation.counter_id));
end $$;
revoke all on function queue_private.claim_pending_staff()
 from public,anon,authenticated,service_role;
grant execute on function queue_private.claim_pending_staff() to postgres;

notify pgrst,'reload schema';
commit;
