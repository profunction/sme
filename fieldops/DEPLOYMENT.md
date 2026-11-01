# Deployment / release boundaries

## Local server

Use Python 3.12, a private `FIELDOPS_DB` path and `fieldops/requirements.txt`. Run the provisioning CLI in README to create a company owner, then serve `fieldops.server.app:app` on port 8787 bound to loopback. Tests use temporary SQLite files and no live paid services. `/docs` is a developer API explorer, not the final React supervisor dashboard.

## Device connection

For a physical Android/iPhone, deploy this API behind a valid HTTPS hostname and enter that origin in the mobile sign-in screen. A phone's localhost is the phone, not the development PC. Do not open a publicly reachable unauthenticated desktop API or disable TLS. Initial sign-in and assigned-record download require network connectivity; later service-note drafting is offline-capable.

An Android emulator can reach the host through `10.0.2.2`; this requires the explicit debug `FIELDOPS_ALLOW_HTTP=true` build flag. The delivered development APK is not a store release, does not include a hosted account/server and does not ship default credentials. Your owner creates customer/site/equipment/engineer records before assigning work.

## CI

The FieldOps workflow uses the official Flutter release manifest, selects Flutter 3.44.0 for the actual runner architecture, verifies the official archive SHA-256 before extraction, generates Android/iOS platform runners, resolves pinned direct packages, analyzes/tests Dart, builds an Android debug APK and attempts an unsigned iOS app. SDK setup failures are public sanitized annotations. Read the actual checks/artifacts: an uploaded lockfile or platform folder alone does NOT mean an APK or iOS build passed.

Native runner files and pubspec.lock are captured as CI artifacts. Direct package pins exist in source; full production dependency locking and a reviewed retained native release project remain release tasks. iOS `.app` without signing cannot be installed on a customer's phone; TestFlight/App Store/device signing needs owner Apple credentials. Android Play signing, privacy declarations, retention policy, store review, physical-device testing and commercial acceptance remain Phase 6 work.

## Growth

Move to PostgreSQL with reviewed migrations before multiple API replicas/high concurrent load. Add backups, recovery drills, monitoring and centralized rate limiting. Introduce S3-compatible evidence/manual storage only with tenant-scoped objects, signed access, upload limits, retention and explicit consent. No production infrastructure is deployed by this repository change.
