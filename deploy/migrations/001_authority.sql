CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, key_hash TEXT UNIQUE, plan TEXT, active INTEGER, expires INTEGER, customer TEXT, credits REAL DEFAULT 0, extra_devices INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS devices(account TEXT, device TEXT, PRIMARY KEY(account,device));
    CREATE TABLE IF NOT EXISTS employees(account TEXT, employee TEXT, active INTEGER, PRIMARY KEY(account,employee));
    CREATE TABLE IF NOT EXISTS operations(account TEXT, id TEXT, month TEXT, PRIMARY KEY(account,id));
    CREATE TABLE IF NOT EXISTS checkout(id TEXT PRIMARY KEY, account TEXT, sku TEXT, fulfilled INTEGER DEFAULT 0, subscription TEXT, payment_intent TEXT);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created INTEGER);
    CREATE TABLE IF NOT EXISTS inference(account TEXT,id TEXT,charged REAL,status TEXT,month TEXT,created INTEGER,PRIMARY KEY(account,id));
