# Backup and restore

Run `deploy/scripts/backup.sh` with BACKUP_RECIPIENT (GPG public recipient), BACKUP_REMOTE (separate server SSH destination) and BACKUP_DIR. It streams pg_dump custom format through GPG, checksums ciphertext and copies both off server. Private decryption keys must not live only on the VPS. Schedule via systemd/cron after a successful manual run. Suggested retention: 7 daily, 4 weekly, 3 monthly copies; automated expiry/remote retention is not implemented yet and must be configured/tested.

Restore only into a new disposable database: verify checksum, set RESTORE_TEST_DATABASE_URL and CONFIRM_DISPOSABLE_DATABASE=YES, then run restore-test.sh. Compare account/device/inference counts and application reads before accepting a backup. The script deliberately does not drop or clean an existing production database. No restore test has yet run in this environment.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
