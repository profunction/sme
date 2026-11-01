"""Desktop verification of short-lived, device-bound Ed25519 grants from a separate authority."""

import base64
import hashlib
import json
import os
import platform
import re
import time
import uuid
from urllib.parse import urlsplit

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from backend import credentials, store


def device_id():
    material = (
        f"{platform.system()}|{platform.machine()}|{platform.node()}|{uuid.getnode()}"
    )
    return hashlib.sha256(material.encode()).hexdigest()


def local_preview():
    return os.getenv("NIGHTBREW_LOCAL_PREVIEW") == "1" and os.getenv("NIGHTBREW_ENV") == "local-preview"


def required():
    return os.getenv("NIGHTBREW_ENFORCE_LICENSE") == "1"


def decode(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 32768 or not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
        raise ValueError("Invalid license encoding")
    decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if base64.urlsafe_b64encode(decoded).decode().rstrip("=") != value.rstrip("="):
        raise ValueError("Noncanonical license encoding")
    return decoded


def verify(token, public_key, device=None, now=None):
    try:
        if not isinstance(token, str) or len(token) > 32768:
            raise ValueError("Invalid license token")
        encoded, signature = token.split(".")
        Ed25519PublicKey.from_public_bytes(decode(public_key)).verify(
            decode(signature), encoded.encode()
        )
        data = json.loads(decode(encoded))
        if not isinstance(data, dict):
            raise ValueError("Invalid license claims")
        timestamp = time.time() if now is None else now
        if (
            data["iss"] != "nightbrew-license-authority"
            or data["aud"] != "nightbrew-desktop"
            or type(data["version"]) is not int or data["version"] != 1
        ):
            raise ValueError("Invalid grant issuer")
        if (
            data["device_id"] != (device or device_id())
            or type(data["nbf"]) is not int or type(data["exp"]) is not int
            or not 0 < data["exp"] - data["nbf"] <= 86405
            or not data["nbf"] <= timestamp < data["exp"]
        ):
            raise ValueError("License expired or belongs to another computer")
        if (
            data["environment"] == "mock"
            and os.getenv("NIGHTBREW_ALLOW_MOCK_LICENSE") != "1"
        ):
            raise ValueError("Mock grants are disabled")
        if (
            data["plan"] not in ("Starter", "Business", "Enterprise")
            or type(data["employee_limit"]) is not int
            or not 1 <= data["employee_limit"] <= 10000
            or data["environment"] not in ("mock", "stripe", "production")
            or not isinstance(data["account_id"], str)
            or not re.fullmatch(r"[a-f0-9]{32}", data["account_id"])
            or type(data["monthly_tasks"]) is not int
            or not 0 <= data["monthly_tasks"] <= 1000000
        ):
            raise ValueError("Invalid license claims")
        return data
    except (InvalidSignature, ValueError, KeyError, TypeError, UnicodeError) as exc:
        raise ValueError(
            "Untrusted, expired, malformed or wrong-device license"
        ) from exc


def enforce(connect):
    if not required():
        return {
            "environment": "local_preview" if local_preview() else "development",
            "plan": "Development",
            "employee_limit": 100,
            "verified": False,
        }
    key = os.getenv("NIGHTBREW_LICENSE_PUBLIC_KEY", "")
    with connect() as db:
        token = store.get(db, "license_grant", "")
    if not key or not token:
        raise ValueError("Activate a valid license from the trusted licensing backend")
    return verify(token, key)


def account_key():
    key = os.getenv("NIGHTBREW_LICENSE_ACCOUNT_KEY")
    if key:
        return key
    if platform.system() in ("Windows", "Darwin"):
        return credentials.native_vault().get_password(
            "NightBrew", "license-account-key"
        )
    return None


def remote(path, body=None):
    if local_preview():
        raise ValueError("Local preview has no cloud gateway, subscription or payment services")
    base = os.getenv("NIGHTBREW_LICENSE_URL", "").rstrip("/")
    parsed = urlsplit(base)
    test = os.getenv("NIGHTBREW_ENV") == "test" and parsed.hostname in (
        "127.0.0.1",
        "localhost",
    )
    if (
        (parsed.scheme != "https" and not test)
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Configure a trusted HTTPS licensing backend URL")
    try:
        key = account_key()
    except Exception:
        raise ValueError("License credential store is unavailable") from None
    if not key:
        raise ValueError("Configure the license account credential securely")
    try:
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=True) as client:
            response = client.request(
                "POST" if body is not None else "GET",
                base + path,
                json=body,
                headers={"Authorization": "Bearer " + key},
            )
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise ValueError(
            "Licensing backend unavailable or rejected the operation; check subscription, credits and device allowance"
        ) from None


def activate(connect):
    result = remote("/activate", {"device_id": device_id()})
    if not isinstance(result, dict) or not isinstance(result.get("grant"), str):
        raise ValueError("Licensing backend returned an invalid activation response")
    claims = verify(result["grant"], os.getenv("NIGHTBREW_LICENSE_PUBLIC_KEY", ""))
    with connect() as db:
        store.put(db, "license_grant", result["grant"])
        store.audit(db, "license_activated", claims["plan"])
    return claims


def reserve_task(connect, identifier, employee_id=None):
    if not required():
        return
    enforce(connect)
    remote(
        "/quota/reserve",
        {
            "device_id": device_id(),
            "operation_id": identifier,
            "employee_id": employee_id,
        },
    )


def reserve_seat(connect, identifier, active):
    if not required():
        return
    enforce(connect)
    remote(
        "/employees/register",
        {"employee_id": identifier, "active": active, "device_id": device_id()},
    )


def included_inference(connect, request, system_text):
    enforce(connect)
    return remote(
        "/inference",
        {
            "device_id": device_id(),
            "request_id": uuid.uuid4().hex,
            "message": request.message,
            "system_text": system_text,
            "cloud_consent": request.cloud_consent,
        },
    )
