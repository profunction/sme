#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_RECIPIENT:?Set GPG recipient}"
: "${BACKUP_REMOTE:?Set an SSH remote:path outside this VPS}"
BACKUP_DIR=${BACKUP_DIR:-./backups}
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
artifact="$BACKUP_DIR/nightbrew-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
docker compose exec -T database pg_dump -U nightbrew -d nightbrew -Fc | gpg --batch --encrypt --recipient "$BACKUP_RECIPIENT" --output "$artifact"
sha256sum "$artifact" > "$artifact.sha256"
scp "$artifact" "$artifact.sha256" "$BACKUP_REMOTE"
echo 'Encrypted backup copied off server; verify a restore before production migrations.'
