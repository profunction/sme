"""Versioned, transactional migrations; never silently succeed with no SQL files."""

import hashlib
import os
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def migration_files(directory=MIGRATIONS):
    paths = sorted(Path(directory).glob("*.sql"))
    if not paths:
        raise RuntimeError("No database migration files found")
    return paths


def expected_migrations(directory=MIGRATIONS):
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in migration_files(directory)}


def migrate(dsn=None, directory=MIGRATIONS):
    import psycopg

    paths = migration_files(directory)
    with psycopg.connect(dsn or os.environ["DATABASE_URL"]) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(73482012)")
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, sha256 TEXT NOT NULL)")
        for path in paths:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            existing = conn.execute("SELECT sha256 FROM schema_migrations WHERE version=%s", (path.name,)).fetchone()
            if existing:
                if existing[0] != digest:
                    raise RuntimeError("Applied migration was modified: " + path.name)
                continue
            if (os.getenv("NIGHTBREW_SERVER_ENV") == "production"
                    and os.getenv("NIGHTBREW_MIGRATION_BACKUP_VERIFIED") != "YES"):
                raise RuntimeError("Verify a usable backup before production migrations")
            conn.execute(path.read_text(), prepare=False)
            conn.execute("INSERT INTO schema_migrations VALUES(%s,%s)", (path.name, digest))
            print("Applied", path.name)


if __name__ == "__main__":
    migrate()
