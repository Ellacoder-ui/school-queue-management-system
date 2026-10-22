-- Isolated Cashier Dashboard Test
-- Tests against the isolated PostgreSQL instance (supabase-db-test:57322)
-- Does NOT touch the retained database (supabase_db_school-queue-local:54322)

-- Step 1: Set the authenticated actor to the cashier UUID
SELECT set_config('request.jwt.claims', '{"sub": "fb272286-05cf-44a8-84a6-6b807ee973ad", "role": "authenticated"}', false);

-- Verify auth.uid() returns the cashier UUID
SELECT 'Test 1: Auth UUID check' AS test_case;
SELECT auth.uid() AS actor_uuid;

-- Step 2: ADMIN can read staff directory
SELECT 'TEST 2: ADMIN can read staff directory' AS test_case;
SELECT queue_api.admin_staff_accounts() IS NOT NULL AS admin_can_access_staff_directory;

-- Step 3: STUDENT cannot access admin_staff_accounts (should fail with 42501)
SELECT set_config('request.jwt.claims', '{"sub": "c463ec84-4366-4b1c-b616-17dcec4b92f5", "role": "authenticated"}', false);
SELECT 'TEST 3: STUDENT cannot access admin_staff_accounts' AS test_case;
SELECT queue_api.admin_staff_accounts() IS NOT NULL AS student_can_access_staff_directory;

-- Step 4: Cashier can call_next from Counter 1 (TP)
SELECT set_config('request.jwt.claims', '{"sub": "fb272286-05cf-44a8-84a6-6b807ee973ad", "role": "authenticated"}', false);
SELECT 'TEST 4: Cashier can call_next from Counter 1 (TP)' AS test_case;
SELECT queue_api.call_next('85d55adc-81c8-4862-a94d-53417c1b412b', 'd9869044-5a0f-4834-8efa-92afff69474a', gen_random_uuid());

-- Step 5: Verify ticket status changed from WAITING to CALLED
SELECT 'TEST 5: Verify ticket status after Call Next' AS test_case;
SELECT id, owner_id, service_id, status, counter_id FROM queue_private.tickets WHERE owner_id = 'c463ec84-4366-4b1c-b616-17dcec4b92f5';

-- Step 6: Cashier can finish_ticket (SERVE)
SELECT 'TEST 6: Cashier can finish_ticket (SERVE)' AS test_case;
SELECT queue_api.finish_ticket('144ac0c0-d7fd-4a76-8853-6a1f9e27c7bd', 'SERVE', gen_random_uuid());

-- Step 7: Verify ticket status changed to SERVED
SELECT 'TEST 7: Verify ticket status after SERVE' AS test_case;
SELECT id, owner_id, service_id, status, counter_id FROM queue_private.tickets WHERE owner_id = 'c463ec84-4366-4b1c-b616-17dcec4b92f5';

-- Step 8: STUDENT cannot call staff_queue() (should fail with 42501)
SELECT set_config('request.jwt.claims', '{"sub": "c463ec84-4366-4b1c-b616-17dcec4b92f5", "role": "authenticated"}', false);
SELECT 'TEST 8: STUDENT calling staff_queue() should fail with 42501' AS test_case;
SELECT queue_api.staff_queue();

-- Step 9: CASHIER cannot call_next on Counter 2 (not assigned)
SELECT set_config('request.jwt.claims', '{"sub": "fb272286-05cf-44a8-84a6-6b807ee973ad", "role": "authenticated"}', false);
SELECT 'TEST 9: Cashier calling next on Counter 2 (not assigned) should fail' AS test_case;
SELECT queue_api.call_next('f0311429-d8fc-48bb-a994-ee34d64e0eae', 'SOA', gen_random_uuid());