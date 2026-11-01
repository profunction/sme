# NightBrew AI Employee — 0.8.0 development release

A Windows and macOS desktop AI workforce application developed entirely in cloud. Application code for Phases 1–8 is present: chat/hybrid AI, business documents, connectors, approved computer tools, scoped employees, trusted licensing/billing, managed backend startup and release pipelines. Nothing has been installed on the customer's computer.

**This is not yet a verified commercial Windows release.** Windows CI has passed native UIA/vault, managed Electron, frozen backend and NSIS installation/startup checks; the [verified run](https://github.com/profunction/sme/actions/runs/41037603208) contains the unsigned development installer. Real model inference, merchant payments, deployed licensing/gateway services, code signing and signed update-chain validation require their actual runtime/owner configuration. See [ROADMAP.md](ROADMAP.md) for implementation versus verification status.

## Start in cloud

Use Node 24 / Python 3.12 in `/workspace/sme`:

```bash
npm ci --cache /workspace/.npm-cache
npm run desktop:install
python -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm run build
.venv/bin/python -m pytest backend/tests -q
npm run test:desktop
npm run test:e2e
```

The saved managed-cloud install script supplies Electron's proxy and writable cache (`ELECTRON_GET_USE_PROXY`, `GLOBAL_AGENT_HTTP_PROXY/HTTPS_PROXY`, `electron_config_cache`). Electron 45 downloads its binary explicitly through `desktop:install`; TLS/checksum verification stays enabled. Cloud uses the existing Chromium for browser automation: `NIGHTBREW_BROWSER_EXECUTABLE=/usr/bin/chromium`.

For desktop development with a display, **do not start a manual backend first**: `npm run desktop` now launches Python, verifies its private session, authenticates the renderer automatically and stops its owned process tree on exit. Data/logs are stored in Electron's per-user app data directory. Only one instance runs; an unrelated service on port 8765 is never adopted or killed.

For browser-only development, set a fresh private `NIGHTBREW_SESSION_TOKEN` (at least 32 random characters; do not log/commit it), optionally `NIGHTBREW_DB=/workspace/sme/.local/chat.sqlite3`, then start `.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765` and `npm run dev` in separate terminals. Enter that same token in the UI. All data routes require it; `/health` is public. Do not expose this single-user loopback API publicly.

## Features

| Area | Working implementation |
|---|---|
| AI & privacy | Local/cloud/hybrid text chat, hardware/model inspection, measured hardware-bound local benchmark, private-task cloud denial, per-request consent, BYOK vault path, transactional budgets/token tracking |
| Business tools | Decimal-calculated quotations/invoices/purchase orders/tabular reports as PDF/Word drafts, Excel numeric analysis, PDF/Word/CSV text extraction, restricted file IDs, task history/approval/cancellation/emergency stop |
| Connectors | Generic HTTPS JSON REST adapter, explicitly labeled mock ERP/POS/WMS/TMS, separate read/write permissions, audited tests, bounded read retries/rate limits, exact-payload write approvals |
| Computer tools | Explicit Playwright plans: read/click/fill/keys/screenshots/verification; Windows UIA adapter for approved executables/windows/controls; every automation plan requires human approval |
| Employees | Names/roles/instructions, scoped tools/connectors, assigned jobs/history, employee spending/task caps, active/paused state, permission rechecks before execution; select employees in chat |
| Subscriptions | Separate authority, Stripe Checkout/Portal/webhooks plus explicit mock development billing, signed device grants, server-side seat/device/task quotas, purchased credits and trusted included-AI gateway; built-in connector catalog/custom fees |
| Desktop/release | Automatic backend process lifecycle, validated minimal IPC, packaged Python build, rotating logs, unsigned-development/signed-production installer configurations, opt-in publisher-verified updates, Windows CI tests/build/install smoke |

Computer plans and employee jobs are explicitly assigned by the user. Model output is never unrestricted code and does not autonomously control tools. A generated invoice is a local draft, not an accounting posting or sent message. Mock connectors do not establish real vendor support. Every existing connector/category is available to Starter, Business and Enterprise.

## AI setup

Ollama defaults to `http://127.0.0.1:11434`, model `llama3.2:3b` (`NIGHTBREW_OLLAMA_URL` is loopback HTTP only; `NIGHTBREW_LOCAL_MODEL` overrides model). No model was downloaded. Check hardware/model licensing and benchmark before recommending Local AI; unknown GPU VRAM stays unknown. Benchmarks are specific to machine/model, not broad capability certification.

BYOK cloud requires `NIGHTBREW_CLOUD_KEY`, `NIGHTBREW_CLOUD_MODEL`, optionally HTTPS `NIGHTBREW_CLOUD_URL` (default OpenAI `/v1`). Windows stores keys in Credential Manager and macOS uses Keychain; Linux uses secure backend environment bindings. Global cloud permission plus per-message consent are required; private tasks never use cloud and provider failure never silently falls back. Employee role/instructions become system context while permissions remain backend-enforced.

INCLUDED cloud uses the separately deployed trusted gateway. Company provider keys/purchased credits stay on the authority, never on the desktop. The gateway quotes/reserves using server prices and reconciles provider usage; local company/employee limits add a second control. Unknown billing retains estimates. These controls are not a guarantee of the provider invoice. Each chat sends only its current message plus selected employee instructions, not all saved history.

## Data and approvals

Uploads: XLSX/PDF/DOCX/UTF-8 CSV up to 10 MiB. Excel: at most 20 sheets, 10,000 rows/sheet and 100,000 cells, without formula/macro execution; cached formulas can be stale/absent. PDF: 100 pages; extracted text is capped at 50,000 characters and treated as untrusted data. Screenshots are generated local PNG artifacts. File APIs never accept arbitrary local paths. Data is plaintext under OS account permissions; production still needs parser process isolation/malware scanning and an at-rest encryption policy.

All deletions, connector writes and automation require exact-task approval. Employee policy and destination snapshots are immutable and rechecked. Tasks use two workers, at most 100 active requests and cooperative 60-second deadline/cancellation checks. Restarted work is never replayed. Emergency stop cannot undo already sent remote requests or forcibly stop a native parser. Reconcile unknown external write outcomes before retrying.

## Licensing and payments

Development explicitly runs without payment enforcement; this is not proof of paid entitlements. Packaged builds always enforce trusted licensing and reject mock grants. The authority is deployed separately with HTTPS/private storage/signing key; desktop holds only a public key, account credential and short-lived signed device grant. Local SQLite cannot manufacture payment status. Licensed operations/employee seats also reserve online quotas and fail closed on authority failure. Activation, account/credits, checkout and update controls appear under Subscription.

See [COMMERCIAL_BACKEND.md](COMMERCIAL_BACKEND.md) for server deployment/configuration, Stripe signature/idempotency/canonical-state checks, BYOK versus included credits, fees, privacy and limitations. No actual payment or live paid inference was made during development. Shipping requires owner-supplied service URLs, customer account setup and certificate; signing and merchant secrets never belong in the desktop artifact.

## Testing and release

- `.venv/bin/python -m pytest backend/tests -q`: routing, hardware, costs/concurrency, documents, files, real local browser automation, workforce permissions, signed licensing, authority quotas/gateway/payment failure paths. Windows UIA/vault tests explicitly skip on Linux.
- `npm run test:desktop`: process/session lifecycle, production secret exclusion, fail-closed release preparation, native frozen backend when built.
- `npm run test:e2e`: two real Chromium UI workflows with isolated temporary databases; needs free ports 8765/5173. Set `NIGHTBREW_CHROMIUM` if the browser is elsewhere.
- `npm run test:electron`: actual Electron window, automatic session IPC and authenticated UI; needs a desktop or the Linux test-only headless flag. Headless tests disable the OS sandbox for the test process and do not validate production OS sandbox enforcement.
- Windows workflows test native UIA/Credential Manager, Electron IPC, package Python, build an unsigned installer, test unpacked startup and silent install. A separate manual workflow builds signed candidates without publishing.

See [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md), [WINDOWS_SETUP.md](WINDOWS_SETUP.md), [AUTOMATION.md](AUTOMATION.md), [WORKFORCE.md](WORKFORCE.md), [CONNECTOR_GUIDE.md](CONNECTOR_GUIDE.md), [SECURITY.md](SECURITY.md) and [LICENSE_AUDIT.md](LICENSE_AUDIT.md). Do not equate Linux/mock tests or CI configuration with a verified Windows commercial release.

Current cloud limitation: external Chromium HTTPS cannot be called verified under the ordinary filesystem sandbox while its NSS database is outside writable roots. A proposed trust-store relocation was rejected by automatic approval review and was not executed; see AUTOMATION.md. Local browser automation and the Electron IPC smoke pass without disabling TLS verification. Windows/browser/vendor acceptance remains separate.

## macOS

See [MACOS_SETUP.md](MACOS_SETUP.md) for Apple Silicon and Intel builds, local development and platform limitations.

## Customer workspace — 0.9

The redesigned customer GUI adds a real-status dashboard, a Chinese first-use guide, six editable prompt templates, four employee role presets, plain-language approval review, three persistent appearance themes, and model/provider configuration in the GUI. Template use never automatically calls AI or grants tools; cloud consent remains per message. Changing cloud provider/model clears cloud permission and pricing confirmation. Browser development credentials stay in memory; the desktop uses its existing automatic IPC session.

Start with [CUSTOMER_GUIDE.md](CUSTOMER_GUIDE.md). [OPEN_SOURCE_RESEARCH.md](OPEN_SOURCE_RESEARCH.md) records the refreshed upstream comparison and licensing exceptions. This GUI work does not establish production signing/notarization, deployed paid services, knowledge-base retrieval, or real-vendor acceptance.
