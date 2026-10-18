-- Read-only navigation contracts. No table, RLS, publication or existing grant changes.
begin;

-- Internal clock seam: the public wrapper supplies its own single captured instant.
-- No browser can execute this helper or provide a date/time override.
create function queue_private.public_context_at(p_instant timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select pg_catalog.jsonb_build_object(
   'timezone', s.timezone,
   'business_date', (p_instant at time zone s.timezone)::date,
   'queue_day_open', exists (
     select 1 from queue_private.queue_days d
     where d.business_date = (p_instant at time zone s.timezone)::date
       and d.closed_at is null
   ),
   'services', (
     select coalesce(pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_object('code', v.code, 'name', v.name) order by v.code
     ), '[]'::jsonb)
     from queue_private.services v where v.enabled
   )
 ) from queue_private.settings s where s.id;
$$;

create function queue_display.public_queue_context() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 v_result := queue_private.public_context_at(pg_catalog.clock_timestamp());
 if v_result is null then
   raise exception 'Queue context unavailable' using errcode = '55000';
 end if;
 return v_result;
end;
$$;
comment on function queue_display.public_queue_context() is
 'Anonymous-safe enabled service catalog and current institution-local day. No arguments. False open status means absent or formally closed day, independent of counter availability.';

create function queue_api.my_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role queue_private.app_role; v_enabled boolean; v_counters jsonb;
begin
 -- JWT subject establishes identity only. Roles/enabled state come from the DB.
 select a.role, a.enabled into v_role, v_enabled
 from queue_private.accounts a join auth.users u on u.id = a.id
 where a.id = auth.uid() and not coalesce(u.is_anonymous, false);
 if not found then
   raise exception 'Authenticated account required' using errcode = '42501';
 end if;
 -- Deliberate exception to protected-read denial: let a disabled caller render
 -- an access-disabled page. Mask its role and assignments; grant no operations.
 if not v_enabled then
   return pg_catalog.jsonb_build_object('role', null, 'enabled', false, 'cashier_counters', '[]'::jsonb);
 end if;
 v_counters := '[]'::jsonb;
 if v_role = 'CASHIER'::queue_private.app_role then
   select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'counter_id', c.id,
     'counter_number', c.number,
     'counter_label', c.label,
     'is_open', c.is_open,
     'service_codes', (
       select coalesce(pg_catalog.jsonb_agg(s.code order by s.code), '[]'::jsonb)
       from queue_private.counter_services cs join queue_private.services s on s.id = cs.service_id
       where cs.counter_id = c.id and s.enabled
     )
   ) order by c.number), '[]'::jsonb) into v_counters
   from queue_private.staff_counter_assignments x
   join queue_private.counters c on c.id = x.counter_id
   where x.account_id = auth.uid();
 end if;
 return pg_catalog.jsonb_build_object('role', v_role::text, 'enabled', true, 'cashier_counters', v_counters);
end;
$$;
comment on function queue_api.my_context() is
 'Caller-only current DB authorization context. Disabled: role=null, enabled=false, cashier_counters=[]. Missing or anonymous-Auth identity: 42501. Closed assigned counters are included with is_open=false; this read is not operation authorization.';

revoke all on function queue_private.public_context_at(timestamptz),
 queue_api.my_context(),queue_display.public_queue_context()
 from public,anon,authenticated,service_role;
grant execute on function queue_api.my_context() to authenticated;
grant execute on function queue_display.public_queue_context() to anon,authenticated;
-- In particular, anonymous users still have no USAGE on queue_api/queue_private.
notify pgrst,'reload schema';
commit;
