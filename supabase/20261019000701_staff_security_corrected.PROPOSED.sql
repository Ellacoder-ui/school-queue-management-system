-- PROPOSED ONLY. Not in migrations/: separate approval is required for retained use.
-- Corrected version of 20261019000700_staff_security.PROPOSED.sql
-- Fixes: admin_staff_directory() and request_staff_access() now call admin_configuration()
--        to inherit migration 007's MFA/AAL2/operator-approval security gates.
-- No internal BEGIN/COMMIT — caller must wrap in a guarded transaction.
-- Original 007 checksum: b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c
-- No internal BEGIN/COMMIT - caller must wrap in a guarded transaction.

create table queue_private.staff_access_approvals (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references queue_private.accounts(id),
 staff_role queue_private.app_role not null check (staff_role in ('ADMIN','CASHIER')),
 identity_sha256 text not null check (identity_sha256 ~ '^[0-9a-f]{64}$'),
 approval_reference text not null unique check (length(btrim(approval_reference)) between 1 and 200),
 approved_by name not null,
 approved_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 check (expires_at > approved_at and expires_at <= approved_at + interval '30 days')
);
alter table queue_private.staff_access_approvals enable row level security;
revoke all on queue_private.staff_access_approvals from public,anon,authenticated,service_role;

create function queue_private.google_staff_binding(p_user uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_hash text;
begin
 select encode(sha256(convert_to(jsonb_build_object(
  'user_id',u.id,'identity_id',i.id,'provider',i.provider,'provider_id',i.provider_id,
  'subject',i.identity_data->>'sub','email',lower(u.email),
  'identity_email',lower(i.identity_data->>'email'),
  'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex') into v_hash
 from auth.users u join auth.identities i on i.user_id=u.id and i.provider='google'
 where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is not true
 and lower(i.identity_data->>'email')=lower(u.email)
 and i.identity_data->>'email_verified'='true'
 and nullif(i.identity_data->>'sub','')=i.provider_id
 and (select count(*) from auth.identities x where x.user_id=u.id and x.provider='google')=1;
 if v_hash is null then raise exception 'Verified Google identity required' using errcode='42501'; end if;
 return v_hash;
end $$;

create function queue_private.require_staff_approval(p_user uuid,p_role text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
 if p_user is null or p_role not in ('ADMIN','CASHIER') or not exists (
  select 1 from queue_private.staff_access_approvals a
  where a.account_id=p_user and a.staff_role::text=p_role and a.revoked_at is null
  and a.expires_at>statement_timestamp()
  and a.identity_sha256=queue_private.google_staff_binding(p_user)
 ) then raise exception 'Current operator staff approval required' using errcode='42501'; end if;
end $$;

create function queue_private.require_staff_mfa(p_role text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
 if coalesce(auth.jwt()->>'aal','') <> 'aal2' or not exists (
  select 1 from queue_private.accounts where id=auth.uid() and enabled and role::text=p_role
 ) or not exists (
  select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'
 ) then raise exception 'Authorized staff and AAL2 required' using errcode='42501'; end if;
 perform queue_private.require_staff_approval(auth.uid(),p_role);
end $$;

create function queue_private.review_staff_access(p_user uuid,p_expected_email text,
 p_identity_sha256 text,p_role text,p_reference text,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if session_user <> 'postgres' or current_setting('role') not in ('none','postgres') then
  raise exception 'Direct database operator required' using errcode='42501'; end if;
 perform 1 from queue_private.settings where id for update;
 if p_user is null or p_role is null or p_role not in ('ADMIN','CASHIER')
 or p_identity_sha256 is null or p_reference is null or p_expires_at is null
 or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '30 days'
 or not exists(select 1 from auth.users u join queue_private.accounts a on a.id=u.id
  where u.id=p_user and lower(u.email)=lower(p_expected_email) and a.enabled)
 then raise exception 'Invalid staff review binding' using errcode='22023'; end if;
 if queue_private.google_staff_binding(p_user) is distinct from p_identity_sha256 then
  raise exception 'Staff identity binding changed' using errcode='42501'; end if;
 if exists(select 1 from queue_private.staff_access_approvals where account_id=p_user
  and staff_role::text=p_role and revoked_at is null and expires_at>clock_timestamp()) then
  raise exception 'Staff approval already active' using errcode='22023'; end if;
 insert into queue_private.staff_access_approvals(account_id,staff_role,identity_sha256,
  approval_reference,approved_by,expires_at)
 values(p_user,p_role::queue_private.app_role,p_identity_sha256,p_reference,session_user,p_expires_at)
 returning id into v_id;
 return v_id;
end $$;

create function queue_private.revoke_staff_review(p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if session_user <> 'postgres' or current_setting('role') not in ('none','postgres') then
  raise exception 'Direct database operator required' using errcode='42501'; end if;
 perform 1 from queue_private.settings where id for update;
 update queue_private.staff_access_approvals set revoked_at=clock_timestamp()
 where approval_reference=p_reference and revoked_at is null;
 if not found then raise exception 'Active approval not found' using errcode='22023'; end if;
end $$;

create function queue_private.promote_approved_admin(p_user uuid,p_expected_email text,
 p_expected_role text,p_identity_sha256 text,p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account queue_private.accounts;
begin
 if session_user <> 'postgres' or current_setting('role') not in ('none','postgres') then
  raise exception 'Direct database operator required' using errcode='42501'; end if;
 perform 1 from queue_private.settings where id for update;
 select * into v_account from queue_private.accounts where id=p_user for update;
 if p_expected_role is distinct from 'STUDENT' or v_account.id is null
 or v_account.role::text is distinct from p_expected_role or not v_account.enabled
 or not exists(select 1 from auth.users where id=p_user and lower(email)=lower(p_expected_email))
 then raise exception 'Target account state changed' using errcode='42501'; end if;
 if p_identity_sha256 is null or queue_private.google_staff_binding(p_user) is distinct from p_identity_sha256
 then raise exception 'Staff identity binding changed' using errcode='42501'; end if;
 perform queue_private.require_staff_approval(p_user,'ADMIN');
 if not exists(select 1 from auth.mfa_factors where user_id=p_user and status='verified') then
  raise exception 'Verified MFA enrollment required before promotion' using errcode='42501'; end if;
 if not exists(select 1 from queue_private.staff_access_approvals where account_id=p_user
  and staff_role='ADMIN' and approval_reference=p_reference and identity_sha256=p_identity_sha256
  and revoked_at is null and expires_at>clock_timestamp()) then
  raise exception 'Exact operator review required' using errcode='42501'; end if;
 if exists(select 1 from queue_private.tickets where owner_id=p_user and status in ('WAITING','CALLED'))
 or exists(select 1 from queue_private.staff_counter_assignments where account_id=p_user) then
  raise exception 'Resolve target work or assignments first' using errcode='42501'; end if;
 update queue_private.accounts set role='ADMIN',updated_at=clock_timestamp() where id=p_user;
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(p_user,'OPERATOR_ADMIN_PROMOTION',jsonb_build_object('actor_kind','DATABASE_OPERATOR',
  'operator',session_user,'target',p_user,'previous_role',p_expected_role,
  'identity_sha256',p_identity_sha256,'approval_reference',p_reference));
 return jsonb_build_object('user',p_user,'role','ADMIN','enabled',true);
end $$;

revoke all on function queue_private.google_staff_binding(uuid),
 queue_private.require_staff_approval(uuid,text),queue_private.require_staff_mfa(text),
 queue_private.review_staff_access(uuid,text,text,text,text,timestamptz),
 queue_private.revoke_staff_review(text),
 queue_private.promote_approved_admin(uuid,text,text,text,text)
 from public,anon,authenticated,service_role;

-- API wrappers: retain reviewed 001-006 implementations as private cores.
-- Authorization always precedes the old replay path, including idempotent replays.
alter function queue_api.admin_configuration() rename to admin_configuration_core007;
alter function queue_api.admin_configuration_core007() set schema queue_private;
revoke all on function queue_private.admin_configuration_core007() from public,anon,authenticated,service_role;
create function queue_api.admin_configuration() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN');
 return queue_private.admin_configuration_core007();
end $$;
revoke all on function queue_api.admin_configuration() from public,anon,authenticated,service_role;
grant execute on function queue_api.admin_configuration() to authenticated;

alter function queue_api.set_account(uuid,text,boolean,uuid) rename to set_account_core007;
alter function queue_api.set_account_core007(uuid,text,boolean,uuid) set schema queue_private;
revoke all on function queue_private.set_account_core007(uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
create function queue_api.set_account(p_user uuid,p_role text,p_enabled boolean,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN'); if p_enabled and p_role in ('ADMIN','CASHIER') then perform queue_private.require_staff_approval(p_user,p_role); end if;
 return queue_private.set_account_core007(p_user,p_role,p_enabled,p_request_key);
end $$;
revoke all on function queue_api.set_account(uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.set_account(uuid,text,boolean,uuid) to authenticated;

alter function queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid) rename to configure_counter_core007;
alter function queue_api.configure_counter_core007(uuid,boolean,text[],uuid[],uuid) set schema queue_private;
revoke all on function queue_private.configure_counter_core007(uuid,boolean,text[],uuid[],uuid) from public,anon,authenticated,service_role;
create function queue_api.configure_counter(p_counter uuid,p_open boolean,p_services text[],p_cashiers uuid[],p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN'); perform queue_private.require_staff_approval(x,'CASHIER') from unnest(p_cashiers) x;
 return queue_private.configure_counter_core007(p_counter,p_open,p_services,p_cashiers,p_request_key);
end $$;
revoke all on function queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.configure_counter(uuid,boolean,text[],uuid[],uuid) to authenticated;

alter function queue_api.configure_service(text,text,boolean,uuid) rename to configure_service_core007;
alter function queue_api.configure_service_core007(text,text,boolean,uuid) set schema queue_private;
revoke all on function queue_private.configure_service_core007(text,text,boolean,uuid) from public,anon,authenticated,service_role;
create function queue_api.configure_service(p_code text,p_name text,p_enabled boolean,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN');
 return queue_private.configure_service_core007(p_code,p_name,p_enabled,p_request_key);
end $$;
revoke all on function queue_api.configure_service(text,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.configure_service(text,text,boolean,uuid) to authenticated;

alter function queue_api.manage_day(text,date,uuid) rename to manage_day_core007;
alter function queue_api.manage_day_core007(text,date,uuid) set schema queue_private;
revoke all on function queue_private.manage_day_core007(text,date,uuid) from public,anon,authenticated,service_role;
create function queue_api.manage_day(p_action text,p_date date,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN');
 return queue_private.manage_day_core007(p_action,p_date,p_request_key);
end $$;
revoke all on function queue_api.manage_day(text,date,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.manage_day(text,date,uuid) to authenticated;

alter function queue_api.call_next(uuid,text,uuid) rename to call_next_core007;
alter function queue_api.call_next_core007(uuid,text,uuid) set schema queue_private;
revoke all on function queue_private.call_next_core007(uuid,text,uuid) from public,anon,authenticated,service_role;
create function queue_api.call_next(p_counter uuid,p_service text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('CASHIER');
 return queue_private.call_next_core007(p_counter,p_service,p_request_key);
end $$;
revoke all on function queue_api.call_next(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.call_next(uuid,text,uuid) to authenticated;

alter function queue_api.finish_ticket(uuid,text,uuid) rename to finish_ticket_core007;
alter function queue_api.finish_ticket_core007(uuid,text,uuid) set schema queue_private;
revoke all on function queue_private.finish_ticket_core007(uuid,text,uuid) from public,anon,authenticated,service_role;
create function queue_api.finish_ticket(p_ticket uuid,p_action text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('CASHIER');
 return queue_private.finish_ticket_core007(p_ticket,p_action,p_request_key);
end $$;
revoke all on function queue_api.finish_ticket(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.finish_ticket(uuid,text,uuid) to authenticated;

alter function queue_api.staff_queue() rename to staff_queue_core007;
alter function queue_api.staff_queue_core007() set schema queue_private;
revoke all on function queue_private.staff_queue_core007() from public,anon,authenticated,service_role;
create function queue_api.staff_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa((select role::text from queue_private.accounts where id=auth.uid() and enabled));
 return queue_private.staff_queue_core007();
end $$;
revoke all on function queue_api.staff_queue() from public,anon,authenticated,service_role;
grant execute on function queue_api.staff_queue() to authenticated;

comment on table queue_private.staff_access_approvals is 'Operator-only, expiring, Google identity-bound staff review. No browser writes. Existing staff fail closed until reviewed.';

-- FIX: Close legacy endpoint gaps — make admin_staff_directory and request_staff_access
-- call admin_configuration() to inherit 007's MFA/AAL2/operator-approval security gates.
-- These functions were created in migration 009 and do not call admin_configuration(),
-- so they bypass migration 007's security wrappers.

create or replace function queue_api.admin_staff_directory() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform queue_api.admin_configuration();  -- inherits 007 MFA/AAL2/approval gates
  if not exists(select 1 from queue_private.accounts where id=auth.uid() and role='ADMIN' and enabled) then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'email', u.email,
      'role', a.role,
      'enabled', a.enabled,
      'verified_factors', (select count(*) from auth.mfa_factors f where f.user_id = a.id and f.status = 'verified'),
      'google_identity', (select count(*) from auth.identities i where i.user_id = a.id and i.provider = 'google')
    ) order by a.id)
    from queue_private.accounts a
    join auth.users u on u.id = a.id
  ), '[]'::jsonb);
end $$;

create or replace function queue_api.request_staff_access(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid;
  v_request_id uuid;
begin
  perform queue_api.admin_configuration();  -- inherits 007 MFA/AAL2/approval gates
  select id into v_admin from queue_private.accounts where id = auth.uid() and role = 'ADMIN' and enabled;
  if v_admin is null then raise exception 'Administrator required' using errcode='42501'; end if;

  if p_email is null or p_email <> lower(p_email) or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Invalid email' using errcode='22023';
  end if;
  if p_role is null or p_role not in ('CASHIER','ADMIN') then
    raise exception 'Invalid role' using errcode='22023';
  end if;

  if exists(select 1 from queue_private.staff_review_requests where email = p_email and status = 'PENDING_IDENTITY_REVIEW' and expires_at > clock_timestamp()) then
    raise exception 'Pending review request already exists for this email' using errcode='22023';
  end if;

  insert into queue_private.staff_review_requests (email, requested_role, requested_by, expires_at)
  values (p_email, p_role::queue_private.app_role, v_admin, clock_timestamp() + interval '7 days')
  returning id into v_request_id;

  insert into queue_private.admin_audit_events (actor_id, action, parameters)
  values (v_admin, 'STAFF_REVIEW_REQUEST', jsonb_build_object('request_id', v_request_id, 'email', p_email, 'role', p_role));

  return jsonb_build_object('request_id', v_request_id, 'status', 'PENDING_IDENTITY_REVIEW');
end $$;

revoke all on function queue_private.admin_google_binding_v10(uuid) from public,anon,authenticated,service_role;
revoke all on function queue_api.admin_staff_directory() from public,anon,authenticated,service_role;
revoke all on function queue_api.request_staff_access(text,text) from public,anon,authenticated,service_role;
grant execute on function queue_api.admin_staff_directory() to authenticated;
grant execute on function queue_api.request_staff_access(text,text) to authenticated;

notify pgrst,'reload schema';