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
