# Local Google Sign-In activation result

October 19, 2026 (UTC+08). **PASS — Google is enabled and Auth-only activation is
verified.** One approved activation ran; no retry or rollback was performed.
Real Google login and identity changes have **not** been tested or authorized here.

## Activation and health

Run **e17c030c** began at **10:40:19**; final independent read-only verification
completed at **10:41:52**. The helper measured **14.674 seconds** from its change
stage through acceptance. Only **`supabase_auth_school-queue-local`** was recreated,
using the same cached Auth **2.197.0** image.

| Required check | Result |
| --- | --- |
| Replacement Auth | Running, healthy, restart count **0** |
| Auth health through Kong | **HTTP 200** |
| Auth settings through Kong | **HTTP 200**, `external.google=true` |
| Anonymous public API read | **HTTP 200** |
| PostgreSQL identity/health | Healthy; PostgreSQL **17.11**, original cluster **7696959712798593061** and volume |
| Other services | All eleven other IDs/definitions preserved; no operator restart |

The replacement ID begins **565adceacab1**; the original ID begins **9f7742bf04e6**.
Full IDs are recorded in the evidence. Original Auth is stopped, network-detached
and retained as **`supabase_auth_school-queue-local-e17c030c-activation-original`**.
Exactly one replacement container was added; no network or volume changed.
Vector retains its existing unhealthy automatic restart loop and unchanged definition.

## Applied configuration and safeguards

Only the reviewed eight effective Auth environment entries changed: Google enabled,
private Client ID/Secret, Site URL, callback allowlist, provider redirect, and the two
Google validation flags. Effective URLs are:

- Frontend: `http://127.0.0.1:5173`
- Vue callback: `http://127.0.0.1:5173/auth/callback`
- Google redirect: `http://127.0.0.1:54321/auth/v1/callback`

Nonce skipping and optional email remain **false**. Signup remains enabled;
anonymous sign-in and manual linking remain disabled. JWT/signing keys, database
credentials, email/MFA settings, image, aliases and every unrelated definition
field matched the encrypted approved candidate exactly.

`supabase/config.toml` now mirrors the reviewed proposal using environment references
for the Client ID/Secret. Its SHA-256 is
`e4d5c0c91d449e21a72074660abb150057b6c846fa0aa54470a572a4669677e0`.
Credentials were read privately through the approved DPAPI bridge; the existing store
was not changed and its metadata matched. No secret was printed or put into Vite,
command arguments or plaintext project files.

Protected original/candidate configuration, source baseline and journals remain in
**`.local-auth-only/e17c030c/`**, including `review/payload.dpapi` and
`activation/payload.dpapi`. Rollback requires separate approval of its exact plan,
replacement ID and rollback hash. The original container was not deleted. Its project
labels remain intact; future cleanup/full-stack operations need explicit accounting.

## Database, application and work preservation

Fresh preflight verified the tested helper code, exact project/container/network,
disabled provider, protected original read-back, approved delta/hash and prior
application/Auth rows, roles and function definitions. Postactivation comparison
passed the **unchanged** strict within-run source policy with no unexpected changes.

- **39 accounts, 39 Auth users, 26 identities**; roles and counter assignments unchanged.
- **20 tickets, 57 events, 69 replay receipts, 32 audits, seven closed days and four
  assignments**; zero active tickets or open day.
- All **six application migrations/file hashes**, **82 existing Auth migration
  receipts**, schema/security metadata and existing rows preserved.
- Fixed routing remains **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**. All 15 application
  tables retain RLS; browser roles lack private-schema USAGE; public projection and
  publication boundaries remain unchanged.
- All **93 existing backup files** retain digest
  `27e6ed58b1fe58031c3a953e2c95cd8d362e869735f598c84577673498905e96`.
- Of **636 pre-existing recorded inputs**, **635 retain their hashes**. Only the
  authorized `supabase/config.toml` changed. Existing modified/untracked frontend
  work, helpers, migrations and historical reports/evidence were preserved.

No database reset, application migration, role promotion, queue operation, backup/
volume deletion, Vector repair, deployment, Git commit or push occurred.
Historical recovery findings are unchanged; this is not a new recovery certification.

## Readiness for real login testing

**Ready for separately approved, user-controlled real Google login tests.** Provider
availability is verified; Google credential acceptance, consent, school Workspace
policy, PKCE callback/session behavior and identity provisioning/linking remain untested.
The next approval must cover the intended personal/school test accounts and possible
Auth identity/session/application-account writes. No such login was performed here.

Roles remain database-authoritative: new ordinary users default to STUDENT; domains
and Google metadata grant no ADMIN/CASHIER access. The previously documented staff
AAL2/approval enforcement gaps remain; sensitive staff management stays disabled.
Activation does not resolve those gaps or certify privileged production readiness.

Evidence: [fresh plan review](../supabase/tests/results/auth_only_activation_review_e17c030c.json),
[approved plan receipt](../supabase/tests/results/auth_only_final_plan_e17c030c.json),
[activation and independent verification](../supabase/tests/results/auth_only_activation_result_e17c030c.json).
Final verification evidence SHA-256:
`02ed32a8d1dc012996f630295a104057040d0d24e496ff38abc76f863696d108`.

**Stopped after activation verification and reporting. Awaiting separate approval
before real Google login or any authentication identity change.**
