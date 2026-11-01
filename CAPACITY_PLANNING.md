# Capacity planning

`deploy/capacity.py` evaluates sustained samples, not single spikes. Initial CPU >75%, RAM >80%, disk >80% and latency >1000ms require review when all recent samples exceed the configured threshold. It never calls a cloud purchasing/resizing API. Test coverage verifies sustained-window behavior.

Still required: host/container metrics collection, admin-authenticated dashboard, actual monthly cost input, gateway request/token/spend aggregates, DB connection saturation, subscription-failure counters, p95 latency, error rates and alert delivery. These are not implemented by the pure recommendation helper. Measure using real concurrency, document workloads and provider latency before accepting production customers. Alerts should recommend a review, with migration/downtime/storage risks and administrator approval.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
