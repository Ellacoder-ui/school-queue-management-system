begin;

-- Preserve provenance of historical ticket events before deleting synthetic actors.
alter table queue_private.ticket_events
  add column if not exists archived_actor_id uuid;

update queue_private.ticket_events
  set archived_actor_id = actor_id
  where actor_id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );

update queue_private.ticket_events
  set actor_id = null
  where actor_id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );

-- Remove idempotency replay entries (not historical audit).
delete from queue_private.operation_requests
  where actor_id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );

-- Release counter assignments.
delete from queue_private.staff_counter_assignments
  where account_id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );

-- Delete synthetic accounts.
delete from queue_private.accounts
  where id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );

-- Delete Supabase Auth records.
delete from auth.identities
  where user_id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );
delete from auth.users
  where id in (
    '3c08ca87-d1d4-47f9-aba4-132016f63a52'::uuid,
    '92a2d664-763f-4696-9119-c051743e1ea6'::uuid
  );

select pg_notify('pgrst','reload schema');
commit;