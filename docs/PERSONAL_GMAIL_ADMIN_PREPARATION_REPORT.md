# Personal Gmail ADMIN preparation and MFA activation result

October 19, 2026 (UTC+08). **MFA activation: FAIL at preflight; NOT EXECUTED.**
The approved plan was still within its expiry, but `CheckPlan` rejected changed
retained source state. No activation retry or rollback ran. A replacement plan is
prepared and checked, awaiting separate approval. **Both reviewed accounts remain
enabled STUDENT; no real MFA enrollment, migration or promotion occurred.**

## Activation stop and current health

The required command against approved run `0f6aaa88`, SHA-256
`08e5e9587e570d07afbec2f66f796e3aa2238f1dd8838759312dee89ac778d4a`, returned
`FAIL_STOPPED / AMF_READ_ONLY_GUARD_REJECTED`. It was checked before its October 19,
18:13:05 UTC+08 expiry. Protected review/code/configuration validation passed before
the live guard refused the source comparison. No activation-attempt journal exists.

Compared with that plan's capture:

- Auth users/application accounts increased **41 → 42**, Google identities **28 → 29**,
  and Auth audit rows **135 → 138**. Every one of the original 41 account rows,
  41 Auth-user rows and 28 identity rows remains an exact fingerprint match.
- One session, refresh-token and AMR row fingerprint changed; their counts remain 36.
  Auth refresh allocation and scoped Realtime subscription state also changed.
  The observations do not independently identify the actor or time of those effects.
  The additional retained account/identity was already present at the initial diagnosis;
  this task issued no retained identity/account write.
- Other table fingerprints, catalog, schema/security, cluster roles, privileges,
  routing and ancillary metadata matched. No table was added or removed. Credentials,
  database volume, service definitions and non-Vector lifecycles matched.

These differences preserve the old plan's **FAIL**. They were not whitelisted or
rewritten as a passing historical comparison. Review the additional account/identity
before approving a plan bound to the current inventory.

| Current check | Result |
| --- | --- |
| Actual Auth service changed | **None** |
| Auth container | Original activated-Google ID `565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399`, healthy |
| Auth/settings through Kong | **HTTP 200**, Google enabled |
| Anonymous public API | **HTTP 200** |
| TOTP enrollment / verification flags | **false / false** |
| PostgreSQL | Original local cluster `7696959712798593061` / database volume |
| config.toml | Unchanged, SHA-256 `e4d5c0c91d449e21a72074660abb150057b6c846fa0aa54470a572a4669677e0` |

## Verified personal target; school excluded from promotion

Trusted loopback PostgreSQL transactions were repeatable-read/read-only. Verification
required a unique confirmed, nonanonymous user, matching application UUID, exactly one
Google identity, verified matching identity email and provider subject equal to its
provider ID. Editable browser metadata and email text alone grant no authority.

| Binding | Personal Gmail — future ADMIN target | School — remains STUDENT |
| --- | --- | --- |
| Email | `ellasharmaineabeso2004@gmail.com` | `eabeso63122@liceo.edu.ph` |
| Immutable Auth/application UUID | `5c96debb-697f-4cad-805f-92b518e28343` | `b7d9aee8-c54d-455f-9913-a4c4dea0d097` |
| Current role / enabled | **STUDENT / true** | **STUDENT / true** |
| Google identities | **1**, verified binding | **1**, original verified binding |
| MFA factors / verified factors | **0 / 0** | **0 / 0** |
| Staff assignments / active tickets / all tickets | **0 / 0 / 0** | **0 / 0 / 0** |

Personal identity-binding SHA-256:

`0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701`

School binding, unchanged:

`7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd`

Each hash uses the existing proposed 007 algorithm: immutable user/identity IDs,
Google provider/subject, matching verified emails and verification flag, canonicalized
inside PostgreSQL. Raw Google subjects, tokens and private Auth records are not emitted.
The hashes are review bindings, not approval or credentials. Reverify them before any
future privileged operation. **The school UUID/hash must never substitute for the personal
binding. This report supersedes the old intended target without editing historical evidence.**

## Replacement MFA plan — not approved or activated

