#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_TEST_DATABASE_URL:?Must identify a disposable database, never production}"
: "${1:?Encrypted backup path}"
if [[ ${CONFIRM_DISPOSABLE_DATABASE:-} != YES ]]; then echo 'Set CONFIRM_DISPOSABLE_DATABASE=YES after verifying the target.' >&2; exit 1; fi
sha256sum --check "$1.sha256"
gpg --decrypt "$1" | pg_restore --exit-on-error --no-owner --dbname "$RESTORE_TEST_DATABASE_URL"
psql "$RESTORE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT version FROM schema_migrations ORDER BY version;'
