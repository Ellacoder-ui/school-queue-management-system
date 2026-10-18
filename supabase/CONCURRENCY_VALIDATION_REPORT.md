# Engineering report: local concurrency validation

Date: October 16, 2026. Result: PASS for the exercised scenarios.

## Execution evidence

- Target: **127.0.0.1:54322**, database `postgres`.
- Local PostgreSQL server: **17.11**; psql client: **18.6**.
- Supabase CLI: **2.121.0**; Python: **3.14.6**.
- Before testing: four applied migrations, five services, five counters, zero
  accounts, tickets, and queue days. The database was suitable for the committed fixtures.
- Command: `python supabase/tests/run_local_concurrency.py`.
- **3 concurrency tests passed; 0 failed; 0 errors; 0 skipped.**
- Test-method duration reported by unittest: **2.186 seconds**.
- Six additional offline structural checks passed; both Python files parsed successfully.
- The user's earlier successful migration application, local lint, and 35 pgTAP
  assertions were not rerun during this task. They are prior validation evidence.

## Scenarios verified

| Scenario | Observed result |
| --- | --- |
| Eight overlapping issuance requests with the same key | One ticket, identical replay results |
| Four competing requests while that owner has an active ticket | All rejected specifically for existing active ticket |
| Request key reused with a different service | Rejected with SQLSTATE 22023 and expected parameter-mismatch message |
| Two counters compete for one waiting ticket | Exactly one counter receives that ticket |
| Eight service-completion retries with one key | Identical replay results; one completed ticket |
| Eight distinct completion requests for a called ticket | Exactly one succeeds; seven reject the terminal ticket |
| Eight requests after two served tickets for that owner/service/day | All reject specifically for the served-ticket limit |
| Eight concurrent skip retries | One SKIPPED event; identical responses; original ticket number preserved |
| Skipped ticket versus another waiting ticket | Skipped ticket moves behind the existing waiter |
| Skipped ticket subsequently served | Skip consumes zero served quota; eventual service counts once |
| Eight different owners issue SOA tickets concurrently | Unique contiguous daily numbers 1 through 8 |
| Closure competes with a cashier call | No active tickets or stale public current-ticket labels remain |

Real PostgreSQL connections execute application actions as `authenticated` with
test JWT subject claims. Trusted postgres sessions create fixtures and inspect
results; application policies and function grants are not weakened.

The tests use multiple psql processes and eight-worker batches. They validate the
observed interleavings, not every possible schedule or sustained production load.

## Read-only postflight

Command: `python supabase/tests/run_local_concurrency.py --postflight`.

| Check | Result |
| --- | --- |
| Total fixture accounts | 13 |
| Total tickets | 12 |
| Served tickets | 4 |
| Forfeited tickets | 8 |
| Active tickets | 0 |
| Skip events | 1 |
| Duplicate daily ticket numbers | 0 |
| Numbering gaps within tested day/services | 0 |
| Served quota violations | 0 |
| Duplicate SERVED events for a ticket | 0 |
| Open queue days | 0 |
| Public current-ticket labels | 0 |

## Harness failures found and corrected

1. **Windows executable resolution:** psql is installed outside PATH. The local
   launcher now uses its absolute path for preflight and supplies PATH to the
   Python test subprocess. The first preflight stopped before SQL execution.
2. **Connection configuration:** the old runner assigned the entire URL to
   PGDATABASE without explicitly setting PGPORT. A preflight attempt timed out.
   Both scripts now specify host/address 127.0.0.1, port 54322, database, user,
   and local authentication separately, and use `psql -w` to prevent prompts.
   PostgreSQL documents these as distinct connection defaults:
   [libpq environment variables](https://www.postgresql.org/docs/current/libpq-envars.html).
3. **False-positive rejection assertions:** the old parallel helper treated any
   database error as an expected rejection. It now accepts only the expected
   SQLSTATE/message for each rejection scenario and propagates unexpected failures.
4. **Local isolation:** inherited PG settings are discarded, the URI must specify
   the exact local endpoint, query overrides are rejected, and default password-file
   use is disabled. The wrapper discards inherited Supabase credential settings.
5. **Missing skip concurrency coverage:** added a third test for concurrent skip
   retries, event count, number preservation, tail order, and eventual service.

No queue race condition, duplicate allocation, unexpected SQL error, or quota
violation was observed in the successful run. The preflight failures were harness
issues; they occurred before fixture creation. No migration fix was needed.

## Files changed

- `supabase/tests/concurrency.py`: connection isolation, explicit libpq parameters,
  precise rejection assertions, fresh-state guard, skip coverage, fail-fast execution.
- `supabase/tests/run_local_concurrency.py`: new credential-safe local-status wrapper,
  read-only preflight and postflight, executable resolution, and test invocation.
- `supabase/CONCURRENCY_VALIDATION_REPORT.md`: this report.
- `supabase/ENGINEERING_REPORT.md`: historical-status note linking to this validation.

No migration SQL, RLS policy, application role grant, frontend file, .env file,
package dependency, or system installation was changed during this task.

## Data preservation and safety

Credentials were obtained from local CLI status into process memory, never printed
or saved. The hosted project was not connected to and no production credentials
were supplied. No database was reset, no fixtures were deleted, no migrations were
deployed, and no Git commit or push was performed.

The fixture accounts, role assignments, tickets, audit events, and closed queue day
remain in the local database. The local wrapper now refuses another full run over
that state. Do not remove data or reopen the day to force a rerun. Arrange a fresh
disposable instance or explicitly approve another isolation strategy first.

## Readiness and next steps

The database is ready for the **next local validation phase**, not production
approval. Recommended next checks:

1. End-to-end Data API and Realtime checks with real anonymous, student, cashier,
   and administrator sessions, including revoked roles and cross-user access.
2. Deterministic contention tests for midnight rollover, different-key first
   issuance by the same user, and assignment/role changes during cashier operations.
3. Lock-timeout, disconnect/retry, and sustained-load measurements for the singleton
   mutation lock. The current suite is a small correctness test, not a load benchmark.
4. Resolve remaining enrollment verification, administrator MFA, and operational
   business-rule decisions before production review.

Any future hosted migration application or deployment requires separate approval.
