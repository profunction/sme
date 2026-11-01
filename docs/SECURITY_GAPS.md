# Security gap register

Reviewed 2026-11-01 at `ca68b44`. P0 blocks customer-funded cloud operation; P1 blocks the proposed paid pilot; P2 must be bounded/documented before wider release. These are observed gaps, not evidence of exploitation.

| ID / priority | Finding and evidence | Required closure evidence |
| --- | --- | --- |
| S01 P0 | REAL/float money and mixed USD cost/credits: store.py, authority schema, gateway_prices | Decimal/NUMERIC ledger; price snapshots; exact reserve/settle/refund, concurrency/idempotency tests; approved reconciled opening balances |
| S02 P0 | gateway settlement uses MAX(0, credits + reserve - cost); oversized reported usage can exceed reservation, losing liability visibility | validated provider usage, discrepancy hold and reconciliation; enforce hard task/provider caps with verified tokenizer/context assumptions; never silently discard debt |
| S03 P0 | authority policies do not enforce full employee/model/daily/task spend hierarchy; local employee budgets editable | authoritative policy + attribution on each gateway/tool operation; negative permission and concurrent budget tests |
| S04 P1 | no global concurrent gateway cap at baseline; HTTP timeout alone allows saturation | atomic admission before debit/provider call, bounded global/account limits, saturation/recovery tests; initial follow-up in readiness log |
| S05 P1 | account bearer key + shared admin key, no human tenant RBAC/MFA/key lifecycle | users/memberships/roles, scoped credential rotation/revocation, cross-tenant endpoint tests and admin audit |
| S06 P1 | approvals identify local task, not accountable human; no separation of duties | requester/approver identities, action hash, before/after, target, decision/result, changed-details reapproval tests |
| S07 P1 | PostgreSQL shim and migrations lack actual database integration evidence; coarse advisory write lock | disposable PostgreSQL migration/race/failure tests; pool recovery and migration consistency; do not edit applied migration |
| S08 P1 | backup and restore not rehearsed, no verified schedule/retention/off-server restore | encrypted off-server restore drill, row/balance consistency, key recovery, retention schedule, recovery timings |
| S09 P1 | mock billing default; production config examples are not launch guards | explicit non-mock production gate, verified merchant/webhook lifecycle; startup rejection of placeholders and missing security configuration |
| S10 P1 | plaintext workspace/uploads/screenshots/task payloads; parser runs in service | customer data policy, OS disk encryption guidance and approved access/retention; parser process/resource limits and safe sample corpus |
| S11 P1 | signing/updater recipe without verified signed delivery | test signed install/update/rollback on clean supported Windows; protect CI signing identity/feed |
| S12 P1 | HTTPS host checks are not DNS/private-egress firewall | server egress restriction, private-address/rebinding tests, no secret-bearing redirect, explicit provider/connector configuration |
| S13 P1 | no comprehensive auth/admin/payment request abuse limits or body-size proxy policy | endpoint/identity limits, bounded request sizes, timeout/load tests and alerting; no customer-data logs |
| S14 P2 | local clock/device ID and editable local policy can be changed by machine admin | document trust boundary; trusted server checks for paid actions; do not promise tamper-proof offline DRM |
| S15 P2 | cooperative cancel cannot undo committed external write | single-use approved payload, no write replay, external reconciliation UI; dangerous actions restricted during pilot |
| S16 P1 | legal basis, retention, cross-border AI processing and model redistribution not reviewed | Malaysia/Singapore privacy/legal review, customer consent/DPA, deletion/export procedures, exact model license/notice verification |
| S17 P1 | fresh full npm audit reports 15 moderate affected dependency entries from minimatch DoS advisory GHSA-g3hv-75wg-m249 in electron-builder's build chain | use an upstream-compatible fixed build chain and rerun native packaging; npm reports no automatic fix for electron-builder; do not force a breaking minimatch major override |

No production configuration, customer data or database was altered for this audit. Do not treat prior zero-advisory scans as a current security certification. Provider data and documents remain untrusted input; prompts cannot authorize permissions or approval.

Current dependency evidence: [npm audit snapshot](npm-audit-2026-11-01.json). Full scan: 15 moderate entries, 0 high/critical; these entries propagate one root minimatch advisory, not 15 independent root vulnerabilities. `npm audit --omit=dev` reports zero, but excludes Electron/build tooling even though Electron is distributed; it is not a complete packaged-runtime security assessment. Python advisories and Windows-only dependencies were not freshly scanned in this phase. No dependency version was changed.
