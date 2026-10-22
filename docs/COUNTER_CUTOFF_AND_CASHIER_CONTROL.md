# Cashier Counter Controls and Ticket Cutoffs

Migrations `20261020000700_counter_controls_and_issuance_cutoffs.sql` and `20261021000800_persist_service_cutoff_decisions.sql` add cashier-operated shared counter state and database-enforced ticket-admission windows. They follow fixed routing migration `20261016000600_fixed_counter_routing.sql` and are installed on the retained local database.

## Counter control

An authenticated cashier can call `queue_api.set_counter_open(p_counter, p_open, p_request_key)` only for a counter assigned to that cashier. The change serializes with existing queue mutations, uses the existing operation-request idempotency table, writes an audit event, and refreshes the existing public display projection. All cashiers assigned to the same counter see and control the same counter-level open state. Opening is rejected at or after 5:00 PM Manila time.

## Admission windows

The ticket RPC and the public service context share the database function `queue_private.ticket_issuance_status`. Its order is:

1. At or after 5:00 PM Asia/Manila, return `AFTER_HOURS`.
2. A disabled/missing service returns `SERVICE_UNAVAILABLE`; a closed counter returns `COUNTER_CLOSED`.
3. At 4:30 PM, the scheduled server job counts tickets in `WAITING` or `CALLED` for each service and stores the count and cutoff decision in `queue_private.service_day_cutoffs`. The count is reconstructed from ticket events as of the 4:30 PM boundary, so a later serve/skip or a retry cannot change the saved decision. Ten or more returns `QUEUE_CUTOFF`; fewer than ten remains eligible through 4:59:59 PM.
4. If the cutoff row is not yet present after 4:30 PM, the server-side evaluation runs under the same database mutation lock before the public context or an issuance request proceeds. It reconstructs the 4:30 PM state from event history and inserts the decision only once.
5. Otherwise, return `OPEN`.

The cutoff count is anchored to the ticket event history at 4:30 PM, so tickets admitted after 4:30 PM do not change the already-defined snapshot. The RPC remains the enforcement boundary; the student UI uses the public context status only for timely explanations and disabled controls.

The migrations install two `pg_cron` jobs using the project's verified `cron.timezone=GMT` setting: evaluate and publish the persistent cutoff decision at 4:30 PM Manila time (08:30 GMT), and close all counters at 5:00 PM Manila time (09:00 GMT). The issuance RPC independently rejects after-hours requests even if a scheduler run is delayed. The close routine serializes with queue operations and updates the existing public display projection; it does not reopen counters the next day or delete, serve, skip, or forfeit tickets.

## Registered Google staff activation

Migration `20261021000900_secure_google_staff_activation.sql` installed the initial scoped staff RPCs. The follow-up `20261021001000_owner_authorized_staff_management.sql` replaces their AAL2/TOTP and operator-approval requirements with an enabled-ADMIN check bound to the configured owner UUID and the verified Google identity hash captured at migration time. It also applies that owner check to account role changes and cashier-assignment changes; unrelated admin actions retain their existing authorization. The owner cannot be demoted or disabled, new staff roles require a verified Google binding, CASHIER activation and counter assignment remain atomic, and existing audit/idempotency records are retained.

The owner-authorized staff-management migration was approved and applied to the retained database. Its owner-only staff mutations remain enabled.

Migration `20261021001100_owner_email_staff_assignments.sql` adds a separate pending-first-login flow. The owner can assign an existing account immediately only when its verified Google identity matches the normalized email; otherwise, an email with no Auth account is stored as a private pending assignment. A verified Google login claims a matching pending assignment inside `my_context()` using the server-derived Auth UUID and verified provider identity. Owner-only controls can edit or cancel pending assignments. Existing Auth accounts without a verified Google identity, active queue tickets, prior counter assignments, duplicate invitations, and non-owner mutations are rejected. Its SHA-256 is `388CC914E33EBA16B7B8B02459BC2397A6B9ED9E9BEC6C9598D300C8144699ED`. This migration was tested on the disposable database, then applied to the retained database after verifying the target cluster, checksum, dependencies, authorization, and data-preservation fingerprint. It introduced no pending assignments at install time. The frontend `PENDING_STAFF_ASSIGNMENTS_RELEASED` flag is enabled; the designated owner can add staff by email without a Google-account lookup. Pending staff receive the role after a matching verified Google first sign-in.

## UI and live updates

The cashier dashboard's Open/Close Counter control is a confirmed RPC operation. Cashier and student dashboards reuse the existing public Realtime projection inline; the administrator already has its live-counter panel. Embedded views omit the separate display refresh control. Queue data continues to update from the existing Realtime subscription and recovery path, preserving dashboard search, selection, and checklist state.

Migration `20261022001300_serialize_counter_operations.sql` adds per-counter row locks to `call_next`, cashier counter toggles, and ADMIN counter configuration. This prevents two assigned cashiers from claiming separate tickets concurrently, rejects manual counter closure while a ticket is CALLED, and applies the same 5:00 PM Manila opening guard to ADMIN configuration. The migration and `counter_operation_guards_test.sql` were applied/run only on disposable cluster `7698728238191685666`; they have not been applied to the retained cluster and require separate approval before deployment.

## Verification

`supabase/tests/database/daily_cutoff_test.sql` covers the 4:30 PM 9/10/11 active-ticket snapshot, persistence after later ticket completion, below-threshold issuance, after-hours refusal, shared cashier counter state, unauthorized cashier denial, cron registration, and scheduled closure. `supabase/tests/database/counter_operation_guards_test.sql` covers shared-counter exclusion, active-call closure rejection, permissions, and deterministic Manila-time opening boundaries; its fixtures roll back. `supabase/tests/database/staff_activation_test.sql` verifies the earlier AAL2/TOTP-gated workflow and rejection of mismatched identities. Migration 011 was validated on the disposable cluster for owner-only creation, duplicate prevention, edit/cancel, verified first-login claiming, exact counter binding, and direct activation of a verified existing account; all test writes rolled back. On the retained cluster, migration 011 is installed and its frontend workflow is enabled. Frontend tests cover the owner-only email form, pending assignment receipt/list refresh, and duplicate rejection.
