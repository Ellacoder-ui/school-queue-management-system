begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create function queue_api.remove_ineligible_counter_assignment(
 p_counter uuid,p_user uuid,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_admin queue_private.accounts;
 v_role text;
 v_enabled boolean;
 v_args jsonb;
 v_result jsonb;
begin
 v_admin:=queue_private.require_staff_activation_admin();
 v_admin:=queue_private.lock_actor();
 if p_counter is null or p_user is null or p_request_key is null then
  raise exception 'Counter, account and request key are required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(782410992031::bigint);

 v_args:=jsonb_build_object('counter',p_counter,'user',p_user);
 v_result:=queue_private.replay(v_admin.id,p_request_key,'INELIGIBLE_COUNTER_ASSIGNMENT',v_args);
 if v_result is not null then return v_result; end if;

 select a.role::text,a.enabled into v_role,v_enabled
 from queue_private.accounts a where a.id=p_user for update;
 if v_role is null then raise exception 'Account not found' using errcode='22023'; end if;
 if v_role='CASHIER' and v_enabled then
  raise exception 'An enabled CASHIER assignment cannot be removed by this operation' using errcode='42501';
 end if;

 delete from queue_private.staff_counter_assignments
 where counter_id=p_counter and account_id=p_user;
 if not found then
  raise exception 'Ineligible counter assignment not found' using errcode='22023';
 end if;

 v_result:=jsonb_build_object(
  'counter',p_counter,'user',p_user,'role',v_role,'enabled',v_enabled,'removed',true
 );
 insert into queue_private.admin_audit_events(actor_id,action,parameters)
 values(v_admin.id,'REMOVE_INELIGIBLE_COUNTER_ASSIGNMENT',v_args||jsonb_build_object('role',v_role,'enabled',v_enabled));
 insert into queue_private.operation_requests(actor_id,request_key,operation,parameters,result,created_at)
 values(v_admin.id,p_request_key,'INELIGIBLE_COUNTER_ASSIGNMENT',v_args,v_result,clock_timestamp());
 return v_result;
end $$;

comment on function queue_api.remove_ineligible_counter_assignment(uuid,uuid,uuid) is
 'Owner-only removal of one counter assignment belonging to a non-CASHIER or disabled account; never changes account roles or tickets.';
revoke all on function queue_api.remove_ineligible_counter_assignment(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_api.remove_ineligible_counter_assignment(uuid,uuid,uuid)
 to authenticated;

notify pgrst,'reload schema';
commit;
