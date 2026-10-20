-- PROPOSED ONLY: apply to an isolated fixture, never to retained PostgreSQL without approval.
-- Adds capabilities; changes no existing function, role, identity or assignment.
begin;
create function queue_private.admin_google_binding_v10(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('user',u.id,'identity',i.id,
 'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub',
 'email',lower(u.email),'verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex')
 from auth.users u join auth.identities i on i.user_id=u.id and i.provider='google'
 where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is not true
 and lower(i.identity_data->>'email')=lower(u.email) and i.identity_data->>'email_verified'='true'
 and nullif(i.identity_data->>'sub','')=i.provider_id
 and (select count(*) from auth.identities x where x.user_id=u.id and x.provider='google')=1
$$;

create function queue_api.admin_staff_accounts() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- Reuse installed authorization (including stronger wrappers if 007 is later installed).
 perform queue_api.admin_configuration();
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'email',u.email,'role',a.role,
 'enabled',a.enabled,'google_verified',queue_private.admin_google_binding_v10(a.id) is not null)
 order by lower(u.email),a.id) from queue_private.accounts a join auth.users u on u.id=a.id
 where a.role in ('ADMIN','CASHIER')),'[]'::jsonb);
end $$;

create function queue_api.resolve_staff_google(p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; n integer;
begin
 perform queue_api.admin_configuration();
 if p_email is null or length(p_email)>254 or btrim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 then raise exception 'Invalid email' using errcode='22023'; end if;
 select count(*),(array_agg(a.id))[1] into n,target from queue_private.accounts a
 join auth.users u on u.id=a.id where lower(u.email)=lower(btrim(p_email));
 if n<>1 or queue_private.admin_google_binding_v10(target) is null then return null; end if;
 return (select jsonb_build_object('id',a.id,'email',lower(u.email),'role',a.role,'enabled',a.enabled,
 'identity_sha256',queue_private.admin_google_binding_v10(a.id),'counter_ids',coalesce((select jsonb_agg(x.counter_id order by x.counter_id)
 from queue_private.staff_counter_assignments x where x.account_id=a.id),'[]'::jsonb))
 from queue_private.accounts a join auth.users u on u.id=a.id where a.id=target);
end $$;

create function queue_api.add_verified_staff(p_user uuid,p_email text,p_identity_sha256 text,
 p_role text,p_counter uuid,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a queue_private.accounts; args jsonb; result jsonb; target jsonb; c queue_private.counters;
 cashiers uuid[];
begin
 a:=queue_private.lock_actor();
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

create function queue_api.admin_payors(p_search text default '',p_service text default null,p_date date default null,
 p_status text default null,p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb; more boolean;
begin
 perform queue_api.admin_configuration();
 if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit not between 1 and 50
 or p_search is null or length(p_search)>100 or (p_status is not null and p_status not in ('WAITING','CALLED','SERVED','FORFEITED'))
 or (p_service is not null and p_service not in ('TP','SOA','PNEP','REF','ADJ'))
 then raise exception 'Invalid payor filters' using errcode='22023'; end if;
 with page as (
 select t.id,t.owner_id,t.sequence_number,t.status,t.issued_at,s.code,d.business_date,
 (select e.counter_id from queue_private.ticket_events e where e.ticket_id=t.id and e.counter_id is not null
 order by e.occurred_at desc,e.id desc limit 1) last_counter,
 sp.student_number,case when sp.verified_at is not null then sp.display_name end display_name
 from queue_private.tickets t join queue_private.accounts a on a.id=t.owner_id and a.role='STUDENT'
 join queue_private.services s on s.id=t.service_id join queue_private.queue_days d on d.id=t.queue_day_id
 left join queue_private.student_profiles sp on sp.account_id=t.owner_id and sp.verified_at is not null
 where (p_date is null or d.business_date=p_date) and (p_service is null or s.code=p_service)
 and (p_status is null or t.status::text=p_status)
 and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',t.owner_id::text,sp.student_number,
 sp.display_name,s.code||'-'||lpad(t.sequence_number::text,greatest(3,length(t.sequence_number::text)),'0'))))>0)
 order by t.issued_at desc,t.id desc offset p_offset limit p_limit+1
 ), numbered as (select *,row_number() over(order by issued_at desc,id desc) rn from page)
 select coalesce(jsonb_agg(jsonb_build_object('ticket_id',id,'owner_id',owner_id,'number',sequence_number,'service',code,
 'status',status,'business_date',business_date,'issued_at',issued_at,'counter_id',last_counter,
 'student_number',student_number,'display_name',display_name) order by rn) filter(where rn<=p_limit),'[]'::jsonb),
 count(*)>p_limit into rows,more from numbered;
 return jsonb_build_object('rows',rows,'more',more,'offset',p_offset,'limit',p_limit);
end $$;

create function queue_api.admin_payor_events(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform queue_api.admin_configuration();
 if not exists(select 1 from queue_private.tickets t join queue_private.accounts a on a.id=t.owner_id
 where t.id=p_ticket and a.role='STUDENT') then raise exception 'Payor ticket unavailable' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('event',e.event_type,'at',e.occurred_at,
 'status',e.to_status,'counter_id',e.counter_id) order by e.occurred_at,e.id)
 from (select * from queue_private.ticket_events where ticket_id=p_ticket order by occurred_at desc,id desc limit 100) e),'[]'::jsonb);
end $$;
revoke all on function queue_private.admin_google_binding_v10(uuid) from public,anon,authenticated,service_role;
revoke all on function queue_api.admin_staff_accounts(),queue_api.resolve_staff_google(text),
 queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid),queue_api.admin_payors(text,text,date,text,integer,integer),
 queue_api.admin_payor_events(uuid) from public,anon,authenticated,service_role;
grant execute on function queue_api.admin_staff_accounts(),queue_api.resolve_staff_google(text),
 queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid),queue_api.admin_payors(text,text,date,text,integer,integer),
 queue_api.admin_payor_events(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
