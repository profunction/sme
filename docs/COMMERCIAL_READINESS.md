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

Safe follow-up: gateway concurrency and malformed-outcome hardening is planned after the baseline audit. Its final executed results will be appended here before commit. It does not replace the missing accounting/policy work.

## What can be demonstrated now

With synthetic documents: local workspace, model configuration, deterministic quotation/invoice drafts, Excel numeric summaries, explicit tool approvals and mock connectors. Customer-specific cloud/ERP/payment claims require separate evidence. The unsigned local preview is a development build and grants no paid subscription.

Next recommended action: Phase 2 ledger/capability work with a disposable PostgreSQL integration harness, followed by authoritative identities/plan policies. Do not invite paying pilots until the gates above are closed and the owner explicitly authorizes the pilot terms and production deployment.
