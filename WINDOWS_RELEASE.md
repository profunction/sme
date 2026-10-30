# Windows release engineering — Phase 8

## What is implemented

Electron owns a sandboxed renderer and launches a private Python backend automatically. It generates a new high-entropy session token and instance ID per launch, binds loopback only, verifies an authenticated instance handshake, and exposes only session/update operations through validated main-frame IPC. The renderer receives no Node/filesystem/shell access. An existing unrelated service on port 8765 is never reused or terminated. The owned backend process tree is stopped on exit/update; backend logs rotate under the app data directory. Unexpected backend exit is reported.

PyInstaller builds the Python runtime/dependencies into a standalone one-directory backend. Electron-builder includes that directory, public release policy and dependency inventory in the installer. Windows uses an installed Edge for controlled browser tasks; no model/browser is automatically downloaded onto a customer computer. The licensing authority, payment credentials and signing private key are excluded from the desktop package. Packaged builds always enforce signed licensing and reject mock grants.

Production update metadata must be HTTPS and the installer must match the configured Authenticode publisher. electron-updater validates downloaded artifacts; auto-download/auto-install are off until the user requests them. The user checks/downloads and then explicitly installs after saving work. Publishing is disabled in packaging commands; uploading a candidate to customers/update hosting is a separate release operation.

## Build

On Windows with Node 24/Python 3.12:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-build.txt
npm ci
python -m pytest backend/tests -q
npm run test:desktop
npm run package:win:unsigned
```

This produces an explicitly named `NightBrew-DEV-UNSIGNED-...exe` installer, unsuitable for commercial distribution. It still enforces licensing; it does not turn mock data into payment entitlements. It can validate managed backend startup with `NightBrew AI Employee.exe --smoke-test`, which starts/authenticates/stops its own backend and exits with a status code. The smoke option does not bypass licensing for application operations.

For a signed production candidate, configure `NIGHTBREW_RELEASE_PUBLIC_KEY` (base64url Ed25519 public key), `NIGHTBREW_RELEASE_LICENSE_URL`, `NIGHTBREW_RELEASE_UPDATE_URL` (HTTPS), exact `NIGHTBREW_SIGNING_PUBLISHER`, `CSC_LINK` and `CSC_KEY_PASSWORD` securely; then `npm run package:win`. Missing production requirements fail the build. Signing certificates/merchant keys cost or account setup must be supplied by the owner; none are invented or committed.

The signing public key/URLs/publisher are embedded in the generated release policy. Authority signing private keys and payment/provider secrets belong on the separately deployed service. Verify signatures, installer behavior, update/rollback behavior, licensing expiry, virus scanning and target customer hardware before distribution. Keep all third-party notices, including PyInstaller's bootloader exception, Electron/Chromium/Node and ReportLab fonts.

## CI and evidence

`.github/workflows/validate.yml` runs Linux backend/desktop/UI tests and a Windows job that tests native UIA + Credential Manager, builds a development installer, runs the unpacked executable, silently installs it and runs the installed executable. It uploads the unsigned development installer as a short-lived artifact. Workflows use pinned action commits and read-only repository permissions.

`.github/workflows/production-package.yml` is manual only and uses the protected `release` environment. Supply public variables and signing secrets there. It uploads a signed candidate without publishing it.

This development session runs Linux. The native Linux PyInstaller build and managed backend can be validated here; they do not establish Windows installer or Windows UIA success. Windows CI results must be inspected after pushing. Real signing/update-chain verification needs the owner's certificate and hosted feed. Do not advertise production readiness before those checks pass.

The Linux Electron window/IPC smoke also passed using the test-only headless Ozone flag. That path dispatches the navigation event programmatically because the headless window has no normal animation/input surface; Chromium UI E2E tests exercise real clicks separately. This is not a Windows desktop-input or OS-sandbox verification result.

## Verified development candidate

[Windows workflow run 41037603208](https://github.com/profunction/sme/actions/runs/41037603208) passed for source commit a5f9c1a. It executed native UIA/vault and Electron checks, built the full Python/Electron package, authenticated the copied backend, smoke-started the unpacked application, silently installed NSIS and smoke-started the installed application. The development artifact is approximately 187 MB and retained for 7 days. It is unsigned and is not a formal commercial release.

The release configuration now preserves the complete package.json build settings; a regression test prevents dropping backend resources, preload files, product naming or installer policy when applying signing overrides.
