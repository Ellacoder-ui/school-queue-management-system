-- REVIEW PROPOSAL ONLY. Depends on the separately approved 007 proposal.
-- No Auth user, staff approval, role or assignment is seeded. No email is sent.
begin;

create table queue_private.staff_access_requests (
 id uuid primary key default gen_random_uuid(),
 email text not null check (email=lower(btrim(email)) and length(email)<=254),
 requested_role queue_private.app_role not null check(requested_role in ('ADMIN','CASHIER')),
 requested_by uuid not null references queue_private.accounts(id),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
 bound_user uuid references queue_private.accounts(id),
 identity_sha256 text check(identity_sha256 ~ '^[0-9a-f]{64}$'),
 bound_by name,
 bound_at timestamptz,
 revoked_at timestamptz,
 check ((bound_user is null)=(identity_sha256 is null)),
 check ((bound_user is null)=(bound_at is null))
);
alter table queue_private.staff_access_requests enable row level security;
revoke all on queue_private.staff_access_requests from public,anon,authenticated,service_role;

-- A confirmed Google identity is asserted from server-owned records, never metadata roles.
create function queue_private.verified_staff_directory()
returns table(account_id uuid,email text,identity_sha256 text)
language sql stable security definer set search_path='' as $$
 select u.id,lower(u.email),queue_private.google_staff_binding(u.id)
 from auth.users u join auth.identities i on i.user_id=u.id and i.provider='google'
 where u.email_confirmed_at is not null and u.is_anonymous is not true
 and lower(u.email)=lower(i.identity_data->>'email')
 and i.identity_data->>'email_verified'='true' and nullif(i.identity_data->>'sub','')=i.provider_id
 and (select count(*) from auth.identities x where x.user_id=u.id and x.provider='google')=1
$$;
revoke all on function queue_private.verified_staff_directory() from public,anon,authenticated,service_role;

create function queue_api.admin_workspace(p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_config jsonb; v_result jsonb;
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN');
 if p_date is null then raise exception 'Explicit report date required' using errcode='22023'; end if;
 if (select count(*) from queue_private.accounts)>500 then
  raise exception 'Directory requires paginated operator review' using errcode='54000'; end if;
 v_config := queue_private.admin_configuration_core007();
 select jsonb_build_object('version',8,'date',p_date,'configuration',v_config,
  'directory',coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'email',d.email,'identity_sha256',d.identity_sha256,'role',a.role,'enabled',a.enabled,
    'verified_factors',(select count(*) from auth.mfa_factors f where f.user_id=a.id and f.status='verified'),
    'approvals',coalesce((select jsonb_agg(jsonb_build_object('role',r.staff_role,'expires_at',r.expires_at) order by r.expires_at)
      from queue_private.staff_access_approvals r where r.account_id=a.id and r.revoked_at is null
      and r.expires_at>statement_timestamp() and r.identity_sha256=d.identity_sha256),'[]')) order by a.id)
    from queue_private.accounts a left join queue_private.verified_staff_directory() d on d.account_id=a.id),'[]'),
  'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'email',r.email,'role',r.requested_role,
    'created_at',r.created_at,'expires_at',r.expires_at,'bound_user',r.bound_user,
    'status',case when r.revoked_at is not null then 'REVOKED' when r.expires_at<=statement_timestamp() then 'EXPIRED'
      when r.bound_user is not null then 'BOUND_REVIEW_REQUIRED' else 'PENDING_IDENTITY_REVIEW' end) order by r.created_at desc)
    from (select * from queue_private.staff_access_requests order by created_at desc limit 100) r),'[]'),
  'metrics',(select jsonb_build_object('total',count(*),'waiting',count(*) filter(where t.status='WAITING'),
    'called',count(*) filter(where t.status='CALLED'),'served',count(*) filter(where t.status='SERVED'),
    'forfeited',count(*) filter(where t.status='FORFEITED')) from queue_private.tickets t
    join queue_private.queue_days d on d.id=t.queue_day_id where d.business_date=p_date),
  'usage',(select jsonb_agg(jsonb_build_object('service',s.code,'total',(select count(*) from queue_private.tickets t
    join queue_private.queue_days d on d.id=t.queue_day_id where t.service_id=s.id and d.business_date=p_date)) order by s.code)
    from queue_private.services s),
  'history',coalesce((select jsonb_agg(row order by row->>'issued_at',row->>'ticket_id') from (
    select jsonb_build_object('ticket_id',t.id,'service',s.code,'number',t.sequence_number,'status',t.status,
      'business_date',d.business_date,'counter_id',t.counter_id,'issued_at',t.issued_at) row
    from queue_private.tickets t join queue_private.services s on s.id=t.service_id
    join queue_private.queue_days d on d.id=t.queue_day_id where d.business_date=p_date
    order by t.issued_at,t.id limit 500) h),'[]'),
  'history_more',(select count(*)>500 from queue_private.tickets t join queue_private.queue_days d on d.id=t.queue_day_id where d.business_date=p_date)) into v_result;
 return v_result;
