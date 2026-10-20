-- PROPOSED ONLY. Not in migrations/: separate approval is required for retained use.
-- No account is promoted and no approval is seeded by applying this.
-- This prepares minimal functions for staff directory and review requests.
-- Test against isolated PostgreSQL/PostgREST before retained application.
begin;

-- 1. Staff review requests table (minimal, for pending email-based requests)
create table if not exists queue_private.staff_review_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  requested_role queue_private.app_role not null check (requested_role in ('CASHIER','ADMIN')),
  status text not null default 'PENDING_IDENTITY_REVIEW' check (status in ('PENDING_IDENTITY_REVIEW','BOUND_REVIEW_REQUIRED','EXPIRED','REVOKED')),
  bound_user uuid references queue_private.accounts(id),
  identity_sha256 text check (identity_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by uuid not null references queue_private.accounts(id),
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > requested_at and expires_at <= requested_at + interval '30 days')
);
alter table queue_private.staff_review_requests enable row level security;
revoke all on queue_private.staff_review_requests from public,anon,authenticated,service_role;

-- 2. Admin staff directory (read-only, returns verified accounts with emails)
-- Only ADMIN can call. Returns account UUID, Google email, role, enabled, verified MFA factor count.
create or replace function queue_api.admin_staff_directory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
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
revoke all on function queue_api.admin_staff_directory() from public,anon,authenticated,service_role;
grant execute on function queue_api.admin_staff_directory() to authenticated;

-- 3. Request staff access (creates pending review request)
create or replace function queue_api.request_staff_access(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
  v_request_id uuid;
begin
  -- Require ADMIN role
  select id into v_admin from queue_private.accounts where id = auth.uid() and role = 'ADMIN' and enabled;
  if v_admin is null then raise exception 'Administrator required' using errcode='42501'; end if;

  -- Validate inputs
  if p_email is null or p_email <> lower(p_email) or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Invalid email' using errcode='22023';
  end if;
  if p_role is null or p_role not in ('CASHIER','ADMIN') then
    raise exception 'Invalid role' using errcode='22023';
  end if;

  -- Check for existing pending request
  if exists(select 1 from queue_private.staff_review_requests where email = p_email and status = 'PENDING_IDENTITY_REVIEW' and expires_at > clock_timestamp()) then
    raise exception 'Pending review request already exists for this email' using errcode='22023';
  end if;

  -- Create pending request (does NOT create account, approval, or role)
  insert into queue_private.staff_review_requests (email, requested_role, requested_by, expires_at)
  values (p_email, p_role::queue_private.app_role, v_admin, clock_timestamp() + interval '7 days')
  returning id into v_request_id;

  -- Audit
  insert into queue_private.admin_audit_events (actor_id, action, parameters)
  values (v_admin, 'STAFF_REVIEW_REQUEST', jsonb_build_object('request_id', v_request_id, 'email', p_email, 'role', p_role));

  return jsonb_build_object('request_id', v_request_id, 'status', 'PENDING_IDENTITY_REVIEW');
end $$;
revoke all on function queue_api.request_staff_access(text,text) from public,anon,authenticated,service_role;
grant execute on function queue_api.request_staff_access(text,text) to authenticated;

notify pgrst,'reload schema';
commit;