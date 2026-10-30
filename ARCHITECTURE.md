# Architecture

```text
Sandboxed Electron / React renderer
  -> bearer-authenticated loopback FastAPI
     -> hardware inspection + local model benchmark
     -> privacy/capability router -> Ollama OR HTTPS cloud provider
     -> transactional SQLite usage reservations / chat history
     -> bounded task workers -> deterministic document / file tools
     -> connector registry -> local mocks OR allowlisted HTTPS JSON APIs
     -> immutable approval records + metadata-only audit
```

`backend/app.py` defines the API boundary; `ai.py` handles routing/costs; `hardware.py` measures capabilities; `credentials.py` uses backend environment or Windows Credential Manager. `store.py` creates backward-compatible tables. `documents.py` owns deterministic operations; `files.py` restricts access to opaque IDs; `tasks.py` owns lifecycle/approval/recovery. `connectors.py` owns adapters, authentication references, rate/retry policies and all-plan integration access.

The single-user session token authorizes local administrative access. There are no per-employee identities or tenant boundaries yet. UI navigation/permissions do not substitute for backend checks. Provider output and extracted/remote content never enter the tool dispatcher as instructions. No shell execution exists.

Cloud requests reserve budget under a SQLite write lock; completion reconciles reported usage, while unknown billing retains the estimate. Prices/credits are development policy, not payment entitlements. Chat and business content are local plaintext protected by OS account permissions, not encrypted at rest.

Task payloads are frozen on creation. Writes bind approval to a complete connector configuration snapshot; execution rechecks permissions/current configuration. Interrupted tasks are not replayed, and writes have no automatic retries. Cancellation is cooperative; unknown external outcomes must be reconciled manually. Two workers and SQLite are deliberate initial constraints; this is not a multi-tenant cloud service.

Phase 8 must supervise/package the Python process, sign releases, add secure updates and verify all Windows paths. Current `package:win` packages the shell only, not a standalone product.
