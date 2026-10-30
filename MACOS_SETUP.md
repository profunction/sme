# Run NightBrew on macOS

The initial supported baseline is macOS 15 or later (the CI validation platform). Apple Silicon (M1/M2/M3/M4 and later) uses **arm64**; Intel uses **x64**. In Apple menu → About This Mac, check Chip/Processor. Builds include Electron and Python; end users do not need Node or Python.

## Download the development app

Open [macOS build runs](https://github.com/profunction/sme/actions/workflows/macos.yml), select a successful run, and download the artifact matching your processor (GitHub login required). Unzip the artifact, open its DMG, and drag NightBrew AI Employee to Applications. The ZIP inside the artifact is an alternative application distribution. SHA256SUMS.txt records package checksums.

These are unsigned, unnotarized development builds. macOS may block opening them. Only if you trust this repository and build, use System Settings → Privacy & Security → Open Anyway after the first launch attempt. Do not disable Gatekeeper globally. Organization-managed Macs may require administrator approval. Production distribution still needs an Apple Developer certificate and notarization.

The packaged application enforces the existing license policy: a trusted licensing service and device activation are required for licensed actions. A development installer does not bypass licensing or provide paid AI credits. For a functional local development session without production licensing, run from source below.

## Run from source on your Mac

Install Node 24 and Python 3.12 first. In a terminal:

```bash
git clone https://github.com/profunction/sme.git
cd sme
npm ci
npm run desktop:install
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-build.txt
npm run build
npm run desktop
```

The app starts its backend automatically. Quit the app to stop the backend; port 8765 must be free. Store provider and account keys using Settings (macOS Keychain). macOS may request Keychain access; do not share keys in chat. App data and logs are under `~/Library/Application Support/NightBrew AI Employee/` for packaged builds (the development app name may differ).

For local inference, install Ollama separately, run it, and download a model suitable for your memory. NightBrew does not download models automatically. Cloud inference needs your own configured provider key or a configured company gateway.

## Compatibility

Chat, document generation, spreadsheet analysis, task approvals, employees, connectors and billing UI share the existing application. Key storage uses the explicit macOS Keychain backend, never a plaintext fallback. Windows UIA desktop automation remains Windows-only; no macOS native application automation is claimed. Browser automation requires a separately installed compatible browser and an explicitly configured executable path. Apple unified memory is not reported as dedicated GPU VRAM; suitability still requires a real Ollama benchmark.

## Build on macOS

```bash
source .venv/bin/activate
npm run package:mac:unsigned
```

Build separately on Apple Silicon and Intel so the bundled Python backend matches Electron. CI validates both architectures, backend authentication and packaged application startup. These checks do not replace real-machine Gatekeeper, Keychain, local-model and customer integration acceptance testing. The Windows production signing workflow remains Windows-only; macOS signed updates and notarization are not configured.

### Intel source builds

The pinned cryptography release builds from source on Intel macOS. Before installing Python requirements, install Homebrew `openssl@3`, ensure Rust/Cargo and Xcode command-line tools are available, and export:

```bash
export OPENSSL_DIR="$(brew --prefix openssl@3)"
export OPENSSL_STATIC=1
```

Use a fresh virtual environment when changing these flags. Static linking prevents the frozen cryptography extension from loading the older same-named OpenSSL library shipped with Python. CI sets these flags for Intel; Apple Silicon uses the official prebuilt wheel.
