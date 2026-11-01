# Architecture

Phase 1 has two deployable pieces: a Flutter mobile client and an authenticated FastAPI service. It does not use the AI Employee loopback backend or its license service. The FieldOps API is normally hosted behind HTTPS; do not expose a desktop service as a multi-company API.

Flutter uses Material 3, HTTP with redirects disabled, Keychain/Android secure storage for the session, and sqflite for account-scoped cached snapshots and a note outbox. Widgets never determine server authorization. New company entities/status changes remain online-only initially; notes are offline-first.

The backend uses SQLite foreign keys with `(company_id,id)` constraints. Every business query derives company and actor from the authenticated server session, never a body company ID. Engineers see assigned work and linked equipment/customer/site records; managers and viewers see their permitted company records. Mutations are transactional, revision-checked and audited. Notes are immutable append-only observations. PDF formatting uses ReportLab without an LLM.

PostgreSQL is planned before meaningful multi-process/commercial scale; migrate with explicit tenant constraints, version checks and transaction semantics preserved. S3-compatible storage is deferred until photos/manuals are implemented with authorization, retention and signed access. No mandatory GPU, message broker or vector database is needed for Phase 1. React/TypeScript web administration is a later module, not a claim that FastAPI `/docs` is a web product.
