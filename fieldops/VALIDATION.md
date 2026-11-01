# Phase 1 validation — 2026-11-01

Verified source: `26191b6`. [Successful CI run](https://github.com/profunction/sme/actions/runs/41315897633).

| Check | Observed result |
|---|---|
| FieldOps backend | 15 tests passed locally and in GitHub Linux CI, covering auth/revocation, tenant/composite references, engineer assignment, viewer restrictions, idempotency/conflicts, lifecycle/history, actual PDF contents, missing facts, mock billing and request bounds |
| Flutter Android | Analyze passed; six tests passed; debug APK built |
| Flutter iOS | Analyze passed; six tests passed; unsigned release `.app` built |
| SQLite device tests | Persistent restart, origin/company/user scope separation, conflict retention/rebase, transport failure retention and snapshot-ack ordering verified with SQLite FFI |
| Existing product regression | Combined Python suites: 86 passed, two Windows-only tests skipped on Linux |

Artifacts: FieldOps-android-development (approximately 82 MB) and FieldOps-ios-development (approximately 7.25 MB), including native runners/dependency lock material. Artifact archive digests are not individual APK hashes.

Unverified: physical phone installation, real company HTTPS hosting, customer account provisioning on a hosted server, live equipment troubleshooting, AI/manual citations/voice/photos/signatures/DOCX, complete web administration, PostgreSQL/S3, production authentication operations/billing/store release, full accessibility/security/legal review and customer acceptance. Device SQLite is app-private, not independently encrypted. No paid inference, real payment, manual redistribution or production deployment occurred.
