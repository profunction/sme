# Connector framework

All existing connectors and ERP/POS/WMS/TMS/API categories are available to every subscription plan. Custom development/maintenance can be quoted separately; categories must not be tier-gated.

## Registry and permissions

The authenticated Connectors panel or `PUT /connectors` configures ID/name/category, adapter kind, read/write permissions, rate limit, read retries, and REST destination/authentication references. Default mock adapters are `mock-erp`, `mock-pos`, `mock-wms`, `mock-tms`. They contain demonstration data, never real vendor credentials. Mock reads/writes persist in local SQLite and do not contact vendors.

`GET /connectors/{id}/records` reads the configured collection; `POST /connectors/{id}/test` tests that read endpoint only. It does not verify writes or certify a vendor. Read permission is enforced on both. All remote results carry an untrusted-content flag and remain data.

## Generic REST

Before configuring a live connector, the operator must:

1. Obtain vendor authorization and confirm its official HTTPS API contract.
2. Set `NIGHTBREW_CONNECTOR_ALLOWED_HOSTS` to a comma-separated list of exact trusted public API hosts, and permit those hosts in cloud environment networking. The proxy/egress policy must also prevent access to private address ranges/DNS rebinding; the app allowlist is an explicit operator trust boundary, not an independent DNS firewall.
3. Provide a scoped token securely under a variable such as `NIGHTBREW_CONNECTOR_ACME_KEY`. Configure its variable **name**, never its value, in `auth_env`. Injected proxy credentials must be bound to the exact intended destination.
4. Configure `base_url`, fixed `read_path` and `write_path`, and a write method (POST/PUT/PATCH/DELETE). Paths exclude arbitrary queries, traversal, encoded paths and cross-host redirects. HTTPS port 443 only; private IP literals and local hostname suffixes are rejected.
5. Test read-only connectivity before enabling writes. Native Windows Credential Manager is used for cloud BYOK; connector tokens currently use backend environment references.

The adapter accepts/returns JSON; it does not implement vendor OAuth refresh, pagination, GraphQL, arbitrary headers, SDK/database integration or UI automation yet. Responses are capped at 2 MiB, requests have a 15-second I/O timeout. Use official APIs first; additional transport adapters belong in separate tested work.

## Write approval and failure semantics

`POST /connectors/{id}/writes` accepts `{"record": {...}}` and creates a pending task. Mock records require an `id`. Review the complete record and destination/configuration snapshot in Business tools; approve the exact task once or cancel it. Execution checks write permission and rejects any configuration change since the request. Disabling write access therefore invalidates pending writes. Direct task creation cannot bypass this endpoint.

All writes require approval, including inventory, price, refund, messaging and deletion changes. The connector never executes writes directly from an AI response. The two-worker task queue is local; it is not a company workforce scheduler.

Rate limits are transactional fixed-minute counters (1–120 attempts/minute). GET reads retry up to two times for transport failures or HTTP 429/502/503/504 with short bounded backoff. Writes have **zero automatic retries**. Redirects are rejected and credentials are not forwarded elsewhere. Audit events contain IDs/adapter kinds, not response bodies, records or credentials.

Cancellation/emergency stop cannot undo a request already sent. A failed/cancelled/interrupted write may have succeeded remotely: reconcile with the vendor before requesting a new approval. Incomplete tasks are never auto-replayed on restart. Real-vendor support requires tests against that vendor on authorized test data; mocked transport tests do not establish it.
