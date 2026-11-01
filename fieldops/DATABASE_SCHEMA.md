# Database schema

Server SQLite uses foreign_keys=ON and transaction-scoped writes. Timestamps are UTC-offset ISO strings; user-entered service times are separate from server creation/receipt/export timestamps.

| Table | Purpose / important keys |
|---|---|
| companies | unique company code; configurable industry text |
| users | company FK; unique company/email; role; salted scrypt hash; active flag |
| sessions | SHA-256 digest of a random bearer token, user FK, expiry; raw tokens are not stored server-side |
| customers | company + ID unique; service contact |
| sites | composite company/customer reference |
| equipment | composite company/site reference; manufacturer/model/serial/room/category/firmware/install date |
| work_orders | composite company/equipment and engineer references; unique company/number; status and priority; explicit service timestamps; revision counter |
| service_notes | append-only; composite company/work-order and author references; four factual sections; device recorded and server received timestamps |
| mutations | unique company/actor/mutation ID; request fingerprint and original response for retry deduplication |
| audit | actor/company/action/entity/time metadata; no password or bearer token payload |

Device SQLite stores `snapshots(scope,json)` and `outbox(scope,id,work_order_id,body,state,error)`. Scope includes API origin, company ID and user ID. Keys are never company-only. There is no cross-account snapshot reuse. Local `pending`, `conflict` and `rejected` states are not server work-order statuses.

SQLite is a prototype choice, not a PostgreSQL implementation. Production migration must retain composite foreign keys, authorization filters, revision compare-and-swap and transactional idempotency. Audit/record deletion, retention enforcement and schema migrations beyond initial creation remain future work.
