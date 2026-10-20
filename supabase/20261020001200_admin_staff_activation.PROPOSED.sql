-- PROPOSED ONLY: requires separate retained approval; not installed by this task.
-- One new mutation, depending on the five already installed 011 read-only functions.
-- Caller must use one guarded transaction; no internal BEGIN/COMMIT.
-- Reuses installed set_account/configure_counter authorization, auditing and 007
-- wrappers. Requires reviewed 007 security, current approved ADMIN, signed AAL2
-- and verified TOTP. Without 007 this mutation refuses; it never weakens gates.
-- No role changes occur when this definition is installed.
create function queue_api.add_verified_staff(p_user uuid,p_email text,p_identity_sha256 text,
 p_role text,p_counter uuid,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a queue_private.accounts; args jsonb; result jsonb; target jsonb; c queue_private.counters;
 cashiers uuid[];
begin
 a:=queue_private.lock_actor();
 if to_regprocedure('queue_private.require_staff_mfa(text)') is null
 or to_regprocedure('queue_private.require_staff_approval(uuid,text)') is null
 then raise exception 'Staff security installation required' using errcode='42501'; end if;
 perform queue_api.admin_configuration();
 if a.role<>'ADMIN' or coalesce(auth.jwt()->>'aal','')<>'aal2' or not exists
 (select 1 from auth.mfa_factors where user_id=a.id and status='verified' and factor_type='totp')
 then raise exception 'Verified administrator AAL2 required' using errcode='42501'; end if;
 if p_user=a.id then raise exception 'Cannot change own staff access' using errcode='42501'; end if;
 if p_role is null or p_role not in ('ADMIN','CASHIER') or (p_role='CASHIER')<>(p_counter is not null)
 then raise exception 'Invalid staff settings' using errcode='22023'; end if;
 args:=jsonb_build_object('user',p_user,'email',p_email,'identity_sha256',p_identity_sha256,'role',p_role,'counter',p_counter);
 -- Current actor authorization always precedes replay. A receipt is not current state.
 result:=queue_private.replay(a.id,p_request_key,'ADD_VERIFIED_STAFF',args);
 if result is not null then return result; end if;
 -- Lock trusted identity rows against concurrent identity changes through Auth.
 -- FOR UPDATE also conflicts with the parent key-share lock required by an
 -- identity insert, so a second Google identity cannot race this binding check.
 perform 1 from auth.users where id=p_user for update;
 perform 1 from auth.identities where user_id=p_user for share;
 target:=queue_api.resolve_staff_google(p_email);
 if target is null or target->>'id' is distinct from p_user::text
 or target->>'identity_sha256' is distinct from p_identity_sha256
 or target->>'enabled'<>'true' then raise exception 'Verified account changed' using errcode='42501'; end if;
 if target->>'role'<>'STUDENT' or jsonb_array_length(target->'counter_ids')<>0
 then raise exception 'Use existing staff management' using errcode='22023'; end if;
 if p_role='CASHIER' then
  select * into c from queue_private.counters where id=p_counter;
  if c.id is null then raise exception 'Invalid counter' using errcode='22023'; end if;
 end if;
 -- One transaction: any counter failure rolls back role, audits and all child receipts.
 perform queue_api.set_account(p_user,p_role,true,gen_random_uuid());
 if p_role='CASHIER' then
  select array_agg(id order by id) into cashiers from (select account_id id from queue_private.staff_counter_assignments
  where counter_id=p_counter union select p_user) x;
  perform queue_api.configure_counter(p_counter,c.is_open,array[queue_private.fixed_service_code(c.number)],cashiers,gen_random_uuid());
 end if;
 result:=jsonb_build_object('user',p_user,'role',p_role,'enabled',true,'counter',p_counter);
 insert into queue_private.admin_audit_events(actor_id,action,parameters) values(a.id,'ADD_VERIFIED_STAFF',args);
 insert into queue_private.operation_requests values(a.id,p_request_key,'ADD_VERIFIED_STAFF',args,result,clock_timestamp());
 return result;
end $$;
revoke all on function queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
