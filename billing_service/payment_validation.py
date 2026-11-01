"""Bounded parsing of untrusted payment payloads; no paid operation is initiated here."""

import hashlib
import hmac
import json
import re
import time
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

_ID = re.compile(r"[A-Za-z0-9_-]{1,255}\Z")
_EVENT = re.compile(r"[a-z][a-z0-9_.]{0,199}\Z")
_SUBSCRIPTION_STATUSES = {
    "incomplete", "incomplete_expired", "trialing", "active", "past_due",
    "canceled", "unpaid", "paused",
}
_HANDLED_EVENTS = {
    "checkout.session.completed", "customer.subscription.updated",
    "customer.subscription.deleted", "charge.refunded", "invoice.paid",
}


def identifier(value):
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def signed_event(payload, header, secret, *, now=None):
    """Verify before parsing. Any invalid signature/envelope fails with a safe 400."""
    try:
        if not isinstance(payload, bytes) or len(payload) > 1024 * 1024:
            raise ValueError()
        if not secret or not isinstance(header, str) or len(header) > 8192:
            raise ValueError()
        pieces = {}
        for piece in header.split(","):
            key, value = piece.strip().split("=", 1)
            pieces.setdefault(key, []).append(value)
        timestamps = pieces.get("t", [])
        if len(timestamps) != 1 or not re.fullmatch(r"[0-9]{1,12}", timestamps[0]):
            raise ValueError()
        timestamp = int(timestamps[0])
        if abs((time.time() if now is None else now) - timestamp) > 300:
            raise ValueError()
        expected = hmac.new(
            secret.encode(), timestamps[0].encode() + b"." + payload, hashlib.sha256
        ).hexdigest()
        valid = any(
            re.fullmatch(r"[a-fA-F0-9]{64}", item) is not None
            and hmac.compare_digest(expected, item.lower())
            for item in pieces.get("v1", [])
        )
        if not valid:
            raise ValueError()
        event = json.loads(payload)
        return event_envelope(event)
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        raise HTTPException(400, "Invalid payment webhook signature or payload") from None


def event_envelope(event):
    if not isinstance(event, dict) or not identifier(event.get("id")):
        raise ValueError("Invalid event identifier")
    kind = event.get("type")
    data = event.get("data")
    if not isinstance(kind, str) or not _EVENT.fullmatch(kind) or not isinstance(data, dict):
        raise ValueError("Invalid event envelope")
    obj = data.get("object")
    if not isinstance(obj, dict):
        raise ValueError("Invalid event object")
    if kind not in _HANDLED_EVENTS:
        return event
    if not identifier(obj.get("id")):
        raise ValueError("Invalid payment object identifier")
    for field in ("subscription", "payment_intent", "customer"):
        if obj.get(field) is not None and not identifier(obj[field]):
            raise ValueError("Invalid payment reference")
    if kind == "checkout.session.completed":
        if obj.get("payment_status") not in {"paid", "unpaid", "no_payment_required"}:
            raise ValueError("Invalid checkout payment status")
    if kind == "invoice.paid":
        parent = obj.get("parent")
        if parent is not None:
            if not isinstance(parent, dict):
                raise ValueError("Invalid invoice parent")
            details = parent.get("subscription_details")
            if details is not None:
                if not isinstance(details, dict):
                    raise ValueError("Invalid invoice subscription details")
                if details.get("subscription") is not None and not identifier(details["subscription"]):
                    raise ValueError("Invalid invoice subscription reference")
    return event


def invoice_subscription(obj):
    """One-off invoices have no subscription and must not grant subscription credits."""
    if obj.get("subscription"):
        return obj["subscription"]
    return ((obj.get("parent") or {}).get("subscription_details") or {}).get("subscription")


def subscription_state(current, *, expected_id=None):
    """Canonical state must be structurally valid before updating local entitlements."""
    try:
        if not isinstance(current, dict) or current.get("status") not in _SUBSCRIPTION_STATUSES:
            raise ValueError()
        if current.get("id") is not None:
            if not identifier(current["id"]) or (expected_id and current["id"] != expected_id):
                raise ValueError()
        periods = []
        if current.get("current_period_end") is not None:
            periods.append(current["current_period_end"])
        items = current.get("items")
        if items is not None:
            if not isinstance(items, dict) or not isinstance(items.get("data"), list):
                raise ValueError()
            for item in items["data"]:
                if not isinstance(item, dict):
                    raise ValueError()
                if item.get("current_period_end") is not None:
                    periods.append(item["current_period_end"])
        if any(type(period) is not int or not 0 <= period <= 32503680000 for period in periods):
            raise ValueError()
        expires = max(periods, default=0)
        paid = current["status"] in {"active", "trialing"}
        if paid and not expires:
            raise ValueError()
        return paid, expires
    except (ValueError, TypeError):
        raise HTTPException(502, "Payment provider returned invalid subscription state") from None


def checkout_values(session):
    try:
        if not isinstance(session, dict) or not identifier(session.get("id")):
            raise ValueError()
        value = session.get("url")
        if not isinstance(value, str) or len(value) > 4096 or any(ord(char) < 33 for char in value):
            raise ValueError()
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.fragment or parsed.port not in (None, 443)):
            raise ValueError()
        return session["id"], value
    except (ValueError, TypeError):
        raise HTTPException(502, "Payment provider returned an invalid checkout session") from None


def provider_request(method, path, key, data=None):
    """Keep transport/provider errors out of FastAPI's unhandled error path and logs."""
    try:
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            response = client.request(
                method, "https://api.stripe.com/v1" + path, data=data,
                headers={"Authorization": "Bearer " + key},
            )
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (httpx.HTTPError, ValueError, TypeError, RecursionError):
        raise HTTPException(502, "Payment provider request failed; verify outcome before retrying") from None
