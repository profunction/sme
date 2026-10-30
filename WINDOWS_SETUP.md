# Windows development and installation

All current development happened in cloud; these instructions do not install anything on your computer automatically. Requires Windows 10/11, Node 24, Python 3.12 and an interactive desktop.

```powershell
npm ci
npm run desktop:install
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.lock.txt
npm run build
.venv\Scripts\python -m pytest backend/tests -q
npm run test:desktop
npm run desktop
```

Electron now starts/stops its own backend and supplies a private session automatically. Do not start another backend on port 8765 first. For browser development only, run the backend manually and enter its token as described in README.

Development mode is labeled unpaid; it does not establish subscription entitlements. Packaged builds require a valid signed license from the configured trusted authority. Customer account keys and AI BYOK can be stored in Windows Credential Manager. Use the Subscription panel for activation and payments; see COMMERCIAL_BACKEND.md. Ollama/model installation and provider credentials are separate; no model is automatically downloaded. Benchmark your actual hardware before recommending local AI.

Computer tools accepts exact approved executable paths and deterministic plans, with human approval in Business tools. Windows UIA needs an interactive session and compatible controls; it is not universal support for every Windows program. Browser tasks use a fresh isolated Edge session by default. No unrestricted shell/AI-generated code execution exists. Employees assigns scoped roles/tools/connectors and persists task history.

To build an installer, install backend/requirements-build.txt into the venv and follow WINDOWS_RELEASE.md. Unsigned development artifacts are explicitly labeled; production requires a trusted public key, HTTPS license/update services and publisher signing certificate. The cloud Linux native build and browser tests are not Windows verification; inspect the Windows GitHub Actions results before using an installer. Signing/live payments/real vendor validation remain deployment prerequisites.
