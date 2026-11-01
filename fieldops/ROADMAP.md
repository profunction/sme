# Roadmap / truthful completion boundaries

| Phase | Current implementation | Remaining / acceptance |
|---|---|---|
| 1 | Company login/RBAC, customers/sites/equipment, assignments/work-order status, factual service notes, PDF, Flutter source, SQLite note queue/cache, conflict protocol, API tests | Flutter analysis/tests, Android APK and unsigned iOS build verified in CI; physical Android/iOS tests and deployment/customer usability remain; generated native runners and unsigned development artifacts are not production releases |
| 2 | Deterministic PDF only | Voice EN/ZH/MS, reviewed transcription, structured AI drafts, photos/evidence consent, DOCX, signatures and company-specific report templates |
| 3 | Design only | Authorized manual uploads, metadata/page extraction, tenant indexing, retrieval, reference validation and cited troubleshooting; no manufacturer diagnosis is currently generated |
| 4 | Raw related work-order history | Historical query/time filters, repeated fault analytics, maintenance recommendations with fact/hypothesis separation |
| 5 | Tenant/RBAC and assigned-record cache/notes groundwork | Schedules, richer supervisor UI, React dashboard, expanded offline entity mutations, signatures, retention enforcement and conflict UX acceptance |
| 6 | Mock pricing configuration, no billing enabled | Trusted billing/auth operations, quotas/storage, PostgreSQL/S3, monitoring/backups, mobile signing, store publication, penetration/legal review |

All sample Cisco/Poly/Crestron/Bosch/Q-SYS cases are test record labels, not diagnosed equipment. Industrial safety instructions and protective bypasses are not generated. Phase 1 does not auto-download manuals, upload photos or call paid AI.
