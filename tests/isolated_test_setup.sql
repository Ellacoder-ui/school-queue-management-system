-- Isolated test database setup for Cashier Dashboard testing
-- Creates synthetic accounts, counter assignments, and test tickets
-- All data is isolated in a separate PostgreSQL instance

DO $$
DECLARE
  admin_id uuid;
  cashier_id uuid;
  student_id uuid;
  queue_day_id uuid;
  service_tp_id uuid;
BEGIN
  -- Create synthetic ADMIN account
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token, email_change
  ) VALUES (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'ADMIN', 'admin.test@test.invalid', crypt('password123', gen_salt('bf')),
    clock_timestamp(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Test Admin", "user_name": "testadmin"}'::jsonb,
    clock_timestamp(), clock_timestamp(),
    encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex'),
    encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex')
  ) RETURNING id INTO admin_id;

  UPDATE queue_private.accounts SET role = 'ADMIN', enabled = true WHERE id = admin_id;

  -- Create synthetic CASHIER account
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token, email_change
  ) VALUES (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'CASHIER', 'cashier.counter1@test.invalid', crypt('password123', gen_salt('bf')),
    clock_timestamp(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Test Cashier Counter 1", "user_name": "testcashier1"}'::jsonb,
    clock_timestamp(), clock_timestamp(),
    encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex'),
    encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex')
  ) RETURNING id INTO cashier_id;

  UPDATE queue_private.accounts SET role = 'CASHIER', enabled = true WHERE id = cashier_id;

  -- Assign cashier to Counter 1 (TP)
  INSERT INTO queue_private.staff_counter_assignments (account_id, counter_id)
  VALUES (cashier_id, (SELECT id FROM queue_private.counters WHERE number = 1));

  -- Create synthetic STUDENT account
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token, email_change
  ) VALUES (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
    'STUDENT', 'student.test@test.invalid', crypt('password123', gen_salt('bf')),
    clock_timestamp(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Test Student", "user_name": "teststudent"}'::jsonb,
    clock_timestamp(), clock_timestamp(),
    encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex'),
    encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex')
  ) RETURNING id INTO student_id;

  UPDATE queue_private.accounts SET role = 'STUDENT', enabled = true WHERE id = student_id;

  -- Create queue day
  INSERT INTO queue_private.queue_days (business_date, timezone_snapshot, opened_at)
  VALUES ((clock_timestamp() AT TIME ZONE 'Asia/Manila')::date, 'Asia/Manila', clock_timestamp())
  RETURNING id INTO queue_day_id;

  -- Get TP service ID
  SELECT id INTO service_tp_id FROM queue_private.services WHERE code = 'TP';

  -- Create service_day_state for TP service
  INSERT INTO queue_private.service_day_state (queue_day_id, service_id, last_number)
  VALUES (queue_day_id, service_tp_id, 0);

  -- Create synthetic tickets
  INSERT INTO queue_private.tickets (
    owner_id, queue_day_id, service_id, sequence_number, wait_position, status, issued_at
  )
  SELECT
    student_id, queue_day_id, service_tp_id, 1, 1, 'WAITING', clock_timestamp() - interval '10 minutes'
  FROM queue_private.queue_days d
  WHERE d.business_date = (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date;

  -- Add ticket events
  INSERT INTO queue_private.ticket_events (ticket_id, actor_id, event_type, from_status, to_status, occurred_at)
  SELECT
    t.id, t.owner_id, 'ISSUED', NULL, 'WAITING', t.issued_at
  FROM queue_private.tickets t
  WHERE t.owner_id = student_id AND t.status = 'WAITING';

  RAISE NOTICE 'Setup complete: admin_id=%, cashier_id=%, student_id=%', admin_id, cashier_id, student_id;
END $$;