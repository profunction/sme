# Windows development

Requires Windows 10/11, Node 24, Python 3.12 and a working desktop session. These steps are instructions only; cloud setup does not install anything on your computer.

```powershell
npm ci
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.lock.txt
npm run build
.venv\Scripts\python -m pytest backend/tests
$env:NIGHTBREW_SESSION_TOKEN = [guid]::NewGuid().ToString('N')
.venv\Scripts\python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

In another terminal run `npm run desktop`; enter the session token in the app. Start Ollama and pull a suitable model separately, or configure the backend's cloud environment variables described in README. `npm run package:win` builds the Electron shell, but does not bundle Python yet. Do not distribute it as a standalone product. Windows desktop, packaging and UI Automation tests have not been run in Linux cloud.

## Phase 2–4 workflow

Use AI & privacy to detect hardware and benchmark your installed Ollama model before recommending local AI. Cloud chat requires a configured model, global permission, confirmed provider pricing/budget and per-message consent. Windows BYOK uses native Credential Manager; no plaintext fallback is implemented. Hardware-bound benchmarks from Linux cloud cannot qualify a Windows machine automatically.

Business tools creates PDF/Word drafts, analyzes uploaded Excel, extracts local document text and manages restricted files/tasks. Review exact-task approvals there before deleting files or writing connector records. Emergency stop blocks new work and requests cancellation; it cannot reverse already dispatched requests.

The four ERP/POS/WMS/TMS connectors are development mocks. See CONNECTOR_GUIDE.md before configuring a real HTTPS API; scoped credentials and network access are required. All categories remain available in every plan.

Cloud validation includes backend tests and a Linux Chromium UI flow. This does not verify Windows Electron startup, Windows Credential Manager, Windows GPU detection or a Windows installer. Python is still started separately; these remain release prerequisites. No Windows automation is enabled through Phase 4.
