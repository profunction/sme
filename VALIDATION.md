# Validation evidence — cloud development, 2026-10-30

| Check | Observed outcome and scope |
|---|---|
| Python backend suite | 50 passed, 2 Windows-only tests skipped on Linux; includes a real local Chromium action/screenshot run, workforce permissions, signed grants, online quotas and mocked Stripe/provider flows |
| Node desktop suite | 5 passed: resource-config regression, secret/config boundary, actual managed backend authentication, native frozen backend from resource layout without project source, production release fail-closed preflight |
| Chromium application E2E | 2 passed: business draft/approved WMS write/emergency stop; employee creation/assignment/approval and unpaid development status |
| Electron integration | Passed in Linux Ozone headless test mode: automatic private session through restricted IPC, authenticated UI, update bridge; programmatic navigation in this headless test, not Windows physical input or OS-sandbox verification |
| Python native packaging | PyInstaller Linux standalone directory built; its managed resource startup/authentication and licensing fail-closed behavior passed. This is not a Windows executable/installer test |
| External browser | github.com read/expected-content verification passed via the existing proxy and TLS verification in an approved one-off filesystem context; ordinary sandbox NSS write restriction remains documented |
| Windows CI | [Run 41037603208](https://github.com/profunction/sme/actions/runs/41037603208) succeeded for a5f9c1a: backend/native UIA/vault, managed Electron, frozen backend, unpacked startup, silent NSIS installation and installed startup checks passed. Unsigned development artifact: NightBrew-Windows-DEV-UNSIGNED, approximately 187 MB. |
| Directory package resources | Real Linux directory package includes copied backend, release policy and preload/runtime; the copied backend authenticated successfully. Authority source, backend tests and environment files are excluded from app.asar. |
| TypeScript/Vite | Build passed |
| Ruff / Git whitespace | Passed |
| Complete npm and installed Python/build advisory scans | No known vulnerabilities reported after upgrading the venv's pip to 26.2; not a security certification or Windows-only dependency audit |

No live paid AI call, real Stripe payment, vendor ERP/POS acceptance, Windows signing certificate, hosted update feed or production authority deployment was used. Windows UIA/vault/Electron/NSIS checks have now passed on the GitHub-hosted Windows runner in the linked run. This validates that fixture/runner, not every customer application or device. A separate manual production workflow validates signatures/publisher and smoke-starts a candidate; no artifact is auto-published.

Do not count skipped tests as passed, simulated payments as real, mock connectors as vendors, or a configured workflow as executed Windows verification. Production still requires TLS hosting/backup/abuse controls, owner merchant/signing configuration, parser isolation/malware scan, final license review and customer acceptance.

A proposed persistent cloud NSS relocation was rejected by automatic approval review as a broader security/configuration change without explicit authorization. It was not executed. The approved one-off read-only browser check used the existing database without relocating it or bypassing TLS.

## 0.9 customer GUI — 2026-11-01

- TypeScript/Vite build passed.
- Python suite: 67 passed, two Windows-only tests skipped on Linux. New coverage checks authenticated model configuration, persistent adapter routing, unsafe provider URL rejection, and invalidation of benchmark/cloud pricing permission.
- Six actual Chromium UI workflows passed: guided prompt construction, unsent drafts and default cloud consent, theme persistence, model configuration, real business draft/approval/emergency-stop flow, and employee assignment/license status. Narrow viewport checked for horizontal overflow.
- Six Node desktop checks and Linux Ozone Electron IPC/startup smoke passed. The pre-existing frozen-backend fixture test is not proof of a newly built native 0.9 package.
- Native Windows/macOS packaging is delegated to the existing CI pipelines after push; no new native-build result or production signature is claimed by these local checks.
- Live model quality, real payments/vendor connections, full accessibility audit, real-customer usability acceptance and Mac download/Gatekeeper acceptance remain outstanding. UI tests do not guarantee that every customer will understand the product.
