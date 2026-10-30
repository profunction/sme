# Implementation and verification status

| Phase | Implemented code | Verification still required |
|---|---|---|
| 1 — Desktop foundation | Electron/React, FastAPI/SQLite, authenticated local/cloud chat | Real Windows/customer runtime and live AI providers |
| 2 — Hybrid AI | Hardware detection, local benchmark, hardware-bound routing, privacy, vault path, usage/budgets | Windows GPU/vault test results, actual model performance |
| 3 — Business automation | PDF/Word drafts, Excel, extraction, restricted files, approval/history/cancellation | Production parser isolation/malware scan; customer document compatibility |
| 4 — Connectors | Generic REST, mock ERP/POS/WMS/TMS, permissions/audit/retry/rates, all-plan access | Authorized real vendor API/integration tests |
| 5 — Computer automation | Deterministic approved browser/Windows UIA plans, screenshots and result verification | Browser workflow passed locally; Windows UIA/target applications must pass Windows CI/customer tests |
| 6 — Digital workforce | Employee roles/instructions, scoped tools/connectors, assignments/history, spending/task limits | Customer end-to-end acceptance; no autonomous unrestricted AI scheduler is promised |
| 7 — Commercial foundation | Separate trusted authority, signed grants, device/employee/task quotas, mock/Stripe billing, credits/gateway, add-ons/catalog | Deploy secure service; configure merchant/webhooks/provider; validate real test-mode payments and reconciliations |
| 8 — Windows release engineering | Managed backend/IPC, PyInstaller, signing/update configurations, Windows build/install tests and artifact workflows | Windows development CI passed; actual signed installer/update chain, publisher certificate, hosted feed, customer acceptance and release approval remain |

Cloud remains Linux and no customer machine has been modified. Code implementation, cloud validation, Windows CI execution, production deployment and commercial release are separate outcomes. Never claim Windows/vendor/payment/signing verification based only on mocks or configured workflows.
