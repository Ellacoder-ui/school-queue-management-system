# Local MFA-only Auth activation result

October 19, 2026 (UTC+08). **PASS — one explicitly approved MFA-only activation
completed and independent acceptance passed.** Google remains enabled. No real MFA
factor, OTP verification, security migration or ADMIN promotion was performed.

## Approval, fresh check and activation

| Binding/check | Result |
| --- | --- |
| Exact approved run | `9169970e` |
| Approved plan SHA-256 | `0386166bc634aa539c5c02a87ca0e0072935ab8553665b9fa410f70da5be3d35` |
| Plan expiry | October 19, **18:35:24 UTC+08** |
| Fresh existing CheckPlan | **PASS_PLAN_CHECKED** before activation |
| Expiry/configuration/code/source/identity/capture checks | PASS; approval was unexpired |
| Activation | **PASS_ACTIVATED**, exactly one attempt, before approximately **18:01:25 UTC+08** |
| Change-stage through acceptance | **15.630 seconds**, measured by the helper |
| Independent read-only acceptance | **PASS**, completed **18:02:49 UTC+08** |

The user explicitly approved this exact plan in the attached request. No replacement
plan was substituted. The existing `Start-AuthOnlyMfa.ps1 -Activate` workflow ran once
with the approved run/hash and `-ConfirmMfaAuthOnlyRecreation`. No retry or rollback ran.
The measured interval is this execution's acceptance interval, not a universal outage bound.

## Service and health

**Only `supabase_auth_school-queue-local` was recreated**, using the same cached Auth
2.197.0 image, `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b`.

| Required check | Actual result |
| --- | --- |
| Replacement Auth | Running, **healthy**, restart count **0** |
| Auth health through Kong | **HTTP 200** |
| Auth settings through Kong | **HTTP 200**, Google enabled |
| TOTP enrollment flag | **true** |
| TOTP verification flag | **true** |
| Anonymous public API read | **HTTP 200** |
| PostgreSQL | Original PostgreSQL **17.11**, cluster **7696959712798593061**, retained volume unchanged |
| Other services | Eleven other canonical IDs/definitions/lifecycles preserved; no operator restart |

Vector retains its pre-existing unhealthy automatic restart loop and unchanged definition.
No full-stack health claim or Vector repair is made. All unrelated non-Vector health
states matched their baseline; the older parked Google-activation Auth is also preserved.

| Container | Final state |
| --- | --- |
| Replacement ID `5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae` | Canonical Auth name; running/healthy |
| Original ID `565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399` | Stopped, exit **0**, network-detached; definition retained |
| Original's retained name | `supabase_auth_school-queue-local-9169970e-activation-mfa-original` |

Exactly one container was added. Project inventory is now **14 containers**, accounting
for canonical services and both parked originals. Existing networks/volumes are unchanged;
no image pull, deletion or stack restart occurred. Later stack/discovery operations must
explicitly account for both parked Auth containers.

## Exact configuration delta

Only these two effective environment values changed:

```text
GOTRUE_MFA_TOTP_ENROLL_ENABLED=false -> true
GOTRUE_MFA_TOTP_VERIFY_ENABLED=false -> true
```

Only the approved matching TOML section was appended:

