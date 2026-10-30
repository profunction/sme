# NightBrew AI Employee

Phase 1 Windows desktop foundation: Electron + React + TypeScript + Vite + Tailwind; FastAPI and SQLite; authenticated local chat with Ollama or an OpenAI-compatible HTTPS provider. Development takes place in cloud; nothing installs on the customer's computer automatically.

## Cloud development

Node 24 and Python 3.12 are used. Run `npm ci`, `python -m venv .venv`, and `.venv/bin/pip install -r backend/requirements.lock.txt`. Run `npm run build` and `.venv/bin/python -m pytest backend/tests`.

Set `NIGHTBREW_SESSION_TOKEN` to a freshly generated random session token in your terminal without committing it. Start `.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765`. Run `npm run dev` for browser development or, with a desktop display, `npm run desktop` after building. Enter the same session token in the UI. No default credential exists. Health: `GET /health`; authenticated history: `GET /messages`.

Ollama defaults to `http://127.0.0.1:11434`, model `llama3.2:3b`; override with `NIGHTBREW_OLLAMA_URL` and `NIGHTBREW_LOCAL_MODEL`. Install and pull a compatible model separately after checking hardware and model license. Cloud mode needs `NIGHTBREW_CLOUD_KEY`, `NIGHTBREW_CLOUD_MODEL`, and optionally `NIGHTBREW_CLOUD_URL` (default `https://api.openai.com/v1`). Never enter provider keys in the renderer or commit them. Each cloud message requires explicit consent. Each request is independent; saved history is not sent automatically.

No paid API or model download is required for automated tests. Provider tests use mocks, not live inference. Windows execution, live providers and installer validation require their respective runtime/access and remain unverified. Backend packaging, managed startup, Credential Manager, hybrid routing and commercial billing are future work. `package:win` is a packaging scaffold, not a release-ready installer.
