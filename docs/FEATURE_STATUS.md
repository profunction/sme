# Feature status — 2026-11-01

Baseline `ca68b44`; Phase 1 follow-up is listed separately. Status applies only to the precisely described scope. **IMPLEMENTED AND TESTED** includes repeatable mocked protocols, not live vendor certification. **IMPLEMENTED BUT UNVERIFIED** means code exists without relevant acceptance evidence. **PARTIALLY IMPLEMENTED** means essential behavior is missing. **NOT IMPLEMENTED** means no implementation was found. **BLOCKED BY EXTERNAL DEPENDENCY** identifies release acceptance requiring an external service, account or platform. Root documents describing historical phases do not override this matrix.

| Feature / precise scope | Status | Evidence and practical limit |
| --- | --- | --- |
| One Electron application, managed loopback FastAPI, authenticated IPC | IMPLEMENTED AND TESTED | desktop/backend.test.cjs; main/preload, test_app.py; Linux child/startup tests |
| React dark GUI, guide, editable prompts, themes, model settings | IMPLEMENTED AND TESTED | six e2e cases; no customer usability acceptance |
| SQLite messages/settings persistence | IMPLEMENTED AND TESTED | store.py; test_app.py/test_model_settings.py; not encrypted |
| Human users, tenant organization RBAC/MFA/session revocation | NOT IMPLEMENTED | account bearer key is not corporate login; FieldOps roles are separate |
| Ollama detect/list/benchmark/local text adapter | IMPLEMENTED AND TESTED | test_ai.py, test_model_settings.py; protocol mocks; customer hardware performance unverified |
| Real customer Ollama performance / Qwen model license and evaluation | BLOCKED BY EXTERNAL DEPENDENCY | needs chosen weights and Windows hardware benchmark; no model bundled |
| Ollama model install/progress/removal | NOT IMPLEMENTED | detection/selection is not installation |
| CPU/RAM/storage and best-effort GPU/VRAM detection | PARTIALLY IMPLEMENTED | hardware.py; actual Windows GPU coverage incomplete, unknown VRAM preserved |
| DeepSeek/OpenAI-compatible text request + server-only key | IMPLEMENTED AND TESTED | test_billing.py HTTP mocks, provider.py; no live credential used |
| Real DeepSeek/OpenAI provider acceptance and current prices | BLOCKED BY EXTERNAL DEPENDENCY | model/provider account, approved data and pricing verification needed |
| Native Gemini and Claude adapters | NOT IMPLEMENTED | changing an API URL alone does not implement native protocols |
| Capability registry, context validation, vision, structured output, tools | NOT IMPLEMENTED | gateway is text-only; no model-specific capability enforcement |
| LOCAL_ONLY/CLOUD_ONLY/HYBRID with consent/private policy | IMPLEMENTED AND TESTED | test_ai.py; basic routing only |
| Subscription-authoritative AI mode restrictions | PARTIALLY IMPLEMENTED | mode chosen in local request/policy; paid plan quotas do not fully enforce mode |
| Five-level complexity/cost/quality router and approved escalation | NOT IMPLEMENTED | no deterministic LEVEL 0–4 classifier or failover policy |
| Email drafting / general summaries through text chat | PARTIALLY IMPLEMENTED | generic chat/prompts; no validated end-to-end email workflow; sending absent |
| Company SOP organization/RAG/source management | NOT IMPLEMENTED | document text extraction is not an indexed SOP knowledge base |
| Excel numeric analysis without formula execution | IMPLEMENTED AND TESTED | documents.py and test_documents.py; cached formulas may be stale |
| PDF/DOCX/CSV text extraction, bounded uploads, opaque file IDs | IMPLEMENTED AND TESTED | test_documents.py; no OCR or malware isolation |
| PDF/DOCX quotation, invoice and PO drafts; Decimal totals | IMPLEMENTED AND TESTED | test_documents.py; user-entered lines; not accounting posting |
| PO extraction/product catalog matching/discrepancies/CSV-XLSX export | NOT IMPLEMENTED | required pilot pipeline absent; import/analysis tools are only building blocks |
| AI employee CRUD, tool and connector permissions, assignment | IMPLEMENTED AND TESTED | workforce.py, test_workforce.py, e2e; authenticated local user is admin |
| Employee monthly spend and task limits | IMPLEMENTED AND TESTED | test_workforce.py; local limits are editable and floats, not trusted paid funds |
| Department budgets, daily limits, allowed models/data scopes | NOT IMPLEMENTED | employee schema lacks these controls |
| Task history, bounded queue, cancellation, emergency stop | IMPLEMENTED AND TESTED | test_documents.py; cooperative stop cannot undo in-flight actions |
| Exact immutable task approval / changed permissions recheck | IMPLEMENTED AND TESTED | test_connectors.py/test_workforce.py/test_automation.py; local user only |
| Named requester/approver, before-after values, separation of duties | PARTIALLY IMPLEMENTED | IDs/type/timestamp audit only; no human identity/approval evidence model |
| Browser deterministic reviewed steps, allowlist, screenshot/checks | IMPLEMENTED AND TESTED | real local Playwright fixture in test_automation.py; not arbitrary website compatibility |
| Windows pywinauto adapter / result checks / native vault fixture | IMPLEMENTED BUT UNVERIFIED | Windows-specific tests exist; skipped in current Linux run; earlier CI fixtures do not validate customer software |
| General autonomous multi-step business planner | NOT IMPLEMENTED | explicit bounded tool plans only; no unrestricted AI execution |
| ERP/POS/WMS/TMS mocks available across all plans | IMPLEMENTED AND TESTED | test_connectors.py; explicitly not vendor integrations |
| Generic HTTPS REST read/write/auth/rate/approval framework | IMPLEMENTED AND TESTED | HTTP mocks and fixture tests; no vendor-specific schema/version certification |
| Real ERP/POS/WMS/TMS connector compatibility | BLOCKED BY EXTERNAL DEPENDENCY | needs vendor sandbox/contract/schema and customer acceptance |
| Generic business webhook connector | NOT IMPLEMENTED | Stripe payment webhook is a different feature |
| Local audit metadata and rotating diagnostic logs | IMPLEMENTED AND TESTED | test_connectors.py audit sanitization; desktop backend log rotation |
| Central tenant audit, tamper evidence, retention/export policy | NOT IMPLEMENTED | no complete server audit pipeline/retention enforcement |
| Configurable trusted plan catalog / employee and device seats | IMPLEMENTED AND TESTED | test_billing.py; legacy plan IDs; Starter2/Business5; Enterprise configurable |
| New requested plan defaults and single source of UI truth | PARTIALLY IMPLEMENTED | Enterprise currently10 devices, requested5; duplicated catalog in connectors/UI; legacy USD allowances |
| Ed25519 device-bound expiring license verification / tamper rejection | IMPLEMENTED AND TESTED | test_billing.py; 24-hour maximum grants; not tamper-proof DRM |
| Offline subscription business tools | PARTIALLY IMPLEMENTED | signature validates offline but reserve_task calls authority; useful offline tool grace is not complete |
| Device deactivation/revocation console, key rotation lifecycle | NOT IMPLEMENTED | activation alone is not device management |
| Trial/paid pilot/past-due/suspended/canceled/grace state machine | PARTIALLY IMPLEMENTED | active/expiry plus payment event branches; not explicit complete lifecycle |
| Stripe Checkout/portal/signed idempotent webhook protocol | IMPLEMENTED AND TESTED | test_billing.py mocks/signatures; not live payments |
| Approved merchant integration, refunds, production receipts | BLOCKED BY EXTERNAL DEPENDENCY | requires merchant setup and sandbox/live reconciliation |
| Service quotation scope/hours/acceptance/change requests | NOT IMPLEMENTED | setup/custom_connector SKU does not implement a services quote model |
| Gateway reservation, monthly/rate quotas, unknown-outcome retention | IMPLEMENTED AND TESTED | test_billing.py; still floating accounting, partial attribution |
| Global/per-account gateway concurrent request admission | NOT IMPLEMENTED | missing at audited baseline; follow-up described below |
| Exact money/pricing effective history/immutable cost snapshots | NOT IMPLEMENTED | REAL/float balances and mutable env rates; historical token detail absent on authority |
| Separate Credits ledger/expiry/reserve-settle/refund/idempotency | PARTIALLY IMPLEMENTED | USD account balance and request ID guard only; no distinct customer Credit units |
| Hard org daily/employee/task/server spending hierarchy | PARTIALLY IMPLEMENTED | monthly/credit and local employee controls only; settlement can exceed reserve |
| Economics/MRR/support-cost/contribution dashboard | NOT IMPLEMENTED | local usage page is not business accounting |
| Secure native BYOK/account credential storage | IMPLEMENTED AND TESTED | vault selection tests, no plaintext Linux fallback; Windows roundtrip skipped locally |
| File encryption, parser isolation, malware scan, retention | NOT IMPLEMENTED | OS permissions and extraction limits only |
| PostgreSQL production adapter/migration | IMPLEMENTED BUT UNVERIFIED | fake connection tests; no actual PostgreSQL transaction/restore execution |
| Compose/Caddy/health/restart/non-root container recipes | IMPLEMENTED BUT UNVERIFIED | deployment files exist; no TLS/Docker rollout acceptance |
| Encrypted off-server backup/restore scripts | IMPLEMENTED BUT UNVERIFIED | not executed; scheduled jobs and retention automation absent |
| Capacity threshold recommendation function | IMPLEMENTED AND TESTED | deploy/test_capacity.py; synthetic samples only |
| Metrics collection, capacity dashboard and alert delivery | NOT IMPLEMENTED | no real collection/dashboard/alerts |
| Small/larger/multi-server migration and rollback | PARTIALLY IMPLEMENTED | runbooks only; no rehearsal; no zero-downtime claim |
| Windows unsigned installer/native startup recipes | IMPLEMENTED BUT UNVERIFIED | previous CI fixtures provide limited evidence; not rebuilt/installed in current Linux audit |
| Signed installer, authenticated update chain/customer acceptance | BLOCKED BY EXTERNAL DEPENDENCY | signing credentials, hosted feed and actual Windows tests required |
| Dependency license inventories and notices tooling | PARTIALLY IMPLEMENTED | LICENSE_AUDIT.md and inventory; fresh npm scan15 moderate build-chain entries; final redistribution/model/legal review outstanding |
| Malaysian/Singapore PDPA legal review | BLOCKED BY EXTERNAL DEPENDENCY | no compliance certification; needs accountable legal/privacy review |
| Five-customer measured paid pilot | NOT IMPLEMENTED | no pilot outcomes; gates in PILOT_PLAN.md |

## Phase 1 follow-up

The baseline above remains an audit snapshot. Subsequent verified changes and test counts are recorded in [COMMERCIAL_READINESS.md](COMMERCIAL_READINESS.md). A fix to one row does not upgrade adjacent features or commercial readiness.
