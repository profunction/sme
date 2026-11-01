# Controlled migration

1. Obtain owner approval for the target server and costs.
2. Verify a recent encrypted off-server backup by restoring it to a disposable database.
3. Record image versions, migration hashes, schema version and DNS TTL.
4. Prepare the target without exposing PostgreSQL.
5. Enter a maintenance/write-freeze window; drain active requests.
6. Take and transfer a final backup; restore and verify consistency.
7. Run compatible migrations and health/account/license/gateway checks on the target.
8. Switch the stable API domain/traffic, keeping the old database read-only.
9. Monitor error rate, latency, connections and quota correctness.
10. Follow rollback criteria immediately on failures.

SQLite authority data is NOT automatically imported by the new PostgreSQL adapter. A validated export/import tool and monetary/ledger reconciliation are required before moving an existing SQLite deployment. Do not start an empty PostgreSQL server and call it a migration.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