```toml
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

The resulting `supabase/config.toml` SHA-256 is
`29c2ad10f40a36c61256ac93c25f2c545df73ef30511e46868def5e8b29c98a8`.
Its complete bytes match the protected approved proposal. Google Client ID/Secret,
provider/nonce/email flags, Site URL/callbacks, JWT/signing keys, database credentials,
email/security policy, image, aliases and every unrelated create-definition field
matched exactly. No Google credential-store decryption or change was needed.

## Database, roles and preservation

Fresh independent comparison used the encrypted approved baseline and new primary-side
read-only observations, not only the helper's success receipt. Exact data/security/role/
function comparisons passed under the unchanged preservation policy.

- **42 application accounts, 42 Auth users and 29 identities** preserved.
- **20 tickets, 57 ticket events, 32 application audits and four staff assignments**
  preserved; zero active queue work/open day. Other queue/history/replay records matched.
- All **six application migrations/file bindings**, **82 Auth migration receipts**,
  schema/RLS/grants/settings/publications and routing remained exact. Fixed services
  remain **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**.
- All **93 existing backup files** retain digest
  `27e6ed58b1fe58031c3a953e2c95cd8d362e869735f598c84577673498905e96`.
  Credential-store metadata, retained database/volume and all unrelated resource
  identities were preserved. No new backup or restore ran.
- Of **1,052** captured existing inputs, **1,051** retain their hashes. The only
  authorized changed input is `supabase/config.toml`. Existing modified/untracked
  work, product code, helpers, migrations, proposed 007 and historical evidence remain.

| Reviewed account | Immutable UUID | Final authorization / factors |
| --- | --- | --- |
| Personal Gmail — intended **future** ADMIN | `5c96debb-697f-4cad-805f-92b518e28343` | **STUDENT**, enabled; **0 factors** |
| `eabeso63122@liceo.edu.ph` | `b7d9aee8-c54d-455f-9913-a4c4dea0d097` | **STUDENT**, enabled; **0 factors** |
| Expected `bmabing62681@liceo.edu.ph` | `91a77243-319e-470b-a826-4c61bcfe87ae` | **STUDENT**, enabled; **0 factors** |

Personal Gmail is `ellasharmaineabeso2004@gmail.com`. All three Google identity bindings
match their reviewed hashes; each has zero staff assignments/active tickets. No role
was inferred from email/domain, metadata or MFA capability. Proposed 007 approval storage
is still absent: no retained security migration was applied.

Normal scoped public Realtime state remains subject to the existing narrow comparator;
this is not a database-wide immutability or new recovery certification. Prior historical
recovery and failed-plan evidence were not edited or promoted to PASS.

## Rollback readiness and enrollment boundary

Original/candidate definitions, original/proposed TOML, source baseline and journals
remain protected under `.local-auth-only/9169970e/`, including
`mfa-review/payload.dpapi` and `activation/payload.dpapi`. Private read-back and exact
binding checks passed. The original is retained and the existing separate-approval
rollback workflow remains available; it was not executed.

The activation receipt binds this replacement ID to rollback hash
`d8645aba24e0af3ad7a3d36b59e655e65215c25d6b51457d39860e427e506ffd`.
That hash is not rollback approval. Rollback needs explicit approval of the exact
run/plan/replacement/hash and `-ConfirmMfaAuthOnlyRollback`; never restore a database
dump or delete factors as configuration rollback. Legitimate Auth/factor changes after
capture require operator review rather than forcing old-state equality. Protected
captures remain Windows CurrentUser/profile/path-bound.

**Auth is ready for separately authorized personal authenticator enrollment.** The
existing Vue launcher's read-only capability check now returns **true**. A running
dev server or prior build may still cache its old disabled capability: during the
separately approved enrollment step, relaunch the owned frontend using
`python -B scripts/local_frontend.py --dev` if needed; do not start a competing server.
The current frontend/browser was not restarted or used for real login/enrollment here.

After that separate approval, personally sign in with the personal Gmail, open Account
security, scan the QR and enter the code in the app. Never send QR keys/OTPs/tokens
to the agent. Require current verified user/factor, AAL2 and database context; the role
must remain STUDENT. Migration 007, trusted operator staff approval and UUID-bound
personal ADMIN promotion are later separate approvals. Existing staff-protection gaps
are not resolved by enabling TOTP; sensitive staff-management controls remain disabled.

No mandatory activation/acceptance failure or unexpected source/configuration delta was
found. Real Google consent/session testing and real TOTP enrollment were not performed.
Read-only acceptance is not combined privileged-production acceptance.

Evidence: [activation and independent verification](../supabase/tests/results/auth_mfa_activation_result_9169970e.json).
No passwords, OTPs, QR keys, JWTs, Google secrets or raw private rows were emitted.

**Stopped after the one approved activation, independent verification and reporting.**
No real factor/OTP, account promotion, staff/queue write, migration 007, unrelated service
restart, backup/volume/container deletion, deployment, Git commit or push occurred.