end $$;
revoke all on function queue_api.admin_workspace(date) from public,anon,authenticated,service_role;
grant execute on function queue_api.admin_workspace(date) to authenticated;

create function queue_api.request_staff_access(p_email text,p_role text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(btrim(p_email)); v_args jsonb; v_result jsonb; v_id uuid;
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN');
 if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or p_role is null or p_role not in ('ADMIN','CASHIER') then raise exception 'Invalid staff request' using errcode='22023'; end if;
 v_args:=jsonb_build_object('email',v_email,'role',p_role);
 v_result:=queue_private.replay(auth.uid(),p_request_key,'STAFF_REQUEST',v_args);
 if v_result is not null then return v_result; end if;
 if exists(select 1 from queue_private.staff_access_requests where email=v_email and requested_role::text=p_role
   and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'Staff request already pending' using errcode='22023'; end if;
 insert into queue_private.staff_access_requests(email,requested_role,requested_by)
 values(v_email,p_role::queue_private.app_role,auth.uid()) returning id into v_id;
 v_result:=jsonb_build_object('request_id',v_id,'status','PENDING_IDENTITY_REVIEW');
 insert into queue_private.operation_requests values(auth.uid(),p_request_key,'STAFF_REQUEST',v_args,v_result,clock_timestamp());
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(auth.uid(),'STAFF_REQUEST',jsonb_build_object('request_id',v_id,'requested_role',p_role));
 return v_result;
end $$;
revoke all on function queue_api.request_staff_access(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.request_staff_access(text,text,uuid) to authenticated;

-- Pending email is an intent only. This operator step binds an actual existing identity.
-- It does NOT grant a role or replace review_staff_access / AAL2 requirements.
create function queue_private.bind_staff_request(p_request uuid,p_user uuid,p_email text,p_identity_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
declare r queue_private.staff_access_requests;
begin
 if session_user<>'postgres' or current_setting('role') not in ('none','postgres') then
  raise exception 'Direct database operator required' using errcode='42501'; end if;
 perform 1 from queue_private.settings where id for update;
 select * into r from queue_private.staff_access_requests where id=p_request for update;
 if r.id is null or r.bound_user is not null or r.revoked_at is not null or r.expires_at<=clock_timestamp()
 or r.email is distinct from lower(p_email) or not exists(select 1 from queue_private.accounts where id=p_user and enabled)
 or not exists(select 1 from auth.users where id=p_user and lower(email)=r.email)
 or queue_private.google_staff_binding(p_user) is distinct from p_identity_sha256 then
  raise exception 'Pending request identity mismatch' using errcode='42501'; end if;
 update queue_private.staff_access_requests set bound_user=p_user,identity_sha256=p_identity_sha256,
   bound_by=session_user,bound_at=clock_timestamp() where id=p_request;
end $$;
revoke all on function queue_private.bind_staff_request(uuid,uuid,text,text) from public,anon,authenticated,service_role;

-- Preserve 007 authorization and original audit/replay rules; prevent removing the
-- only usable approved administrator while other legacy ADMIN rows remain enabled.
alter function queue_api.set_account(uuid,text,boolean,uuid) rename to set_account_guarded007;
alter function queue_api.set_account_guarded007(uuid,text,boolean,uuid) set schema queue_private;
revoke all on function queue_private.set_account_guarded007(uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
create function queue_api.set_account(p_user uuid,p_role text,p_enabled boolean,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from queue_private.settings where id for update;
 perform queue_private.require_staff_mfa('ADMIN');
 if p_user=auth.uid() then raise exception 'Self authorization changes require operator review' using errcode='42501'; end if;
 if exists(select 1 from queue_private.accounts where id=p_user and role='ADMIN' and enabled)
 and (not p_enabled or p_role<>'ADMIN') and not exists(
   select 1 from queue_private.accounts a join queue_private.verified_staff_directory() d on d.account_id=a.id
   join queue_private.staff_access_approvals r on r.account_id=a.id and r.staff_role='ADMIN' and r.identity_sha256=d.identity_sha256
   where a.id<>p_user and a.enabled and a.role='ADMIN' and r.revoked_at is null and r.expires_at>statement_timestamp()
   and exists(select 1 from auth.mfa_factors f where f.user_id=a.id and f.status='verified')) then
  raise exception 'Cannot remove last approved administrator' using errcode='42501'; end if;
 return queue_private.set_account_guarded007(p_user,p_role,p_enabled,p_request_key);
end $$;
revoke all on function queue_api.set_account(uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.set_account(uuid,text,boolean,uuid) to authenticated;

comment on table queue_private.staff_access_requests is 'Pending intent only. No Auth account, operator approval, staff privilege or email delivery is created.';
notify pgrst,'reload schema';
commit;
