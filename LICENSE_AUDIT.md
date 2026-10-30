# Dependency license review

Direct dependencies: React/React DOM, Vite, TypeScript, Tailwind CSS, Electron, electron-builder, FastAPI, httpx and pytest use MIT; uvicorn uses BSD-3-Clause. React type packages use MIT. These generally permit commercial distribution subject to notices.

This is a preliminary direct-dependency review, not a complete distribution audit. Electron includes Chromium/Node and their third-party notices; installed transitive license reports are saved outside the checkout under /workspace/nightbrew-license-report.json. Review all bundled components and include required notices before release. No AI model is bundled: Ollama model weights have separate licenses. Future planned Python/automation packages are not installed or audited yet. No product-wide license is granted by this document; the owner must choose a repository license before distribution.
