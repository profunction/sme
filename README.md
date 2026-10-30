# NightBrew AI Employee

Phase 1 Windows desktop foundation: Electron + React + TypeScript + Vite + Tailwind; FastAPI and SQLite; authenticated local chat with Ollama or an OpenAI-compatible HTTPS provider. Development takes place in cloud; nothing installs on the customer's computer automatically.

## Cloud development

Node 24 and Python 3.12 are used. Run `npm ci`, `python -m venv .venv`, and `.venv/bin/pip install -r backend/requirements.lock.txt`. Run `npm run build` and `.venv/bin/python -m pytest backend/tests`.

Set `NIGHTBREW_SESSION_TOKEN` to a freshly generated random session token in your terminal without committing it. Start `.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765`. Run `npm run dev` for browser development or, with a desktop display, `npm run desktop` after building. Enter the same session token in the UI. No default credential exists. Health: `GET /health`; authenticated history: `GET /messages`.

Ollama defaults to `http://127.0.0.1:11434`, model `llama3.2:3b`; override with `NIGHTBREW_OLLAMA_URL` and `NIGHTBREW_LOCAL_MODEL`. Install and pull a compatible model separately after checking hardware and model license. Cloud mode needs `NIGHTBREW_CLOUD_KEY`, `NIGHTBREW_CLOUD_MODEL`, and optionally `NIGHTBREW_CLOUD_URL` (default `https://api.openai.com/v1`). Never enter provider keys in the renderer or commit them. Each cloud message requires explicit consent. Each request is independent; saved history is not sent automatically.

No paid API or model download is required for automated tests. Provider tests use mocks, not live inference. Windows execution, live providers and installer validation require their respective runtime/access and remain unverified. Backend packaging, managed startup, Credential Manager, hybrid routing and commercial billing are future work. `package:win` is a packaging scaffold, not a release-ready installer.

## Phase 2: Hybrid AI

Use AI & privacy to inspect hardware, explicitly benchmark your installed local model, configure cloud permission, provider pricing and local development budgets. HYBRID selects a successfully benchmarked local model for eligible text tasks; complex local tasks require a declared capability. Private tasks never use cloud. No fallback occurs after provider failures. Cloud inference also requires per-message consent, configured model/key, confirmed pricing and available budget. `POST /ai/estimate` previews routing/cost without inference. `/usage` shows actual reported tokens or conservatively retained estimates when usage/billing is unknown. Reservations are transactional to prevent concurrent overcommit. USD allowances are local controls, not purchased credit entitlements. No paid billing is implemented.

Windows BYOK uses the native Windows keyring backend via `/settings/cloud-key`; Linux uses `NIGHTBREW_CLOUD_KEY`. No plaintext key fallback. Windows hardware queries and Credential Manager remain untested on Windows. GPU VRAM is unknown where reliable measurements are unavailable. A benchmark is a single text sample, not a broad capability certification.

## Phase 3: Business tools

Business tools creates deterministic MYR quotations, invoices, purchase orders and tabular reports as PDF/Word drafts. Decimal arithmetic rounds each line and tax with ROUND_HALF_UP. Upload XLSX/PDF/DOCX/UTF-8 CSV (10 MiB maximum); analyze numeric Excel columns without executing formulas, or extract document text without passing it to AI. Generated/downloaded files use opaque IDs in the database's `files/` workspace; APIs never accept arbitrary filesystem paths. Customer documents remain local unless the user explicitly copies text into a consented cloud chat.

Tasks have persisted history, bounded two-worker execution, cooperative cancellation/deadline checks, and exact-payload human approval for deletion. Emergency stop blocks new chat/tasks/uploads and requests cancellation of ongoing jobs; it cannot recall already dispatched external requests. Tasks interrupted by backend restart are never automatically replayed. Uploaded Office archives have size/expansion/macro limits. Parser deadlines are cooperative, not a hardened process sandbox. Use trusted business files during development; production needs parser isolation and malware scanning.

An invoice draft is not posted to any accounting system. No email is sent. Approval requests and results are visible in Business tools; `/audit` contains metadata-only events. Chat/document contents and provider keys are never copied into audit records.