The helper itself is unchanged. MFA capability is global Auth configuration, not an
ADMIN designation; no promotion target is embedded in its two-setting delta. The existing
school preservation check remains useful and was not bypassed or retargeted.

| New binding | Value |
| --- | --- |
| Run | `9169970e` |
| Plan SHA-256 | `0386166bc634aa539c5c02a87ca0e0072935ab8553665b9fa410f70da5be3d35` |
| Expiry | **October 19, 18:35:24 UTC+08** |
| Preparation / fresh CheckPlan | **PASS / PASS** |
| Protected original/candidate/source/TOML capture | `.local-auth-only/9169970e/mfa-review/payload.dpapi` |
| Approval | **Required separately; old approval does not transfer** |

The only proposed effective changes remain TOTP enrollment and verification **false →
true**, plus matching `[auth.mfa.totp]` TOML entries. Google settings/URLs/credentials,
JWT/database/email settings, image and aliases remain exact. Only canonical Auth would
be recreated; preserve the stopped original and encrypted rollback capture. Allow a
short Auth outage and require health/source acceptance; never retry or roll back
automatically. The old captures and failure evidence remain intact.

After separate approval of the exact new hash, and only while it remains fresh:

```powershell
$run = '9169970e'
$plan = '0386166bc634aa539c5c02a87ca0e0072935ab8553665b9fa410f70da5be3d35'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyMfa.ps1 -CheckPlan -RunId $run -ApprovedPlanSha256 $plan
# FUTURE APPROVAL ONLY — not executed here:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyMfa.ps1 -Activate -RunId $run -ApprovedPlanSha256 $plan -ConfirmMfaAuthOnlyRecreation
```

Keep the application signed out during that window. A changed/expired plan requires
another review; do not relax its source checks. Rollback still needs the exact replacement
ID and separately approved rollback hash through `-Rollback -ConfirmMfaAuthOnlyRollback`.
No rollback authorization is implied here.

## Future secure ADMIN procedure — preparation only

The unchanged `20261019000700_staff_security.PROPOSED.sql` is parameterized by UUID,
email assertion and identity binding. **No target-specific migration edit is needed.**
It remains outside `supabase/migrations/`, unapplied, at SHA-256
`b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c`.
Its approval table is absent from the retained database. No school approval needs to
be reused or revoked: none was created by these preparation tasks.

Required order:

1. Separately approve the new MFA activation plan and pass its acceptance gates.
   Relaunch the owned Vue dev server through the existing public-only launcher so
   Account security derives the enabled capability; do not start a competing server.
2. Separately authorize **personal Gmail** enrollment. Personally sign in, scan the
   Account security QR and enter the authenticator code in the app. Never send setup
   keys/codes/tokens to the agent. Enrollment must leave the database role STUDENT.
3. Establish a fresh, trusted personal **AAL2** session: successful Auth verification,
   verified `getUser`, the same verified factor/session, and current database context.
   A client boolean, email, factor-row presence or metadata alone is insufficient.
4. Separately review/apply 007 with its impact on all existing privileged accounts.
   Existing ADMIN/CASHIER accounts need their own identity-bound operator approval,
   verified factor and AAL2 before the proposed protected operations work. Sensitive
   management UI stays disabled; current retained backend gaps are not fixed by TOTP alone.
5. Reverify the personal UUID/hash, enabled STUDENT state, no assignments/work, current
   verified factor/AAL2 and unrelated-account fingerprints. Obtain a **new personal-target
   operator approval reference** and explicit promotion approval. Keep school STUDENT.
6. Prefer an existing approved AAL2 ADMIN's authorized management path when available.
   The separately approved, audited direct-operator fallback below is for cases with no
   usable approved ADMIN. Never use browser SQL, a service-role frontend key or email bootstrap.

Exact fallback arguments for a future trusted database operator:

