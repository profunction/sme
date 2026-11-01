"""Mocked payment protocol regressions; no merchant request or real charge."""

import hashlib
import hmac
import json
import time

import httpx
import pytest
from fastapi import HTTPException

from billing_service import app as authority
from billing_service import payment_validation as payments
from backend.tests.test_billing import billing, paid_account  # noqa: F401 -- shared fixture


SECRET = "test-webhook-secret"


def signed(payload, *, timestamp=None):
    stamp = str(int(time.time()) if timestamp is None else timestamp)
    digest = hmac.new(SECRET.encode(), stamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return {"stripe-signature": f"t={stamp},v1={digest}"}


def event(obj=None, kind="invoice.paid"):
    return {"id": "evt_test", "type": kind,
            "data": {"object": {"id": "in_test", "subscription": "sub_test"} if obj is None else obj}}


@pytest.mark.parametrize("value", [
    None, [], 42, {}, {"id": [], "type": "invoice.paid", "data": {}},
    {"id": "evt_test", "type": 4, "data": {}},
    {"id": "evt_test", "type": "invoice.paid", "data": []},
    {"id": "evt_test", "type": "invoice.paid", "data": {"object": []}},
    event({"id": "in_test", "parent": []}),
    event({"id": "in_test", "parent": {"subscription_details": []}}),
    event({"id": "in_test", "parent": {"subscription_details": {"subscription": {}}}}),
    event({"id": "in_test", "subscription": "sub_test?secret=bad"}),
    event({"id": "in_test", "subscription": "../admin"}),
    event({"id": "in_test", "payment_status": []}, "checkout.session.completed"),
])
def test_signed_malformed_events_return_400_without_mutations(billing, monkeypatch, value):
    client, _ = billing
    monkeypatch.setenv("NIGHTBREW_BILLING_MODE", "stripe")
    monkeypatch.setenv("NIGHTBREW_STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(authority, "stripe_request", lambda *args, **kwargs: pytest.fail("invalid event dispatched provider request"))
    payload = json.dumps(value).encode()
    response = client.post("/stripe/webhook", content=payload, headers=signed(payload))
    assert response.status_code == 400, response.text
    with authority.db() as connection:
        assert connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


@pytest.mark.parametrize("header", [
    "t=1,v1=é", "t=NaN,v1=abcd", "t=1,t=2,v1=abcd", "v1=" + "a" * 64,
    "bad", "t=" + "9" * 100 + ",v1=" + "a" * 64,
])
def test_signature_headers_fail_closed(header):
    with pytest.raises(HTTPException) as error:
        payments.signed_event(b"{}", header, SECRET)
    assert error.value.status_code == 400


def test_signature_key_rotation_whitespace_and_stale_timestamp():
    payload = json.dumps(event()).encode()
    header = signed(payload)["stripe-signature"]
    assert payments.signed_event(payload, "v1=" + "0" * 64 + ", " + header, SECRET)["id"] == "evt_test"
    with pytest.raises(HTTPException) as error:
        payments.signed_event(payload, signed(payload, timestamp=1)["stripe-signature"], SECRET)
    assert error.value.status_code == 400


@pytest.mark.parametrize("current", [
    None, [], {}, {"status": []}, {"status": "unexpected"}, {"status": "active"},
    {"status": "active", "current_period_end": True},
    {"status": "active", "current_period_end": "1000"},
    {"status": "active", "current_period_end": -1},
    {"status": "active", "current_period_end": 10**40},
    {"status": "active", "items": None},
    {"status": "active", "items": []},
    {"status": "active", "items": {"data": [None]}},
    {"status": "active", "items": {"data": {}}},
    {"status": "active", "current_period_end": 1000, "id": "sub_other"},
])
def test_invalid_canonical_subscription_is_controlled_502(current):
    with pytest.raises(HTTPException) as error:
        payments.subscription_state(current, expected_id="sub_test")
    assert error.value.status_code == 502


def test_current_and_legacy_canonical_periods():
    assert payments.subscription_state({"status": "active", "current_period_end": 1000}) == (True, 1000)
    assert payments.subscription_state({"status": "trialing", "items": {"data": [{"current_period_end": 2000}]}}) == (True, 2000)
    assert payments.subscription_state({"status": "canceled"}) == (False, 0)
    assert payments.invoice_subscription({"parent": {"subscription_details": {"subscription": "sub_test"}}}) == "sub_test"
    assert payments.invoice_subscription({"parent": None}) is None


def test_one_off_invoice_does_not_grant_credits_or_retry_forever(billing, monkeypatch):
    client, _ = billing
    _, auth = paid_account(client, "Business")
    before = client.get("/account", headers=auth).json()["credits"]
    monkeypatch.setenv("NIGHTBREW_BILLING_MODE", "stripe")
    monkeypatch.setenv("NIGHTBREW_STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(authority, "stripe_request", lambda *args, **kwargs: pytest.fail("one-off invoice must not query subscription"))
    payload = json.dumps(event({"id": "in_one_off", "parent": None})).encode()
    assert client.post("/stripe/webhook", content=payload, headers=signed(payload)).status_code == 200
    assert client.post("/stripe/webhook", content=payload, headers=signed(payload)).json()["duplicate"]
    assert client.get("/account", headers=auth).json()["credits"] == before


@pytest.mark.parametrize("session", [None, [], {}, {"id": "cs_test", "url": "http://checkout.stripe.com/session"},
                                        {"id": "cs_test", "url": "https://user:secret@checkout.stripe.com/session"},
                                        {"id": "cs_test", "url": "https://checkout.stripe.com:444/session"},
                                        {"id": "../bad", "url": "https://checkout.stripe.com/session"}])
def test_checkout_session_rejects_invalid_payment_destinations(session):
    with pytest.raises(HTTPException) as error:
        payments.checkout_values(session)
    assert error.value.status_code == 502


@pytest.mark.parametrize("response_kind", ["timeout", "http", "json", "shape"])
def test_provider_errors_do_not_leak_secrets_or_become_unhandled(monkeypatch, response_kind):
    real_client = httpx.Client

    def provider(request):
        if response_kind == "timeout":
            raise httpx.ReadTimeout("private-provider-secret", request=request)
        if response_kind == "http":
            return httpx.Response(503, text="private-provider-secret")
        if response_kind == "json":
            return httpx.Response(200, text="private-provider-secret")
        return httpx.Response(200, json=[])

    monkeypatch.setattr(payments.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(provider), **kwargs))
    with pytest.raises(HTTPException) as error:
        payments.provider_request("GET", "/subscriptions/sub_test", "private-provider-secret")
    assert error.value.status_code == 502
    assert "private-provider-secret" not in error.value.detail
