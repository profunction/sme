# NightBrew 0.9.4: AI connections and visible task results

## AI key setup

Open **AI & privacy** (AI 与隐私设置). The top panel provides the sequence:

1. Choose DeepSeek or configure an OpenAI-compatible text chat endpoint/model.
2. Paste your own provider key and save. Windows uses Credential Manager; macOS uses Keychain. Keys are cleared from the input after a save attempt and are never returned by the metadata endpoint or stored in localStorage. Linux developers must bind `NIGHTBREW_CLOUD_KEY` in the backend environment.
3. Explicitly consent to a model-list connection check. This sends the key to the configured provider, makes one GET `/models`, and sends no business content. A passing check verifies that read endpoint and whether the model is listed, **not inference, credits or full provider capabilities**. Providers without this endpoint cannot pass this check. Provider errors are sanitized, redirects rejected, responses limited to 2 MiB, and checks throttled to one per ten seconds.
4. Enter verified current input/output prices and a local USD spending cap. No live prices or provider balances have been verified by this implementation. Confirm pricing and paid API use, save, and explicitly open cloud chat. Each message still requires cloud data consent. Nothing is sent just by opening chat.

The wizard's budget allocation is local development protection, not purchased credits, a provider balance or a trusted commercial ledger. The provider can bill differently from locally estimated costs. Existing trusted gateway accounting remains separate. Employee cloud budgets default to zero; set an explicit individual budget to use cloud chat under an employee identity.

## Build modes

- `LOCAL-PREVIEW`: existing Ollama-only preview. Cloud inference remains blocked.
- `API-PREVIEW`: separate, explicitly unsigned development build for customer-owned keys and local Ollama. No paid NightBrew entitlement, shared cloud gateway, checkout or subscription service is provided. Production license enforcement is unchanged.
- `DEV-UNSIGNED` / signed production: existing licensing requirements remain in place.

Build commands: `npm run package:win:api` and `npm run package:mac:api`. Local preview commands remain unchanged. API preview uses an isolated `byok-preview/chat.sqlite3` below the application's existing data directory; previous local-preview data remains intact in its own directory and is not silently migrated. Native credential vault entries are shared across preview modes; switching provider does not create a new vault slot.

Windows CI builds and silently installs each variant. macOS CI includes an ARM64 API preview and verifies architecture, ad-hoc bundle integrity, native backend startup and owned-fixture boundaries. These are development distributions: Windows has no trusted publisher signature and macOS has no Apple notarization. macOS security may block opening them. Native test results must be checked on the exact commit before distributing binaries.

## Task visibility

Saving an employee now says **Employee saved — not a task result**. Assignment clears old saved results before the request and shows the exact task ID. The authenticated `GET /tasks/{id}` endpoint reports the stored server status. The employee page polls it without inventing completion. Approval and cancellation operate on that exact task. A completed document has a direct authenticated PDF/DOCX download button. Employee history can open individual results.

All four dashboard metric cards are buttons. They open employees, running tasks, pending approvals or completed tasks. History filters and direct result downloads are available in Documents & Excel. Counts and list views still cover the latest 100 tasks, as labelled. A named employee chat button explicitly enables `ai.chat` when needed, preserves the remaining employee permissions, and opens that identity in the assistant. It does not assign cloud budget or authorize tool execution.

## Business connections

Business connectors remain for ERP/POS/WMS/TMS APIs and are separate from AI provider keys. The page links directly to AI key setup. Real connections and demo systems are separated; mock systems are hidden until explicitly selected. Real connection setup starts read-only, explains supported HTTPS/JSON and Bearer authentication, and retains the operator-managed public-host allowlist and backend-only credential references. Saving does not claim a successful connection. An endpoint test does not certify an entire vendor or writes. Write requests still require immutable exact-task approval.

No real ERP vendor, customer credentials or paid AI inference were used during development verification. Connection-check HTTP and native-vault UI responses use fixtures in tests. Real provider credentials, billing balances and model output quality remain customer verification steps.

## Verification

Local verification: 329 backend/deployment tests passed with 14 platform/database-dependent skips; 16 desktop/build tests passed; 12 Chromium UI tests passed; TypeScript/Vite production build passed. Native CI results are recorded separately per commit. Automated coverage includes approval-to-PDF-download, all four dashboard links, employee chat selection, clearing stale save results on assignment errors, bilingual AI key setup, consent, no automatic chat, no localStorage key retention, sanitized connection errors, signed-production mode boundaries, local-only preview restrictions, API-preview budget/consent enforcement and disabled shared funding.


## Verified native artifacts (2026-11-02)

Code commit: `a2dc8c8`. Documentation-only commits do not change the binaries.

- [Windows run](https://github.com/profunction/sme/actions/runs/41463665490): native backend/UIA tests, Electron startup, frozen local/API preview boundaries, NSIS installation and installed application startup passed. Uploaded **NightBrew-Windows-API-PREVIEW** (187 MB), plus LOCAL-PREVIEW and DEV-UNSIGNED variants. The API preview is the variant for customer-owned AI keys without commercial activation.
- [macOS run](https://github.com/profunction/sme/actions/runs/41463664972): ARM64 LOCAL-PREVIEW and **NightBrew-macOS-arm64-API-PREVIEW** (391 MB) completed native tests, build, bundle integrity, packaged startup and owned-fixture probes. This evidence is specific to the ARM64 jobs; it is not a claim that the separate Intel job has completed. The ARM64 API artifact includes DMG/ZIP/checksums. Ad-hoc signing is not Apple notarization.
- A Linux native PyInstaller freeze and the API preview fixture probe also passed locally.

Live customer API credentials were not supplied or used. Model-list verification and inference remain customer acceptance steps. GitHub artifacts require sign-in to download and expire according to the workflow retention settings (14 days for these previews).
