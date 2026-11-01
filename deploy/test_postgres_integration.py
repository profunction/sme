"""Actual PostgreSQL tests; opt in only with a disposable nightbrew_test_* DB."""

import os
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pytest

from backend.tests.test_billing import DEVICE, billing, paid_account  # noqa: F401
from deploy.migrate import expected_migrations, migrate


@pytest.fixture
def pg_authority(billing, monkeypatch):
    dsn = os.getenv("NIGHTBREW_POSTGRES_TEST_URL")
    if not dsn:
        pytest.skip("set NIGHTBREW_POSTGRES_TEST_URL to a disposable PostgreSQL database")
    psycopg = pytest.importorskip("psycopg")
    parsed = urlsplit(dsn)
    if not parsed.path.removeprefix("/").startswith("nightbrew_test_"):
        pytest.fail("PostgreSQL integration target must be a disposable nightbrew_test_* database")
    schema = "test_" + uuid.uuid4().hex
    with psycopg.connect(dsn) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    query = dict(parse_qsl(parsed.query))
    query["options"] = "-csearch_path=" + schema
    scoped_dsn = urlunsplit(parsed._replace(query=urlencode(query)))
    monkeypatch.setenv("DATABASE_URL", scoped_dsn)
    monkeypatch.setenv("NIGHTBREW_SERVER_ENV", "test")
    from billing_service.postgres import pool
    if pool.cache_info().currsize:
        pool().close()
        pool.cache_clear()
    migrate(scoped_dsn)
    try:
        yield billing, scoped_dsn
    finally:
        if pool.cache_info().currsize:
            pool().close()
            pool.cache_clear()
        with psycopg.connect(dsn) as conn:
            conn.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_real_postgres_migration_idempotency_and_license(pg_authority):
    (client, public), dsn = pg_authority
    import psycopg
    from backend import licensing
    migrate(dsn)
    with psycopg.connect(dsn) as conn:
        assert dict(conn.execute("SELECT version,sha256 FROM schema_migrations").fetchall()) == expected_migrations()
    _, auth = paid_account(client)
    response = client.post("/activate", headers=auth, json={"device_id": DEVICE})
    assert response.status_code == 200, response.text
    # Mock license remains explicitly development-only.
    with pytest.raises(ValueError):
        licensing.verify(response.json()["grant"], public, DEVICE)
    assert client.post("/activate", headers=auth, json={"device_id": "b" * 64}).status_code == 403


def test_real_postgres_migration_modified_digest_is_rejected(pg_authority, tmp_path):
    _, dsn = pg_authority
    from deploy.migrate import MIGRATIONS
    for path in MIGRATIONS.glob("*.sql"):
        (tmp_path / path.name).write_text(path.read_text())
    changed = tmp_path / "001_authority.sql"
    changed.write_text(changed.read_text() + "\n-- altered applied migration\n")
    with pytest.raises(RuntimeError, match="Applied migration was modified"):
        migrate(dsn, tmp_path)


def test_real_postgres_readiness_requires_all_migrations(pg_authority):
    (client, _), dsn = pg_authority
    import psycopg
    import deploy.runtime  # noqa: F401 -- registers readiness on the authority app
    assert client.get("/health/ready").status_code == 200
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE schema_migrations SET sha256='incorrect' WHERE version='001_authority.sql'")
    assert client.get("/health/ready").status_code == 503


def test_real_postgres_gateway_reservation_settlement_contract(pg_authority, monkeypatch):
    from backend.tests.test_billing import test_gateway_uses_server_prices_and_records_provider_usage
    billing, _ = pg_authority
    # Execute the existing provider-mocked behavioral contract against real PG.
    test_gateway_uses_server_prices_and_records_provider_usage(billing, monkeypatch)


def test_real_postgres_exact_ledger_price_snapshot(pg_authority, monkeypatch):
    from backend.tests.test_gateway_accounting import funded, test_snapshot_and_settlement_ignore_later_rate_changes
    billing, _ = pg_authority
    configured = funded.__wrapped__(billing, monkeypatch)
    test_snapshot_and_settlement_ignore_later_rate_changes(configured, monkeypatch)


@pytest.mark.parametrize("usage", [{"prompt_tokens": 9999999, "completion_tokens": 1},
                                  {"prompt_tokens": 1, "completion_tokens": 513}])
def test_real_postgres_discrepancy_and_single_reconciliation(pg_authority, monkeypatch, usage):
    from backend.tests.test_gateway_accounting import funded, test_excess_provider_usage_holds_without_hidden_debt
    billing, _ = pg_authority
    configured = funded.__wrapped__(billing, monkeypatch)
    test_excess_provider_usage_holds_without_hidden_debt(configured, monkeypatch, usage)


@pytest.mark.parametrize("scope", ["global", "account"])
def test_real_postgres_concurrent_gateway_admission(pg_authority, monkeypatch, scope):
    from backend.tests.test_gateway_admission import gateway, test_atomic_admission_rejects_without_charging_and_recovers
    billing, _ = pg_authority
    configured = gateway.__wrapped__(billing, monkeypatch)
    test_atomic_admission_rejects_without_charging_and_recovers(configured, monkeypatch, scope)
