"""Explicit trusted-server launch checks. Error messages never include secrets."""

import base64
import os
from urllib.parse import urlsplit


def validate_configuration():
    environment = os.getenv("NIGHTBREW_SERVER_ENV", "development")
    if environment not in ("development", "test", "staging", "production"):
        raise RuntimeError("Unknown trusted server environment")
    if environment in ("development", "test"):
        return
    if os.getenv("NIGHTBREW_BILLING_MODE") != "stripe":
        raise RuntimeError("Mock billing is forbidden on staged/production servers")
    values = {
        name: os.getenv(name, "")
        for name in ("DATABASE_URL", "NIGHTBREW_BILLING_ADMIN_KEY", "NIGHTBREW_LICENSE_PRIVATE_KEY",
                     "NIGHTBREW_STRIPE_SECRET_KEY", "NIGHTBREW_STRIPE_WEBHOOK_SECRET",
                     "NIGHTBREW_GATEWAY_API_KEY")
    }
    if any(not value or "REPLACE" in value.upper() for value in values.values()):
        raise RuntimeError("Trusted server secrets are missing or placeholders")
    if len(values["NIGHTBREW_BILLING_ADMIN_KEY"]) < 32:
        raise RuntimeError("Trusted administrator credential must have at least 32 characters")
    try:
        parsed = urlsplit(values["DATABASE_URL"])
        if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not parsed.password:
            raise ValueError()
        encoded = values["NIGHTBREW_LICENSE_PRIVATE_KEY"]
        raw = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
        if len(raw) != 32:
            raise ValueError()
    except (ValueError, TypeError):
        raise RuntimeError("Trusted database/signing configuration is invalid") from None
    from billing_service.app import gateway_prices
    from billing_service.admission import limits
    from billing_service.provider import configuration
    try:
        gateway_prices()
        limits()
        _, model, _ = configuration()
        from billing_service.model_registry import resolve
        resolve(model)
        source = os.getenv("NIGHTBREW_GATEWAY_PRICING_SOURCE", "")
        if os.getenv("NIGHTBREW_GATEWAY_PRICING_VERIFIED") != "YES" or not source.startswith("https://"):
            raise ValueError("Review official provider prices before production")
    except Exception:
        raise RuntimeError("Trusted gateway configuration is invalid") from None
