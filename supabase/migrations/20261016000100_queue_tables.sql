-- Local proposal only. Requires a Supabase PostgreSQL database.
begin;
create schema queue_private;
create schema queue_api;
create schema queue_display;
revoke all on schema queue_private, queue_api, queue_display from public, anon, authenticated, service_role;
grant usage on schema queue_api to authenticated;
grant usage on schema queue_display to anon, authenticated;
alter default privileges in schema queue_private revoke execute on functions from public;
alter default privileges in schema queue_api revoke execute on functions from public;

create type queue_private.app_role as enum ('STUDENT','CASHIER','ADMIN');
create type queue_private.ticket_status as enum ('WAITING','CALLED','SERVED','FORFEITED');
-- Singleton row is also the transaction mutex. All mutations lock it first.
create table queue_private.settings (
 id boolean primary key default true check (id),
 timezone text not null default 'Asia/Manila' check (timezone = 'Asia/Manila'),
 last_wait_position bigint not null default 0 check (last_wait_position >= 0)
);
create table queue_private.accounts (
 id uuid primary key references auth.users(id) on delete restrict,
 role queue_private.app_role not null default 'STUDENT',
 enabled boolean not null default true,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table queue_private.student_profiles (
 account_id uuid primary key references queue_private.accounts(id),
 student_number text not null unique check (length(btrim(student_number)) > 0),
 display_name text not null,
 verified_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create table queue_private.services (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code in ('TP','SOA','PNEP','REF','ADJ')),
 name text not null check (length(btrim(name)) > 0),
 enabled boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);
create table queue_private.counters (
 id uuid primary key default gen_random_uuid(),
 number smallint not null unique check (number between 1 and 5),
 label text not null,
 is_open boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
create table queue_private.counter_services (
 counter_id uuid not null references queue_private.counters(id),
 service_id uuid not null references queue_private.services(id),
 primary key(counter_id,service_id)
);
create table queue_private.staff_counter_assignments (
 account_id uuid not null references queue_private.accounts(id),
 counter_id uuid not null references queue_private.counters(id),
 primary key(account_id,counter_id)
);
create table queue_private.queue_days (
 id uuid primary key default gen_random_uuid(),
 business_date date not null unique,
 timezone_snapshot text not null check (timezone_snapshot = 'Asia/Manila'),
 opened_at timestamptz not null default clock_timestamp(),
 closed_at timestamptz,
 closed_by uuid references queue_private.accounts(id),
 check ((closed_at is null) = (closed_by is null))
);
create table queue_private.service_day_state (
 queue_day_id uuid not null references queue_private.queue_days(id),
 service_id uuid not null references queue_private.services(id),
 last_number bigint not null default 0 check (last_number >= 0),
 primary key(queue_day_id,service_id)
);
create table queue_private.tickets (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references queue_private.accounts(id),
 queue_day_id uuid not null,
 service_id uuid not null,
 sequence_number bigint not null check (sequence_number > 0),
 wait_position bigint not null check (wait_position > 0),
 status queue_private.ticket_status not null default 'WAITING',
 counter_id uuid,
 issued_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 served_at timestamptz,
 forfeited_at timestamptz,
 foreign key(queue_day_id,service_id) references queue_private.service_day_state(queue_day_id,service_id),
 foreign key(counter_id,service_id) references queue_private.counter_services(counter_id,service_id),
 unique(queue_day_id,service_id,sequence_number),
 check ((status = 'CALLED') = (counter_id is not null)),
 check ((status = 'SERVED') = (served_at is not null)),
 check ((status = 'FORFEITED') = (forfeited_at is not null))
);
create unique index one_active_ticket on queue_private.tickets(owner_id) where status in ('WAITING','CALLED');
create unique index one_called_per_counter on queue_private.tickets(counter_id) where status = 'CALLED';
create unique index unique_wait_position on queue_private.tickets(wait_position);
create index waiting_selection on queue_private.tickets(service_id,queue_day_id,wait_position) where status = 'WAITING';
create index owner_history on queue_private.tickets(owner_id,issued_at desc);
create index served_quota on queue_private.tickets(owner_id,queue_day_id,service_id) where status = 'SERVED';
create index assigned_counter on queue_private.staff_counter_assignments(counter_id);
create table queue_private.ticket_events (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references queue_private.tickets(id),
 actor_id uuid references queue_private.accounts(id),
 event_type text not null check (event_type in ('ISSUED','CALLED','SKIPPED','SERVED','FORFEITED')),
 from_status queue_private.ticket_status,
 to_status queue_private.ticket_status not null,
 counter_id uuid references queue_private.counters(id),
 occurred_at timestamptz not null default clock_timestamp()
);
create index ticket_event_history on queue_private.ticket_events(ticket_id,occurred_at,id);
create table queue_private.operation_requests (
 actor_id uuid not null references queue_private.accounts(id),
 request_key uuid not null,
 operation text not null,
 parameters jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_key)
);
create table queue_private.admin_audit_events (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid references queue_private.accounts(id),
 action text not null,
 parameters jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
-- Display rows have independent IDs and no user identifiers.
create table queue_display.counter_state (
 counter_id uuid primary key,
 counter_label text not null,
 is_open boolean not null,
 ticket_label text,
 service_code text,
 business_date date,
 updated_at timestamptz not null default clock_timestamp()
);
create table queue_display.service_state (
 service_code text not null,
 business_date date not null,
 waiting_count bigint not null check (waiting_count >= 0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(service_code,business_date)
);
do $$ declare r record; begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('queue_private','queue_display') loop
  execute format('alter table %I.%I enable row level security',r.schemaname,r.tablename);
 end loop;
end $$;
-- Private tables intentionally have no browser policies/grants: default deny.
create policy public_counter_read on queue_display.counter_state for select to anon,authenticated using (true);
create policy public_service_read on queue_display.service_state for select to anon,authenticated using (true);
grant select on queue_display.counter_state,queue_display.service_state to anon,authenticated;
revoke all on all tables in schema queue_private from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate,references,trigger on all tables in schema queue_display from public,anon,authenticated,service_role;
commit;
