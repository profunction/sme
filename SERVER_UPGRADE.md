# Three capacity stages

Stage 1: single VPS, private PostgreSQL, one API process, HTTPS proxy. Stage 2: larger VPS with the same stable API domain and configuration; use migration/rollback runbooks. Resizing may require downtime and disk expansions are not always reversible. Stage 3 is design only: load balancer, separate PostgreSQL, API replicas, optional workers, centralized monitoring and external backup storage. Do not provision Stage 3 now.

The initial PostgreSQL adapter serializes quota-write transactions using a database advisory lock to preserve the original SQLite immediate-transaction semantics. This is conservative and limits throughput. Before replicas, load-test and replace coarse locking with reviewed row-level quota transactions. Sessions/entitlements are database-backed; do not store replica-critical state in process memory.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
