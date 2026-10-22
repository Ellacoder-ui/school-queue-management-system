-- One-time fixture preparation for the disposable cluster at port 57322 only.
-- Do not run this against the retained local or production database.
do $$
begin
 if (select system_identifier::text from pg_control_system())<>'7698728238191685666' then
  raise exception 'Refusing fixture setup: disposable cluster identifier mismatch';
 end if;
 if exists(select 1 from queue_private.accounts where id='5c96debb-697f-4cad-805f-92b518e28343') then
  raise exception 'Unexpected pre-existing owner fixture in disposable database';
 end if;
end $$;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists is_anonymous boolean not null default false;
create table if not exists auth.identities(
 id uuid primary key default gen_random_uuid(),
 provider_id text not null,
 user_id uuid not null references auth.users(id),
 identity_data jsonb not null,
 provider text not null,
 last_sign_in_at timestamptz,
 created_at timestamptz default clock_timestamp(),
 updated_at timestamptz default clock_timestamp(),
 email text
);

insert into auth.users(id,email,email_confirmed_at,is_anonymous)
values('5c96debb-697f-4cad-805f-92b518e28343',
 'owner-fixture@staff-test.invalid',clock_timestamp(),false);
update queue_private.accounts
set role='ADMIN',enabled=true
where id='5c96debb-697f-4cad-805f-92b518e28343';
insert into auth.identities(provider_id,user_id,identity_data,provider,email)
values('fixture-google-owner','5c96debb-697f-4cad-805f-92b518e28343',
 jsonb_build_object('sub','fixture-google-owner','email','owner-fixture@staff-test.invalid','email_verified','true'),
 'google','owner-fixture@staff-test.invalid');
