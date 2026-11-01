import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, industry TEXT NOT NULL DEFAULT 'General', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','administrator','supervisor','engineer','viewer')), password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(company_id,email), UNIQUE(company_id,id));
CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, UNIQUE(company_id,id));
CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, customer_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', UNIQUE(company_id,id), FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id));
CREATE TABLE IF NOT EXISTS equipment(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, site_id TEXT NOT NULL, manufacturer TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General', firmware TEXT NOT NULL DEFAULT '', installation_date TEXT NOT NULL DEFAULT '', UNIQUE(company_id,id), FOREIGN KEY(company_id,site_id) REFERENCES sites(company_id,id));
CREATE TABLE IF NOT EXISTS work_orders(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, equipment_id TEXT NOT NULL, engineer_id TEXT, number TEXT NOT NULL, title TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL, arrived_at TEXT, work_started_at TEXT, work_ended_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,id), UNIQUE(company_id,number), FOREIGN KEY(company_id,equipment_id) REFERENCES equipment(company_id,id), FOREIGN KEY(company_id,engineer_id) REFERENCES users(company_id,id));
CREATE TABLE IF NOT EXISTS service_notes(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, work_order_id TEXT NOT NULL, engineer_id TEXT NOT NULL, initial_condition TEXT NOT NULL DEFAULT '', investigation TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '', follow_up TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL, received_at TEXT NOT NULL, UNIQUE(company_id,id), FOREIGN KEY(company_id,work_order_id) REFERENCES work_orders(company_id,id), FOREIGN KEY(company_id,engineer_id) REFERENCES users(company_id,id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mutations(company_id TEXT NOT NULL, actor_id TEXT NOT NULL, mutation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(company_id,actor_id,mutation_id));
CREATE INDEX IF NOT EXISTS wo_company_engineer ON work_orders(company_id,engineer_id);
CREATE INDEX IF NOT EXISTS notes_work_order ON service_notes(company_id,work_order_id);
'''


@contextmanager
def connect():
    path = Path(os.getenv('FIELDOPS_DB', str(Path.home()/'.nightbrew-fieldops'/'fieldops.sqlite3')))
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    conn = sqlite3.connect(path, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=10000')
    try:
        yield conn
    finally:
        if conn.in_transaction:
            conn.rollback()
        conn.close()


def initialize():
    with connect() as conn:
        conn.executescript(SCHEMA)
