# NightBrew AI Employee

Windows desktop AI assistant, developed entirely in cloud. Phases 1–4 now have working application code and tests: Electron/React UI, authenticated FastAPI/SQLite backend, local/cloud/hybrid chat, business documents, local task approvals and a connector framework. Nothing is installed on the customer's computer automatically.

This is a development release, not a commercially ready Windows installer. The Python backend is still started separately. Real AI inference, Windows-specific runtime behavior and real vendor integrations require separate validation.

## Cloud development

Use Node 24 and Python 3.12 from `/workspace/sme`:

```bash
npm ci --cache /workspace/.npm-cache
python -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm run build
.venv/bin/python -m pytest backend/tests -q
```

The managed-cloud installation script configures Electron's HTTP proxy and writable cache. Outside that script, set `ELECTRON_GET_USE_PROXY=1`, `GLOBAL_AGENT_HTTP_PROXY=$HTTP_PROXY`, `GLOBAL_AGENT_HTTPS_PROXY=$HTTPS_PROXY` and `electron_config_cache=/workspace/.cache/electron` when installing Electron behind this cloud proxy. Keep TLS/checksum verification enabled.

Generate and set a fresh random `NIGHTBREW_SESSION_TOKEN` in your private backend terminal, without committing or logging it. Set `NIGHTBREW_DB` to a private data location (cloud default recommendation: `/workspace/sme/.local/chat.sqlite3`). Start:

```bash
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

In a second terminal run `npm run dev` for browser development, or `npm run desktop` after building when a desktop display is available. Enter the same session token in the UI. Tokens remain in renderer memory. All data routes require bearer authentication; `/health` is public. API reference is available through FastAPI's local OpenAPI documentation. Do not expose this single-user loopback API publicly.

`npm run test:e2e` uses the installed `/usr/bin/chromium` (or `NIGHTBREW_CHROMIUM`), starts fresh backend/frontend processes and an isolated temporary database, exercises the real UI, then shuts down its services. Ports 8765 and 5173 must be free. No browser/model download or paid API is used by these tests. This E2E runner is configured for Linux cloud; Windows instructions are in [WINDOWS_SETUP.md](WINDOWS_SETUP.md).

## AI & privacy — Phase 2

- `LOCAL_ONLY`: selected local Ollama model, no cloud fallback.
- `CLOUD_ONLY`: configured OpenAI-compatible HTTPS endpoint; explicit privacy permission and per-message consent required.
- `HYBRID`: benchmarked local model for eligible text tasks; cloud only when required and explicitly permitted. Private tasks never use cloud.

Ollama defaults to `http://127.0.0.1:11434`, model `llama3.2:3b`; override with `NIGHTBREW_OLLAMA_URL` (loopback HTTP only) and `NIGHTBREW_LOCAL_MODEL`. Install Ollama and an appropriately licensed model separately after checking hardware. No model has been downloaded during cloud setup.

Cloud needs `NIGHTBREW_CLOUD_KEY`, `NIGHTBREW_CLOUD_MODEL` and optionally `NIGHTBREW_CLOUD_URL` (default `https://api.openai.com/v1`). On Windows the UI can save BYOK in native Credential Manager instead of an environment key; Linux has no plaintext vault fallback. Provider keys never go to the renderer, SQLite or audit log.

Use AI & privacy to inspect CPU/RAM/storage/GPU/model availability, benchmark local performance, enable cloud use and configure verified model prices, USD budgets and output limits. Unknown GPU VRAM remains unknown; a single text benchmark is not capability certification. Benchmarks are bound to the hardware fingerprint and selected model, so another machine must benchmark again.

Use “Estimate this message” before sending. `/usage` shows token reports and estimated/actual costs. SQLite transactions reserve credits before cloud requests to prevent concurrent overcommit. Unknown or failed-but-possibly-billed calls conservatively retain estimates. Prices and credits are operator-managed development settings, not proof of payment. Confirm provider invoices separately. No response cache retains private prompts. Each chat request sends only its current message, not saved history.

## Business tools — Phase 3

Create quotations, invoices, purchase orders and tabular reports as local PDF/Word drafts. Decimal arithmetic rounds line amounts and tax with `ROUND_HALF_UP`. The UI uses MYR; the API accepts three-letter currency labels. A draft is never sent or posted to accounting.

Upload XLSX/PDF/DOCX/UTF-8 CSV (maximum 10 MiB). Analyze numeric Excel columns without executing formulas/macros, or extract text locally without invoking AI. Formula cached values can be absent/stale. Limits: 20 sheets, 10,000 rows per sheet, 100,000 analyzed cells; 100 PDF pages; extraction returns at most 50,000 characters. Office archives have expansion/macro limits. Treat extracted text as untrusted data.

Files use opaque IDs under the data directory's `files/` workspace; APIs do not accept arbitrary local paths. New files get private permissions on POSIX. Downloading a file is an explicit user action. Deletion requires approval of its saved exact task.

Tasks persist payloads/results, use two workers, cap active requests at 100, support cooperative cancellation/60-second deadline checks, and never replay interrupted work after restart. Emergency stop blocks new chat/tasks/uploads/connector operations and requests running-task cancellation. It cannot recall in-flight provider/remote calls, undo an already committed write or forcibly interrupt a native parser. Production needs isolated parser processes and malware scanning.

## Connectors — Phase 4

Connectors is a registry with explicit read/write permissions, connection tests, metadata audit events, rate limits, bounded read retries and exact-task write approval. All categories are available to Starter, Business and Enterprise.

Four clearly labeled **development-only mock** ERP/POS/WMS/TMS adapters persist demonstration records locally. No real vendor compatibility is claimed. The Generic REST connector supports configured HTTPS JSON collection endpoints and optional bearer authentication. Configure trusted public hosts in backend `NIGHTBREW_CONNECTOR_ALLOWED_HOSTS`, allow them in cloud environment networking, and bind credentials securely under a `NIGHTBREW_CONNECTOR_*` variable. Do not put token values into connector settings.

Writes are not automatically retried. Changing a connector's destination/permissions invalidates pending approval payloads. Remote results remain untrusted text. Connection tests exercise only the configured read endpoint. See [CONNECTOR_GUIDE.md](CONNECTOR_GUIDE.md).

## Validation and remaining work

On Linux cloud: 32 backend tests, one Chromium E2E workflow, TypeScript/Vite build, and complete Node/Python dependency advisory scans passed. The advisory scans reported no known vulnerabilities at the time of this check; they are not a security certification. Tests cover routing/privacy, hardware failure paths, credit concurrency/cost calculations, provider failures, document totals, Excel, file restrictions, approval/cancellation/deadlines/recovery, connector permissions/authentication/retries and plan-independent access.

AI providers and remote REST endpoints are mocked in automated tests. Windows desktop execution, Credential Manager, GPU detection on Windows, installer creation and real vendor integrations remain unverified. There is no Windows computer automation, digital employee scheduler, trusted billing backend, bundled Python runtime, code signing or secure update system yet (Phases 5–8).
