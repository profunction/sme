# Architecture

Sandboxed Electron renderer → authenticated loopback FastAPI → explicitly selected Ollama or cloud provider. SQLite stores successful user/assistant message pairs atomically under the user's .nightbrew directory. Provider keys stay in backend environment variables. React renders text without HTML execution. No renderer Node access, IPC bridge, shell tools or automation exist.

Phase 1 deliberately uses a separately started backend. Future Windows packaging must add authenticated process supervision and Credential Manager before general distribution. Local history is plaintext; OS account permissions are the current boundary.
