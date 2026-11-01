# NightBrew FieldOps AI — Phase 1

A separate mobile-first field-service product inside this repository. The existing NightBrew AI Employee desktop product is preserved.

## Working scope

- FastAPI + SQLite backend: company accounts, hashed-password login, expiring/revocable bearer sessions, five roles, tenant-scoped customer/site/equipment records, engineer assignments, work-order lifecycle, append-only four-section service notes, equipment history and audit events.
- Deterministic PDF service reports with factual notes, source record revision and explicit missing-information markers. No AI diagnosis, manufacturer citation, replacement part, measurement or successful outcome is invented.
- Flutter Android/iOS code: company sign-in, customer/site/equipment and engineer forms for authorized managers, work creation/assignment, assigned-work views, service-note editor, cached maintenance history, PDF sharing, SQLite cache/outbox, conflict review and explicit rebase.
- SQLite notes are durable before network transmission. Server idempotency prevents duplicate note creation after retries. A stale revision yields HTTP 409; the draft remains local.

## Try the backend

From repository root, Python 3.12:

```bash
python -m venv .venv-fieldops
source .venv-fieldops/bin/activate
python -m pip install -r fieldops/requirements-test.txt
export FIELDOPS_DB=/absolute/private/path/fieldops.sqlite3
python -m fieldops.server.admin --code MYCOMPANY --name 'My Service Company' --email owner@example.com --owner-name 'Company Owner' --industry 'General maintenance'
python -m uvicorn fieldops.server.app:app --host 127.0.0.1 --port 8787
```

The admin command asks for a password without echoing or putting it in command history. There is no public company bootstrap, default production account or bundled company password. Windows uses `.venv-fieldops\Scripts\Activate.ps1` and `$env:FIELDOPS_DB` instead of the Unix activation/export syntax. Open `http://127.0.0.1:8787/docs` for the development API explorer; this is not a completed React administration dashboard.

Sign in at `/auth/login` with company code, email and password. The owner can add engineers and records through the mobile UI or authenticated API. A manager first creates a customer, site, equipment and engineer, then assigns a work order. The engineer adds actual observations, synchronizes and exports a draft report. Mark Completed only after entering an actual outcome; supervisors/administrators close records.

## Flutter application

Use Flutter 3.44.0 / compatible Dart 3.12+, Android SDK and (for iOS) macOS/Xcode:

```bash
python fieldops/scripts/bootstrap_mobile.py
cd fieldops/mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

The bootstrap script generates standard Android/iOS runners from the pinned Flutter templates without replacing product Dart code. Native runner directories are generated, not hand-maintained in this repository. Do not run `flutter create --overwrite` over this product.

For an Android emulator connecting to the development backend on the host:

```bash
flutter run --dart-define=FIELDOPS_ALLOW_HTTP=true --dart-define=FIELDOPS_API_URL=http://10.0.2.2:8787
```

The host development server must be reachable from that emulator. On a physical phone use a properly deployed **HTTPS** API endpoint and enter it on the login screen. Do not enter a PC's `localhost` on a physical phone. Production builds do not allow arbitrary HTTP origins, bypass TLS verification or follow API redirects. iOS physical installation requires your Apple signing configuration; the CI `.app` build is unsigned and is not an installable App Store/TestFlight release.

## Offline use

An initial online sign-in and successful synchronization are required. The device retains only that origin/company/user's authorized snapshot and local notes. It cannot fetch uncached equipment offline. Save notes on the device; pending records synchronize on refresh and periodic foreground retry. Conflicts are retained for review. Server PDF export, company record creation and status changes require a connection in Phase 1. Logout asks before deleting that account's cache and unsent notes.

## Checks and limits

```bash
python -m pytest fieldops/tests -q
```

Backend tests cover tenant and role boundaries, foreign references, note idempotency/conflicts, work status and history, actual PDF parsing, missing facts and request limits. Flutter tests cover actual SQLite persistence/account scopes, retry/conflict behavior and the first-use login form. `.github/workflows/fieldops.yml` analyzes/tests Flutter and attempts Android APK and unsigned iOS builds; consult the actual run result rather than equating configuration with verification.

This Phase 1 does **not** implement cloud AI, RAG/manual uploads, voice, photos, annotations, signatures, DOCX, full web administration, PostgreSQL, S3, production billing or production mobile distribution. The pricing endpoint is a mock configuration foundation; no payment or paid entitlement is accepted. See [ROADMAP.md](ROADMAP.md), [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).

## Verified build — 2026-11-01

[CI run 41315897633](https://github.com/profunction/sme/actions/runs/41315897633) succeeded for source commit `26191b6`: backend 15 tests; Flutter analysis and six mobile tests on both runners; Android development APK and unsigned iOS build. Download **FieldOps-android-development** for the debug APK. **FieldOps-ios-development** contains an unsigned `.app` and is not directly installable on an iPhone. The artifacts do not include a hosted backend, company account or password.

This proves build/test execution on those runners, not physical device/network acceptance, live AI or production distribution. Combined existing AI Employee + FieldOps Python regression: 86 passed, two Windows-only checks skipped on Linux.