```sql
-- FUTURE EXPLICIT APPROVAL ONLY; never executed in this task.
-- First complete trusted current personal AAL2 acceptance and fresh target review.
BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_control_system()) <> '7696959712798593061'
  THEN RAISE EXCEPTION 'Wrong source target' USING ERRCODE='42501'; END IF;
END $guard$;
SELECT queue_private.review_staff_access(
  '5c96debb-697f-4cad-805f-92b518e28343', 'ellasharmaineabeso2004@gmail.com',
  '0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701',
  'ADMIN', '<fresh-personal-target-approved-reference>', clock_timestamp()+interval '1 day');
SELECT queue_private.promote_approved_admin(
  '5c96debb-697f-4cad-805f-92b518e28343', 'ellasharmaineabeso2004@gmail.com', 'STUDENT',
  '0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701',
  '<fresh-personal-target-approved-reference>');
-- Verify target-only role/audit change, school STUDENT, and all unrelated state.
-- COMMIT only under that future explicit promotion approval; otherwise ROLLBACK.
```

**AAL2 boundary:** the direct-operator promotion helper checks verified enrollment but
does not itself authenticate the target's live browser JWT. Fresh trusted AAL2 acceptance
is therefore a required separate gate before that transaction. The proposed staff RPC
wrappers enforce signed AAL2, current enabled role/factor and active operator approval
on every protected call. No combined real enrollment/AAL2/ADMIN acceptance is claimed now.
After eventual promotion, fresh `getUser`/`my_context` must select ADMIN and protected
RPCs must still reject AAL1, expired/revoked approvals and disabled access.

## Tests, preservation and stop

| Check | Result |
| --- | --- |
| Approved old MFA CheckPlan | **FAIL — source changed; activation not attempted** |
| Two-account identity and within-run source/health checks | **PASS** |
| Replacement plan Prepare / CheckPlan | **PASS / PASS**, not activation approval |
| Unchanged 007 personal/school isolated test, `16245ca5` | **9 groups passed**, zero failures |
| Existing isolated SQL policy/routing methods | **123 passed** |
| Syntax, whitespace and original file preservation | PASS |

The new test used cached PostgreSQL 17.11/PostgREST on a separate fixture network,
loopback-only API and no retained mounts or PostgreSQL host port. Only synthetic
fixture UUIDs/factors/JWTs were used. It proved wrong school-binding rejection,
self-promotion denial, enrollment-before-operator-promotion, target-only promotion,
school preservation, ADMIN AAL1 denial, approved AAL2 access and revocation/repeat denial.
It is not real Google/TOTP session acceptance. The prior MFA activation/rollback
rehearsal remains prior evidence; it was not newly rerun. Frontend/build suites were
not rerun because no product or activation implementation changed.

The two new fixture containers are stopped; their labeled network is retained.
No volume was created/deleted or image pulled. Within-run checks preserved retained
data/functions/services and allowed only those owned Docker additions. Final live
inventory has six original application migrations and fixed routes **1:TP, 2:SOA,
3:PNEP, 4:REF, 5:ADJ**, with no active work or open day. Queue/history tables are unchanged.
All **93 backup files** retain digest
`27e6ed58b1fe58031c3a953e2c95cd8d362e869735f598c84577673498905e96`.

All **1,042** captured existing inputs retain their hashes, including modified/untracked
work, Auth helpers, config.toml, migrations, proposed 007 and historical evidence.
Created only the fixed read-only inspector, isolated personal-target test, sanitized
evidence, protected new-plan capture, ignored review artifacts and this report.
Google credential storage was checked by metadata only; passwords, QR secrets, OTPs,
JWTs and refresh tokens were not emitted. The user's frontend was left running.

Evidence: [initial identity/source diagnosis](../supabase/tests/results/personal_admin_identity_review_0f6aaa88.json),
[read-only closeout](../supabase/tests/results/personal_admin_identity_closeout_0f6aaa88.json),
[old/new plan and row-preservation receipt](../supabase/tests/results/personal_admin_activation_review_9169970e.json),
[isolated security tests](../tests/integration/results/personal_admin_preparation_16245ca5.json).

**STOP: approve replacement plan `9169970e` separately before any Auth recreation.**
Real personal MFA enrollment, retained migration 007 and personal UUID-bound ADMIN
promotion each remain separately authorized work. The school account must remain
STUDENT. No retained role/factor/assignment/queue write, service restart, credential
change, reset, backup deletion, deployment, commit or push occurred.
