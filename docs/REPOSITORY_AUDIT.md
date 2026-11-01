# Repository audit — 2026-11-01

Baseline: `ca68b44`, NightBrew AI Employee 0.9.1. This is a source review and bounded local verification, not a penetration test or production acceptance. All 152 tracked paths were inventoried, including desktop, local backend, billing authority, deployment, tests, build scripts and the separate FieldOps product. Generated packages, dependency directories and secret values are not evidence of readiness.

## 1. Current architecture

One Electron desktop, React/TypeScript/Vite/Tailwind renderer, CommonJS main/preload, managed Python FastAPI child and SQLite workspace. Python handles Ollama, OpenAI-compatible text requests, deterministic documents, Playwright and Windows-only pywinauto. `billing_service/` is a separate trusted FastAPI authority for accounts, Ed25519 licensing, Stripe/mock billing and included cloud inference. `deploy/` adds a PostgreSQL adapter, migration, Compose/Caddy and runbooks. No GPU server is required.

`fieldops/` is a separate Flutter/Python application. Its authentication, company roles and mobile synchronization do **not** implement these capabilities in AI Employee. It is preserved and excluded from claims about this product.

## 2. Existing functionality and evidence

See [FEATURE_STATUS.md](FEATURE_STATUS.md) for individual classifications and test boundaries. Local authenticated API, model settings, cloud consent, Decimal document calculations, bounded tools, employee permissions, immutable approved writes, signed license verification and mocked payment/gateway protocols have automated coverage. Windows fixtures exist, but Linux skips Windows runtime tests. Unsigned installers and a production build recipe do not establish a signed commercial release.

## 3. Missing or incomplete functionality

No complete purchase-order pilot workflow, native Gemini/Claude adapters, model capability registry, five-level task router, immutable Decimal AI ledger, separate customer credit units, internal economics dashboard, general webhook connector or production user/tenant RBAC. Ollama download/progress/removal and validated Qwen recommendations are absent. See the feature matrix rather than extrapolating from screens or method names.

## 4. Security risks

Local session holders have administrator access; AI employees are scoped records, not authenticated human users. Authority customers use account bearer secrets and a shared administrator secret. Monetary balances use SQLite/PostgreSQL `REAL` and Python floats. Approval logs lack human requester/approver identities. Provider token reports can exceed reservations; the current balance floor can hide liabilities. Plaintext business files, limited abuse protection, untested PostgreSQL operations and missing retention enforcement remain material risks. [SECURITY_GAPS.md](SECURITY_GAPS.md) records priorities.

## 5. Commercial blockers

Do not admit five paid customers yet. Complete an exact ledger and reconciliation, server-enforced policies, user identities/tenant tests, reviewed PO export, verified payment lifecycle, signed Windows acceptance, provider acceptance and a real backup restore. Live payment, TLS deployment and provider tests require external accounts/configuration and are not verified here. No legal PDPA compliance claim is made.

## 6. Recommended architecture changes

Keep Electron, the local FastAPI workspace and one modular trusted server. Add authoritative tenant/user roles, plan policies, cost ledger and provider adapters inside that server. Retain local tools and local Ollama; send only explicitly permitted data. Use PostgreSQL for the trusted service after actual adapter/migration testing. Keep the stable API domain and persistent database volume. Do not introduce Kubernetes, GPU inference or separate infrastructure per plan. See [ARCHITECTURE.md](ARCHITECTURE.md).

## 7. Provider integration plan

DeepSeek remains the initial configurable OpenAI-compatible text candidate; Ollama remains local. Existing requests are tested with mocked HTTP, not live providers. Add explicit model capabilities/context limits and uniform errors before routing/failover. Gemini/Claude require provider-specific authentication, schema and usage parsing. OpenAI also needs live model acceptance. Current provider prices/capabilities are UNVERIFIED. See [AI_PROVIDER_STRATEGY.md](AI_PROVIDER_STRATEGY.md).

## 8. Cost controls

