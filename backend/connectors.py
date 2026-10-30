"""Explicit connector registry; mock adapters never imply real vendor compatibility."""

import ipaddress
import json
import os
import re
import time
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field, field_validator, model_validator

from backend import store

CATEGORIES = ("ERP", "POS", "WMS", "TMS", "API")
PLANS = {
    "Starter": {
        "monthly_myr": 299,
        "employees": 2,
        "computers": 1,
        "ai_mode": "LOCAL_ONLY",
    },
    "Business": {
        "monthly_myr": 599,
        "employees": 5,
        "computers": 1,
        "ai_mode": "CLOUD_ONLY",
    },
    "Enterprise": {
        "monthly_myr": 1499,
        "employees": 10,
        "computers": 10,
        "ai_mode": "HYBRID",
    },
}


def entitled(plan, category):
    return plan in PLANS and category in CATEGORIES


class Connector(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,48}$")
    name: str = Field(min_length=1, max_length=100)
    category: Literal["ERP", "POS", "WMS", "TMS", "API"]
    kind: Literal["mock", "rest"] = "mock"
    read_enabled: bool = True
    write_enabled: bool = False
    base_url: str = Field(default="", max_length=500)
    read_path: str = Field(default="/records", max_length=200)
    write_path: str = Field(default="/records", max_length=200)
    write_method: Literal["POST", "PUT", "PATCH", "DELETE"] = "POST"
    auth_env: str = Field(default="", max_length=100)
    requests_per_minute: int = Field(default=30, ge=1, le=120)
    read_retries: int = Field(default=1, ge=0, le=2)

    @field_validator("read_path", "write_path")
    @classmethod
    def safe_path(cls, value):
        if (
            not re.fullmatch(r"/[A-Za-z0-9_/-]*", value)
            or "//" in value
            or ".." in value
        ):
            raise ValueError(
                "Paths must be fixed relative API paths without query, encoding or traversal"
            )
        return value

    @field_validator("auth_env")
    @classmethod
    def safe_env(cls, value):
        if value and not re.fullmatch(r"NIGHTBREW_CONNECTOR_[A-Z0-9_]+", value):
            raise ValueError(
                "Credential reference must use a NIGHTBREW_CONNECTOR_ variable"
            )
        return value

    @model_validator(mode="after")
    def destination(self):
        if self.kind == "rest":
            validate_url(self.base_url)
        return self


def validate_url(value):
    p = urlsplit(value)
    try:
        port = p.port
    except ValueError:
        raise ValueError("Invalid destination port") from None
    host = p.hostname or ""
    allowed = {
        v.strip().lower()
        for v in os.getenv("NIGHTBREW_CONNECTOR_ALLOWED_HOSTS", "").split(",")
        if v.strip()
    }
    if (
        p.scheme != "https"
        or host not in allowed
        or port not in (None, 443)
        or p.username
        or p.password
        or p.query
        or p.fragment
    ):
        raise ValueError(
            "REST destination must be HTTPS:443 on the operator-configured NIGHTBREW_CONNECTOR_ALLOWED_HOSTS allowlist"
        )
    if (
        not host
        or "." not in host
        or host.endswith((".local", ".localhost", ".internal", ".lan"))
        or host in ("localhost", "metadata.google.internal")
    ):
        raise ValueError("Local/private destination names are forbidden")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ValueError("Private destination addresses are forbidden")
    if p.path and (
        not re.fullmatch(r"/[A-Za-z0-9_/-]*", p.path)
        or "//" in p.path
        or ".." in p.path
    ):
        raise ValueError("Invalid base URL path")
    return value.rstrip("/")


def defaults():
    return [
        Connector(
            id="mock-" + category.lower(),
            name="Mock " + category + " (development only)",
            category=category,
        )
        for category in CATEGORIES
        if category != "API"
    ]


def list_configs(connect):
    with connect() as db:
        saved = store.get(db, "connectors")
    return saved if saved is not None else [c.model_dump() for c in defaults()]


def get(connect, identifier):
    record = next((c for c in list_configs(connect) if c["id"] == identifier), None)
    if not record:
        raise ValueError("Unknown connector")
    return Connector(**record)


def save(connect, config):
    configs = list_configs(connect)
    if config.id not in [c["id"] for c in configs] and len(configs) >= 50:
        raise ValueError("Maximum 50 connectors")
    configs = [c for c in configs if c["id"] != config.id] + [config.model_dump()]
    with connect() as db:
        store.put(db, "connectors", configs)
        store.audit(db, "connector_configured", config.id, config.kind)


def public(config):
    # No credential values. Label live REST as unverified until the operator tests it.
    return {
        **config,
        "capabilities": ["read_records", "write_records"],
        "mock": config["kind"] == "mock",
        "vendor_verified": False,
        "all_plans": True,
        "authentication": "Bearer token via backend environment reference"
        if config["auth_env"]
        else "none",
    }


