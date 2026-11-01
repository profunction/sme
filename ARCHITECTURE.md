# Architecture

```text
Electron main -> owned Python backend, random session + authenticated instance handshake
  -> sandboxed React renderer via minimal validated preload IPC
  -> bearer-authenticated loopback FastAPI
     -> hardware / privacy router -> local Ollama OR customer BYOK provider
     -> deterministic documents + opaque files
     -> bounded tasks / immutable approvals -> browser / Windows UIA / connectors
     -> employee instructions, scoped tools/connectors, assignment and usage history
     -> verified public-key device grant + online quotas
        -> separate HTTPS commercial authority
           -> Stripe Checkout/Portal + verified webhook reconciliation
           -> authoritative plans/seats/devices/credits
           -> included-AI gateway -> company provider (private key stays server-side)
```

`backend/app.py` is the desktop API; `ai.py`, `hardware.py` and `credentials.py` implement inference policy, measurements and vault bindings. `store.py` adds compatible SQLite tables; `documents.py`/`files.py` implement restricted deterministic operations. `tasks.py` handles queue/approval/recovery; `automation.py` implements explicit plans; `workforce.py` checks employee context/permissions/caps; `connectors.py` owns adapters and all-plan category access. `licensing.py` verifies grants and calls online quota/credit services. `billing_service/app.py` is deployed separately and must never be bundled with desktop secrets.

`desktop/backend.cjs` chooses the development Python or frozen executable, generates the session and checks instance identity. `main.cjs` manages lifecycle/IPC/window/updates; `preload.cjs` exposes only named operations. `backend/entrypoint.py` runs the frozen service and rotating logs. PyInstaller/installer scripts and pinned-action Windows workflows build and test native candidates. Production signing/update/public license configuration is generated into ignored build resources; only public policy ships.

Employee instructions guide chat but do not grant tools. Model output cannot dispatch tools. Task/employee/connector/automation snapshots bind approval to exact intent, and permissions are rechecked. Consequential actions always require human approval. Quotas count attempts, and interrupted/unknown external outcomes are not replayed. This is a single-company desktop application with two task workers, not a multi-tenant cloud worker cluster or unrestricted autonomous agent.

Desktop and authority have separate SQLite stores/trust boundaries. Desktop plaintext records are OS-account protected; paid entitlements are signature-verified and quotas/credits controlled on the authority. BYOK costs go to the customer's provider; included credits use the authority gateway. Customer business content only enters the gateway/provider with explicit consent. At-rest encryption/parser sandboxing, real vendor acceptance, Windows verification and deployed commercial operations remain release work.

## Customer GUI and model settings (0.9)

React workspace navigation composes the existing business/employee/connector tools with Dashboard, Guide and ModelSetup modules. Dashboard reads authenticated task/employee/hardware/usage/license state; missing data stays unknown rather than fabricated. Templates are inert editable text until the user sends a chat request. Theme and guide-completion preferences alone use browser local storage; tokens and prompt contents do not.

Authenticated `/settings/models` GET/PUT persists non-secret model IDs and a validated HTTPS provider root in SQLite. Environment values remain initial defaults when no saved configuration exists. Changes are transactional: changing the local model clears its benchmark, and changing the cloud model/provider clears cloud permission and confirmed pricing. Chat, cost routing and benchmarking read the saved model settings. API keys remain in OS vaults/environment injection. No new runtime dependency was introduced.
