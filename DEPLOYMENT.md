# Single-VPS deployment

One authority process contains licensing, subscriptions and the cloud AI gateway. PostgreSQL is private on the Compose network; only the reverse proxy publishes 80/443. Customer Ollama stays on the desktop. No model or GPU runs here.

Copy `.env.example` to private `.env` (chmod 600), replace every placeholder, configure DNS to your approved host, then run `docker compose build`, `docker compose up -d`. For HTTPS use `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build` with current Compose supporting `!reset`. Local API binds only 127.0.0.1:8000. Never put server keys or DATABASE_URL into Electron.

Migrations execute before API startup. Readiness checks schema access. Back up and restore-test before production upgrades. The existing authority defaults to mock billing; production provider configuration, canonical Stripe verification, signing-key setup and real payment tests remain owner-dependent gates. This is NOT a verified production release.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
