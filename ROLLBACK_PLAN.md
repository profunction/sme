# Rollback

Keep the previous image and a verified pre-migration backup. Define health/error/financial-consistency thresholds and a decision owner before switching traffic. Restore old routing only after stopping writes on the new system. If the new database accepted writes, reconcile or safely replay those writes first; simply reverting DNS can lose transactions. Never run two writable independent authorities during DNS overlap. Prefer expand/contract compatible schema migrations. Destructive schema rollback requires a tested restore and an explicit maintenance window. Zero downtime is not promised.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
