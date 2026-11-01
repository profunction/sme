-- Additive only. Existing account REAL balances deliberately are not imported.
-- A reviewed opening entry must be supplied through the administrator API.
CREATE TABLE IF NOT EXISTS money_accounts(account TEXT PRIMARY KEY, available_usd TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS money_entries(account TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, delta_usd TEXT NOT NULL, balance_usd TEXT NOT NULL, metadata TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(account,id));
CREATE TABLE IF NOT EXISTS inference_costs(account TEXT NOT NULL, id TEXT NOT NULL, snapshot TEXT NOT NULL, reported_usage TEXT, reported_cost_usd TEXT, outcome TEXT NOT NULL, PRIMARY KEY(account,id));