def rate_limit(connect, config):
    minute = int(time.time() // 60)
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        state = store.get(db, "rate:" + config.id, {"minute": minute, "count": 0})
        if state["minute"] != minute:
            state = {"minute": minute, "count": 0}
        if state["count"] >= config.requests_per_minute:
            raise ValueError("Connector rate limit reached; retry in the next minute")
        state["count"] += 1
        store.put(db, "rate:" + config.id, state)


def seeded(config):
    records = {
        "ERP": [
            {
                "id": "demo-invoice-1",
                "customer": "Demo customer",
                "amount": "120.00",
                "status": "draft",
            }
        ],
        "POS": [
            {
                "id": "demo-sale-1",
                "item": "Demo coffee",
                "quantity": 2,
                "amount": "18.00",
            }
        ],
        "WMS": [{"id": "demo-stock-1", "sku": "DEMO-TEA", "quantity": 20}],
        "TMS": [
            {
                "id": "demo-shipment-1",
                "destination": "Demo warehouse",
                "status": "planned",
            }
        ],
        "API": [],
    }
    return records[config.category]


def remote(connect, config, write=False, payload=None, checkpoint=lambda: None):
    validate_url(config.base_url)  # Recheck operator allowlist before every request.
    if config.auth_env and not os.getenv(config.auth_env):
        raise ValueError("Required connector credential binding is unavailable")
    headers = (
        {"Authorization": "Bearer " + os.environ[config.auth_env]}
        if config.auth_env
        else {}
    )
    method = config.write_method if write else "GET"
    url = config.base_url.rstrip("/") + (
        config.write_path if write else config.read_path
    )
    attempts = 1 if write else config.read_retries + 1
    with httpx.Client(timeout=15, follow_redirects=False, trust_env=True) as client:
        for attempt in range(attempts):
            checkpoint()
            rate_limit(connect, config)
            try:
                # Stream to bound data retained from untrusted vendor endpoints.
                with client.stream(
                    method, url, headers=headers, json=payload if write else None
                ) as response:
                    retry = (
                        response.status_code in (429, 502, 503, 504)
                        and attempt + 1 < attempts
                    )
                    if retry:
                        time.sleep(0.1 * (attempt + 1))
                        continue
                    response.raise_for_status()
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        checkpoint()
                        body.extend(chunk)
                        if len(body) > 2 * 1024**2:
                            raise ValueError("Connector response exceeds 2 MiB")
                    return (
                        json.loads(body)
                        if body
                        else {"status_code": response.status_code}
                    )
            except httpx.TransportError:
                if attempt + 1 >= attempts:
                    raise ValueError(
                        "Connector transport failure; write outcome may be unknown"
                    ) from None
                time.sleep(0.1 * (attempt + 1))
            except (httpx.HTTPStatusError, json.JSONDecodeError):
                raise ValueError(
                    "Connector rejected request or returned invalid JSON; write outcome may be unknown"
                ) from None
    raise ValueError("Connector request failed")


def read(connect, identifier):
    config = get(connect, identifier)
    if not config.read_enabled:
        raise ValueError("Connector read permission denied")
    try:
        if config.kind == "mock":
            rate_limit(connect, config)
            with connect() as db:
                result = store.get(db, "records:" + config.id, seeded(config))
        else:
            result = remote(connect, config)
        with connect() as db:
            store.audit(db, "connector_read", identifier, config.kind)
        return {
            "connector_id": identifier,
            "mock": config.kind == "mock",
            "untrusted_content": True,
            "data": result,
        }
    except Exception:
        with connect() as db:
            store.audit(db, "connector_read_failed", identifier, config.kind)
        raise


class Write(BaseModel):
    record: dict = Field(max_length=100)

    @field_validator("record")
    @classmethod
    def bounded_record(cls, value):
        if len(json.dumps(value).encode()) > 32000:
            raise ValueError("Record exceeds 32 KiB")
        return value


def prepare_write(connect, identifier, request):
    config = get(connect, identifier)
    if not config.write_enabled:
        raise ValueError("Connector write permission denied")
    if config.kind == "mock" and (
        not isinstance(request.record.get("id"), str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request.record["id"])
    ):
        raise ValueError("Mock writes require a safe nonempty record id")
    # Snapshot the entire destination and permissions: changing configuration invalidates approval.
    return {
        "connector_id": identifier,
        "config_snapshot": config.model_dump(),
        "record": request.record,
    }


def write(connect, payload, checkpoint):
    config = get(connect, payload["connector_id"])
    if config.model_dump() != payload["config_snapshot"] or not config.write_enabled:
        raise ValueError(
            "Connector changed or write permission revoked; create a new approval request"
        )
    request = Write(record=payload["record"])
    checkpoint()
    try:
        if config.kind == "mock":
            rate_limit(connect, config)
            with connect() as db:
                db.execute("BEGIN IMMEDIATE")
                # Revalidate under the write lock so permission revocations cannot race a local update.
                current = next(
                    c
                    for c in store.get(
                        db, "connectors", [c.model_dump() for c in defaults()]
                    )
                    if c["id"] == config.id
                )
                if current != payload["config_snapshot"] or store.get(
                    db, "emergency_stop", False
                ):
                    raise ValueError("Connector changed or emergency stop active")
                records = store.get(db, "records:" + config.id, seeded(config))
                records = [
                    r for r in records if r.get("id") != request.record["id"]
                ] + [request.record]
                if len(records) > 1000:
                    raise ValueError("Maximum 1000 mock records")
                store.put(db, "records:" + config.id, records)
                store.audit(db, "connector_write", config.id, "mock")
                result = request.record
        else:
            result = remote(
                connect,
                config,
                write=True,
                payload=request.record,
                checkpoint=checkpoint,
            )
            with connect() as db:
                store.audit(db, "connector_write", config.id, "rest")
        return {
            "connector_id": config.id,
            "mock": config.kind == "mock",
            "untrusted_content": True,
            "data": result,
        }
    except Exception:
        with connect() as db:
            store.audit(db, "connector_write_failed", config.id, config.kind)
        raise
