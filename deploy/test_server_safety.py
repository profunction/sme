"""Configuration and schema checks do not need a paid server or provider."""

import base64
import json

import pytest

from deploy.migrate import expected_migrations, migration_files
from deploy.validation import validate_configuration


def test_migrations_resolve_from_source_not_container_workdir(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert "001_authority.sql" in expected_migrations()
    with pytest.raises(RuntimeError, match="No database migration"):
        migration_files(tmp_path)


def configure(monkeypatch):
    values = {
        "NIGHTBREW_SERVER_ENV": "production", "NIGHTBREW_BILLING_MODE": "stripe",
        "DATABASE_URL": "postgresql://test:disposable@database/nightbrew",
        "NIGHTBREW_BILLING_ADMIN_KEY": "a" * 40,
        "NIGHTBREW_LICENSE_PRIVATE_KEY": base64.urlsafe_b64encode(b"b" * 32).decode().rstrip("="),
        "NIGHTBREW_STRIPE_SECRET_KEY": "test-only-stripe-secret",
        "NIGHTBREW_STRIPE_WEBHOOK_SECRET": "test-only-webhook-secret",
        "NIGHTBREW_GATEWAY_API_KEY": "test-only-provider-key",
        "NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION": "1",
        "NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION": "2",
        "NIGHTBREW_GATEWAY_PRICING_VERIFIED": "YES",
        "NIGHTBREW_GATEWAY_PRICING_SOURCE": "https://provider.example/test-pricing-fixture",
        "NIGHTBREW_GATEWAY_MODELS_JSON": json.dumps({"deepseek-chat": {
            "capabilities": ["TEXT"], "verification_status": "VERIFIED",
            "context_window_tokens": 8192, "source": "https://provider.example/test-fixture"}}),
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def test_production_config_and_signing_key_validation(monkeypatch):
    configure(monkeypatch)
    validate_configuration()
    monkeypatch.setenv("NIGHTBREW_LICENSE_PRIVATE_KEY", "not-a-signing-key")
    with pytest.raises(RuntimeError, match="signing"):
        validate_configuration()


@pytest.mark.parametrize("name,value", [
    ("NIGHTBREW_BILLING_MODE", "mock"),
    ("DATABASE_URL", "postgresql://test:REPLACE_WITH_PASSWORD@database/nightbrew"),
    ("NIGHTBREW_BILLING_ADMIN_KEY", "short"),
    ("NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "NaN"),
    ("NIGHTBREW_GATEWAY_MAX_CONCURRENT", "0"),
    ("NIGHTBREW_GATEWAY_PRICING_VERIFIED", "NO"),
    ("NIGHTBREW_GATEWAY_MODELS_JSON", "{}"),
    ("NIGHTBREW_SERVER_ENV", "prodution"),
])
def test_production_rejects_unsafe_configuration(monkeypatch, name, value):
    configure(monkeypatch)
    monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError):
        validate_configuration()
