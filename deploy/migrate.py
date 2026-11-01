"""Explicit, transactional migrations; production operator must first verify a backup."""
import hashlib
import os
from pathlib import Path
import psycopg

with psycopg.connect(os.environ['DATABASE_URL']) as conn:
    conn.execute('SELECT pg_advisory_xact_lock(73482012)')
    conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, sha256 TEXT NOT NULL)')
    for path in sorted(Path('/app/deploy/migrations').glob('*.sql')):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        existing = conn.execute('SELECT sha256 FROM schema_migrations WHERE version=%s',(path.name,)).fetchone()
        if existing:
            if existing[0] != digest: raise RuntimeError('Applied migration was modified: '+path.name)
            continue
        conn.execute(path.read_text(), prepare=False)
        conn.execute('INSERT INTO schema_migrations VALUES(%s,%s)',(path.name,digest))
        print('Applied',path.name)
