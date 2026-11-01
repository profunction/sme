# 0.9.2 fixes and verification — 2026-11-01

This release changes working software, including the purchase-order GUI, not just audit documents. It preserves the existing desktop/local preview, tools, approvals, connectors and separate FieldOps project. No production database or customer machine was modified; no paid provider request, live payment or production deployment was performed.

## Fixed and exercised

| Area | Change / evidence |
| --- | --- |
| Trusted cloud money | Exact Decimal calculations and decimal-string ledger tables; REAL columns only compatibility projections. Tampering with the REAL projection cannot create spendable funds. Reservation, payment credit and settlement entries are idempotent; each inference stores an immutable pricing snapshot and supported usage detail. |
| Provider cost discrepancy | Invalid usage retains an unknown reservation. Usage above reserved bounds records the full reported amount, holds the account and prevents further cloud spend. A protected, single-use reconciliation cannot charge the customer beyond the original reservation; excess provider liability is visible rather than discarded by MAX(0). |
| Legacy balances | Additive migration002 creates new tables without reinterpreting old money. Old balances cannot authorize cloud spend until an administrator submits an explicit reviewed opening entry with an expected legacy amount and review reference. No automatic data conversion ran. |
| Local settlement | Repeated/concurrent handlers cannot refund twice. Negative, non-finite, malformed and excess reported costs stop cloud dispatch and preserve a reconciliation record. Local REAL storage remains a secondary user-controlled budget, not the paid ledger. |
| License handling | Malformed tokens/activation responses and invalid signed claim types fail closed. Device activation refreshes account status inside the transaction. Diagnostics now report the actual application version. |
| Employee quota | Local and cloud chat attempts now count atomically against the employee's monthly task allowance alongside tools, including failed attempts. This is not a replacement for central human-user RBAC. |
| Cloud destinations/models | Private/numeric/local URL aliases, invalid ports and malformed key headers are rejected before dispatch. A configured model registry enforces TEXT capability and conservative context/input/output bounds. Production requires explicit administrator-reviewed model and official pricing configuration. No live capability/price verification is claimed. |
| Stripe protocol | Signed malformed envelopes/IDs/nested fields and bad canonical responses produce controlled errors. Invalid transport/JSON responses do not leak secrets. One-off invoices are acknowledged without granting subscription credits or retrying forever. No real merchant transaction was made. |
| PostgreSQL | Fixed write row factories with no result description, Python bool binding to legacy INTEGER flags, source-relative migrations that previously silently skipped files, checksum-complete readiness and pool shutdown. A real PostgreSQL16 service exercised migrations, grants, exact settlement, discrepancy reconciliation and concurrent admission. |
| Deployment safety | Staging/production refuses mock billing, placeholders, invalid signing/database/gateway configuration and unreviewed model/pricing configuration. Production migrations require explicit backup verification acknowledgment; this flag is not itself proof a backup works. API container logs rotate. |
| PO workflow | Business tools now provides CSV/single-sheet XLSX import, editable source-bound lines, separately supplied approved SKU prices, discrepancy flags, Decimal tax/totals and approval-gated local CSV/XLSX export. Formula-like text is neutralized; edits invalidate review. Actual browser workflow passes. |
| Build dependency risk | Applied the minimatch author's official preprocessing bounds as a checksum-verified backport to the exact v9/v10 sources, retaining APIs/licenses and legacy consumers. Adversarial-pattern and actual ASAR/file-selection tests pass. npm still reports15 moderate affected-version entries; this is a tested mitigation, not a scanner-clean claim or verified native signing. |

Enterprise's default device allowance is corrected to5; administrator catalog overrides remain available. Subscription canonical IDs and a single source for all GUI catalog content remain follow-up work.

## Tests actually executed

- `NIGHTBREW_POSTGRES_TEST_URL=<disposable local DB> .venv/bin/python -m pytest backend/tests deploy -q`: **250 passed, 2 Windows-only skipped**. Nine of these tests use actual PostgreSQL; cloud/payment responses remain non-billable mocks.
- `npm run build`: TypeScript/Vite passed.
- `npm run test:desktop`: **14 passed**, including dependency mitigation and compatibility tests. The native Linux frozen backend was rebuilt from0.9.2 source; it does not establish that a new Windows installer works.
- `npm run test:e2e`: **7 passed**, including import, discrepancy handling, approval-gated export and edit invalidation through the actual GUI.
- Manual disposable PostgreSQL `pg_dump -Fc` / `pg_restore --exit-on-error` drill: exact18-place amount, account hold state and both migration records survived restore. Both temporary databases were removed. This is a same-cloud logical restore, not an encrypted off-server production backup test.
- Full npm advisory scan still exits1 with **15 moderate entries**, no high/critical finding; version-preserving mitigation cannot change its version-based assessment. Python/Windows-specific advisories were not rescanned. TestClient/httpx deprecation warning remains.

## Using the new PO workflow

Open **Business tools**. Upload UTF-8 CSV or one-sheet XLSX with exact headers `sku,description,quantity,unit_price` and optional `line_total`. Select it under purchase-order review, import and load the result. Enter PO reference/customer, currency/tax/original total, correct each line and supply approved catalog prices independently. Validate, fix discrepancies, request export approval, then review/approve the saved task. Download the generated file from Files.

PDF text can still be extracted separately for manual preparation; generic PDF purchase-order recognition, OCR, vendor-specific field mappings and ERP submission are **not** implemented by this workflow. Export is a neutral local template, not certified ERP compatibility.

## Remaining blockers — not claimed fixed

Separate customer Credit units/conversion/expiry, full central daily/employee/model spending policies and accountable multi-user organization RBAC remain incomplete. Account bearer keys are not corporate user login. Named requester/approver separation, parser isolation/at-rest encryption/retention, generic business webhooks and the commercial subscription lifecycle need further work. Live model/payment acceptance, a signed Windows installer/update chain, real off-server encrypted backup/alerts/load tests and privacy/legal review require their actual external setup. Production release remains blocked; no promise that all possible bugs have been eliminated is made.
