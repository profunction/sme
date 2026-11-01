# Dependency and advisory review

The installed dependency inventory is recorded in [docs/python-dependencies.json](docs/python-dependencies.json) and [docs/node-dependencies.json](docs/node-dependencies.json), using distribution metadata and npm lockfile licenses. These are inventories, not a complete redistributable notice bundle.

| Direct dependency group | Declared licenses |
|---|---|
| React, React DOM, Vite, Tailwind, Electron, electron-builder | MIT |
| TypeScript | Apache-2.0 |
| FastAPI, httpx, pytest, keyring, openpyxl, python-docx | MIT |
| uvicorn, Starlette, psutil, pandas, pypdf | BSD family (typically BSD-3-Clause) |
| reportlab | BSD; preserve bundled font/third-party notices |
| Playwright (test tooling) | Apache-2.0 |
| pywin32-ctypes (Windows credential dependency) | MIT; Windows runtime not tested here |

These direct dependencies support commercial use subject to their license/notice conditions. Transitive dependencies include additional MIT/BSD/Apache-2.0 and font notices that must be retained. Electron bundles Chromium/Node and their third-party components; shipping the desktop runtime requires their complete notices. No model is bundled; Ollama models have separate weight licenses that must be checked individually. No project-wide license is granted by this document; the owner must select one before distribution.

The initial pins had known advisories. Electron, electron-builder, Vite, FastAPI/Starlette, pypdf and pytest were upgraded, followed by tests/build. Full `npm audit` (including development dependencies because Electron ships in the runtime) and `pip-audit` of the complete pinned Python lock reported **zero known vulnerabilities** on 2026-10-30. Future registry/advisory changes can alter this result. A passing scan is not a security certification or a Windows distribution audit.

Recheck with `npm audit`. Python advisory scanning can use `pip-audit -r backend/requirements.lock.txt --no-deps --disable-pip` with a writable cache; the lock enumerates the complete installed graph. Audit tooling is not a runtime dependency. Preserve TLS, package signatures and checksums; never bypass verification to install a dependency.

Phase 5–8 additions: Python Playwright (Apache-2.0), pywinauto (BSD-3-Clause), comtypes (MIT), pywin32 (PSF family), electron-updater (MIT), and PyInstaller build tooling (GPL with its documented bootloader exception allowing proprietary/commercial bundled applications). Preserve their notices and exception terms. Windows-only metadata/runtime and signing/distribution notices still require Windows release review. Build tooling is separate from the runtime lock.

Final Phase 8 scans also covered the installed Linux build environment. The venv's old pip was upgraded to 26.2 to resolve build-tool advisories; the subsequent complete installed Python and full npm scans reported no known vulnerabilities. Windows-only runtime and certificate-chain verification remain separate. Packaging collects installed public license texts into THIRD-PARTY-NOTICES.txt and includes Electron's Chromium notice file; final legal review is still required.

2026-11-01: refreshed upstream comparison in [OPEN_SOURCE_RESEARCH.md](OPEN_SOURCE_RESEARCH.md). Corrected TypeScript to Apache-2.0; no new runtime packages were added for the customer GUI.