Current controls: transactional reservation, per-account request/month quotas, employee monthly limits, no automatic gateway retry, retained unknown-outcome reservations. Gaps: exact money, pricing snapshots, separate credits, daily/concurrent/per-task budgets, reliable reconciliation and complete server attribution. Initial safe improvement: database-transactional gateway concurrency admission, with malformed provider outcomes failing closed. This does not complete accounting. See [AI_PRICING_ASSUMPTIONS.md](AI_PRICING_ASSUMPTIONS.md) and [UNIT_ECONOMICS.md](UNIT_ECONOMICS.md).

## 9. Database changes proposed, not applied

Preserve existing data; do not edit applied `001_authority.sql`. Design additive versioned migrations for:

| Area | Proposed records / constraints |
| --- | --- |
| Identity | organizations, users, memberships(role), sessions; tenant foreign keys and scoped unique keys |
| Commercial | plan_versions, subscriptions(state/period/grace), licenses, devices(revoked_at), service_quotes(scope/hours/price/deliverables/acceptance/maintenance), quote_changes |
| AI configuration | providers, model_versions(capabilities/context/output), routing_policies, employee_policies, budget_periods |
| Cost | price_versions(effective_at/currency/source/verified_at), usage_events with provider/user/employee/task attribution, immutable price snapshots, cached/reasoning/image/audio/tool/retry fields |
| Credits | credit_accounts, expiring_credit_lots, reservations, append-only ledger_entries, settlements; tenant-scoped idempotency keys and no unauthorized negative balance |
| Review | approvals(requester/approver/action_hash/target/before/after/decision/result), PO revisions/lines/validation/export mappings, append-only audit events |
| Pilot | workflow_runs, corrections, elapsed time, support time, errors, satisfaction |

Use PostgreSQL `NUMERIC` with documented precision and Python Decimal, decimal strings on APIs, and explicit currency/rounding. Credit units are separate from USD costs and MYR invoices. Migration must reconcile existing REAL balances to an approved opening balance, verify backup/restore, test rollback and compare totals before enabling writes. Do not silently reinterpret old USD balances as new Credits. No destructive migration was performed.

## 10. Prioritized execution

1. Phase 1: evidence audit, risk register and explicit release gates; add bounded gateway admission without schema/data changes.
2. Phase 2: ledger/pricing snapshots, model registry, adapters, server budgets and reconciliation; verify PostgreSQL transactions and concurrency.
3. Phase 3: tenant user authentication/roles, authoritative plan routing, employee/device policies and subscription lifecycle.
4. Phase 4: one reviewed PO workflow and one customer-specific export mapping; test approval changes and duplicate submissions.
5. Phase 5: payment sandbox/live acceptance, signed delivery, VPS restore/monitoring; production deployment needs explicit authorization.
6. Phase 6: five controlled pilots only after gates; measure support and economics before expanding.

Detailed criteria: [ROADMAP.md](ROADMAP.md), [PILOT_PLAN.md](PILOT_PLAN.md), [COMMERCIAL_READINESS.md](COMMERCIAL_READINESS.md).

## Verification at baseline

Executed in this Linux cloud environment: `pytest backend/tests deploy -q`: **79 passed, 2 skipped**; `npm run build`: passed; `npm run test:desktop`: **7 passed**; `npm run test:e2e`: **6 passed** with actual Chromium. Provider/Stripe responses use mocks; SQLite transactions run for real. PostgreSQL adapter tests use fake connections. Windows tests skipped here; no Docker/PostgreSQL/backup restore, real Ollama inference, payment, cloud provider, signed update or customer ERP acceptance was executed. Warnings include TestClient/httpx deprecation and Pydantic Decimal default serialization; they are not hidden failures. Post-change results are recorded in COMMERCIAL_READINESS.md.

Fresh dependency audit: full `npm audit --json` exits 1 with **15 moderate affected entries**, tracing to minimatch denial of service in the electron-builder chain (GHSA-g3hv-75wg-m249); no high/critical finding reported. `--omit=dev` exits 0 with no findings, but excludes Electron/build dependencies and cannot certify the package. No automatic electron-builder fix is reported; no forced incompatible major override was applied. See the committed audit snapshot and S17. Python and Windows-specific advisory scans were not rerun; historical zero findings are not current evidence.
