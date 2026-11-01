"""PostgreSQL authority adapter; serialized quota writes preserve SQLite's initial semantics."""
import os
from contextlib import contextmanager
from functools import lru_cache


class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def rows(cursor):
    columns = [column.name for column in cursor.description]
    return lambda values: Row(zip(columns, values))


@lru_cache(maxsize=1)
def pool():
    from psycopg_pool import ConnectionPool
    return ConnectionPool(os.environ['DATABASE_URL'], min_size=1,
                          max_size=int(os.getenv('DB_POOL_MAX', '5')),
                          kwargs={'row_factory': rows}, timeout=10)


class Adapter:
    def __init__(self, conn): self.conn = conn
    def execute(self, sql, params=()):
        if sql.strip().upper() == 'BEGIN IMMEDIATE':
            return self.conn.execute('SELECT pg_advisory_xact_lock(73482011)')
        if 'INSERT OR IGNORE' in sql.upper():
            sql = sql.replace('INSERT OR IGNORE', 'INSERT') + ' ON CONFLICT DO NOTHING'
        # SQLite's two-argument scalar MAX is PostgreSQL GREATEST, not aggregate MAX.
        sql = sql.replace('MAX(0,credits+?)', 'GREATEST(0,credits+?)')
        return self.conn.execute(sql.replace('?', '%s'), params)


@contextmanager
def connection():
    with pool().connection() as conn:
        yield Adapter(conn)
