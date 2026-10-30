# Validation evidence — cloud development, 2026-10-30

| Check | Observed outcome and scope |
|---|---|
| Python backend suite | 49 passed, 2 Windows-only tests skipped on Linux; includes a real local Chromium action/screenshot run, workforce permissions, signed grants, online quotas and mocked Stripe/provider flows |
| Node desktop suite | 4 passed: secret/config boundary, actual managed backend authentication, native frozen backend from resource layout without project source, production release fail-closed preflight |
| Chromium application E2E | 2 passed: business draft/approved WMS write/emergency stop; employee creation/assignment/approval and unpaid development status |
| Electron integration | Passed in Linux Ozone headless test mode: automatic private session through restricted IPC, authenticated UI, update bridge; programmatic navigation in this headless test, not Windows physical input or OS-sandbox verification |
| Python native packaging | PyInstaller Linux standalone directory built; its managed resource startup/authentication and licensing fail-closed behavior passed. This is not a Windows executable/installer test |
| External browser | github.com read/expected-content verification passed via the existing proxy and TLS verification in an approved one-off filesystem context; ordinary sandbox NSS write restriction remains documented |
| TypeScript/Vite | Build passed |
| Ruff / Git whitespace | Passed |
| Complete npm and installed Python/build advisory scans | No known vulnerabilities reported after upgrading the venv's pip to 26.2; not a security certification or Windows-only dependency audit |

No live paid AI call, real Stripe payment, vendor ERP/POS acceptance, Windows signing certificate, hosted update feed or production authority deployment was used. Real Windows UIA/vault/Electron/NSIS installation checks are defined in the pinned-action Windows workflow and need their actual CI results after pushing. A separate manual production workflow validates signatures/publisher and smoke-starts a candidate; no artifact is auto-published.

Do not count skipped tests as passed, simulated payments as real, mock connectors as vendors, or a configured workflow as executed Windows verification. Production still requires TLS hosting/backup/abuse controls, owner merchant/signing configuration, parser isolation/malware scan, final license review and customer acceptance.

A proposed persistent cloud NSS relocation was rejected by automatic approval review as a broader security/configuration change without explicit authorization. It was not executed. The approved one-off read-only browser check used the existing database without relocating it or bypassing TLS.
