# Commercial readiness — NOT READY for a paid pilot

Phase 1 audit, 2026-11-01. Existing foundations can support developer demonstrations with synthetic data. They do not establish safe customer-funded operation or validated purchase-order processing. No production deployment or paid infrastructure was authorized or performed.

## Release gates

| Gate | Current decision | Acceptance required |
| --- | --- | --- |
| Exact billing and cost control | BLOCKED | separate immutable credit/cost ledgers, decimal snapshots, bounded settlement, reconciliation and race tests |
| Identity and policy | BLOCKED | accountable users/roles, tenant isolation tests, server employee/model/budget enforcement |
| Primary PO workflow | BLOCKED | complete import/review/validate/totals/approved mapped export plus audit, measured on realistic samples |
| Cloud provider | UNVERIFIED | current official model/pricing records and approved live DeepSeek smoke/usage reconciliation; no real key used here |
| Merchant billing | UNVERIFIED | provider account, signed sandbox lifecycle and live authorized acceptance; no real payment executed |
| Operations | UNVERIFIED | actual PostgreSQL migration, encrypted off-server restore, monitoring/alerts, staged TLS deployment and rollback drill |
| Windows delivery | UNVERIFIED | signed installer and update chain tested on customer-equivalent clean Windows with actual Ollama if offered |
| Privacy and commercial terms | BLOCKED | privacy/PDPA review, retention/consent/support scope, license review, published measured limits |
| Build dependency security | BLOCKED | full npm scan: 15 moderate affected entries in minimatch/electron-builder build chain; compatible upstream remediation and native package retest required |

## Phase 1 work and verification

Completed: baseline repository/feature audit, risk register, architecture/provider/cost/schema proposals and staged pilot gates. Existing modules and FieldOps are preserved. No database schema or customer balance changes.

Baseline executed: Python backend/deploy **79 passed, 2 Windows-only skipped**; TypeScript/Vite build passed; desktop tests **7 passed**; Chromium e2e **6 passed**. Mock provider/payment responses do not prove live integrations. PostgreSQL unit tests use fake connections, not a real server. TestClient deprecation and Pydantic Decimal serialization warnings remain.

Safe follow-up completed: database-transactional global/account gateway admission, configurable defaults of 2/1, invalid-limit rejection before reservation, and malformed provider-usage outcomes handled without an unhandled exception. No schema, customer balance, paid entitlement or automatic retry policy was changed. Rejected capacity requests neither debit credits nor dispatch inference. Handled unknown outcomes keep their monetary reservation; crashed reservations fail closed pending operator reconciliation. See [deployment caveats](DEPLOYMENT.md).

Code/config changed: `billing_service/admission.py`, `billing_service/app.py`, `.env.example`, `backend/tests/test_gateway_admission.py` and `.github/workflows/validate.yml`. CI now includes deployment unit tests on Linux and Windows; those PostgreSQL tests are still fake-connection tests. Audit files/README/license review were updated in a separate reviewable commit.

Executed after the code changes: `.venv/bin/python -m pytest backend/tests deploy -q`: **92 passed, 2 Windows-only skipped**, including 13 new cases for concurrent global/account admission, unchanged credits/no dispatch on rejection, in-flight idempotency, invalid configuration, timeout/malformed outcomes and crash-slot retention. TypeScript build, 7 desktop tests and 6 Chromium e2e tests passed at baseline; renderer/desktop code was unchanged. `git diff --check` passed. Full npm advisory scan exits 1 with 15 moderate affected entries; production-only scan exits 0, with the exclusion caveat recorded in SECURITY_GAPS.md. No Python/Windows advisory scan or live service acceptance was performed.

This closes the bounded SQLite admission gap, not exact accounting, provider invoice limits or PostgreSQL deployment verification. Remaining risks and gates above are unchanged. No production release is approved by these test results.

## What can be demonstrated now

With synthetic documents: local workspace, model configuration, deterministic quotation/invoice drafts, Excel numeric summaries, explicit tool approvals and mock connectors. Customer-specific cloud/ERP/payment claims require separate evidence. The unsigned local preview is a development build and grants no paid subscription.

Next recommended action: Phase 2 ledger/capability work with a disposable PostgreSQL integration harness, followed by authoritative identities/plan policies. Do not invite paying pilots until the gates above are closed and the owner explicitly authorizes the pilot terms and production deployment.
