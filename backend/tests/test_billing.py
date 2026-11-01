import base64
import hashlib
import hmac
import json
import time
import uuid

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from backend import licensing, store
from billing_service import app as authority

ADMIN = {"Authorization": "Bearer test-authority-admin"}
DEVICE = "a" * 64


@pytest.fixture
def billing(tmp_path, monkeypatch):
    monkeypatch.setattr(authority, "DB", tmp_path / "authority.sqlite3")
    monkeypatch.setenv("NIGHTBREW_BILLING_ADMIN_KEY", "test-authority-admin")
    monkeypatch.setenv("NIGHTBREW_BILLING_MODE", "mock")
    key = Ed25519PrivateKey.generate()
    private = (
        base64.urlsafe_b64encode(
            key.private_bytes(
                serialization.Encoding.Raw,
                serialization.PrivateFormat.Raw,
                serialization.NoEncryption(),
            )
        )
        .decode()
        .rstrip("=")
    )
    public = (
        base64.urlsafe_b64encode(
            key.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw
            )
        )
        .decode()
        .rstrip("=")
    )
    monkeypatch.setenv("NIGHTBREW_LICENSE_PRIVATE_KEY", private)
    monkeypatch.setenv("NIGHTBREW_LICENSE_PUBLIC_KEY", public)
    return TestClient(authority.app), public


def paid_account(client, plan="Starter"):
    account = client.post("/admin/accounts", headers=ADMIN, json={"plan": plan}).json()
    auth = {"Authorization": "Bearer " + account["account_key"]}
    checkout = client.post("/checkout", headers=auth, json={"sku": plan}).json()
    result = client.post(
        "/mock/confirm", headers=ADMIN, json={"checkout_id": checkout["id"]}
    )
    assert result.status_code == 200, result.text
    return account, auth


def test_signed_activation_expiry_device_limit_and_forgery(billing, monkeypatch):
    client, public = billing
    _account, auth = paid_account(client)
    token = client.post("/activate", headers=auth, json={"device_id": DEVICE}).json()[
        "grant"
    ]
    with pytest.raises(ValueError):
        licensing.verify(token, public, DEVICE)
    monkeypatch.setenv("NIGHTBREW_ALLOW_MOCK_LICENSE", "1")
    grant = licensing.verify(token, public, DEVICE)
    assert grant["plan"] == "Starter" and grant["employee_limit"] == 2
    with pytest.raises(ValueError):
        licensing.verify(token, public, "b" * 64)
    with pytest.raises(ValueError):
        licensing.verify(token, public, DEVICE, now=grant["exp"] + 1)
    _data, signature = token.split(".")
    forged = (
        base64.urlsafe_b64encode(json.dumps({"plan": "Enterprise"}).encode())
        .decode()
        .rstrip("=")
        + "."
        + signature
    )
    with pytest.raises(ValueError):
        licensing.verify(forged, public, DEVICE)
    assert (
        client.post("/activate", headers=auth, json={"device_id": "b" * 64}).status_code
        == 403
    )
    addon = client.post("/checkout", headers=auth, json={"sku": "computer"}).json()
    client.post("/mock/confirm", headers=ADMIN, json={"checkout_id": addon["id"]})
    assert (
        client.post("/activate", headers=auth, json={"device_id": "b" * 64}).status_code
        == 200
    )


def test_authority_quotas_seats_and_idempotency(billing, monkeypatch):
    client, _ = billing
    config = json.loads(json.dumps(authority.PLAN_DEFAULTS))
    config["Starter"]["monthly_tasks"] = 1
    monkeypatch.setenv("NIGHTBREW_BILLING_PLANS_JSON", json.dumps(config))
    _, auth = paid_account(client)
    client.post("/activate", headers=auth, json={"device_id": DEVICE})
    operation = {"device_id": DEVICE, "operation_id": uuid.uuid4().hex}
    assert (
        client.post("/quota/reserve", headers=auth, json=operation).status_code == 200
    )
    assert client.post("/quota/reserve", headers=auth, json=operation).json()[
        "duplicate"
    ]
    assert (
        client.post(
            "/quota/reserve",
            headers=auth,
            json={**operation, "operation_id": uuid.uuid4().hex},
        ).status_code
        == 403
    )
    for _ in range(2):
        assert (
            client.post(
                "/employees/register",
                headers=auth,
                json={"employee_id": uuid.uuid4().hex, "device_id": DEVICE},
            ).status_code
            == 200
        )
    assert (
        client.post(
            "/employees/register",
            headers=auth,
            json={"employee_id": uuid.uuid4().hex, "device_id": DEVICE},
        ).status_code
        == 403
    )


def test_unpaid_local_database_cannot_activate(billing, tmp_path, monkeypatch):
    client, _public = billing
    created = client.post(
        "/admin/accounts", headers=ADMIN, json={"plan": "Enterprise"}
    ).json()
    auth = {"Authorization": "Bearer " + created["account_key"]}
    assert (
        client.post("/activate", headers=auth, json={"device_id": DEVICE}).status_code
        == 403
    )
    connect = lambda: store.open_db(tmp_path / "desktop.sqlite3")
    with connect() as db:
        store.put(db, "license_grant", '{"paid":true,"plan":"Enterprise"}')
    monkeypatch.setenv("NIGHTBREW_ENFORCE_LICENSE", "1")
    with pytest.raises(ValueError):
        licensing.enforce(connect)


def webhook_header(payload, secret):
    timestamp = str(int(time.time()))
    signature = hmac.new(
        secret.encode(), timestamp.encode() + b"." + payload, hashlib.sha256
    ).hexdigest()
    return {"stripe-signature": f"t={timestamp},v1={signature}"}


def test_stripe_signed_webhook_is_idempotent_and_canonical(billing, monkeypatch):
    client, _ = billing
    _account, auth = paid_account(client, "Business")
    checkout = client.post("/checkout", headers=auth, json={"sku": "Business"}).json()
    monkeypatch.setenv("NIGHTBREW_BILLING_MODE", "stripe")
    monkeypatch.setenv("NIGHTBREW_STRIPE_WEBHOOK_SECRET", "test-webhook-secret")
    monkeypatch.setattr(
        authority,
        "stripe_request",
        lambda *args, **kwargs: {
            "status": "active",
            "current_period_end": int(time.time()) + 1000,
        },
    )
    event = {
        "id": "evt-checkout",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": checkout["id"],
                "payment_status": "paid",
                "subscription": "sub_test",
            }
        },
    }
    payload = json.dumps(event).encode()
    assert client.post("/stripe/webhook", content=payload).status_code == 400
    headers = webhook_header(payload, "test-webhook-secret")
    assert (
        client.post("/stripe/webhook", headers=headers, content=payload).status_code
        == 200
    )
    assert client.post("/stripe/webhook", headers=headers, content=payload).json()[
        "duplicate"
    ]
    # Initial Stripe checkout does not double-credit the first paid invoice.
    assert client.get("/account", headers=auth).json()["credits"] == 10
    invoice = {
        "id": "evt-invoice",
        "type": "invoice.paid",
        "data": {"object": {"id": "in_test", "subscription": "sub_test"}},
    }
    payload = json.dumps(invoice).encode()
    client.post(
        "/stripe/webhook",
        headers=webhook_header(payload, "test-webhook-secret"),
        content=payload,
    )
    assert client.get("/account", headers=auth).json()["credits"] == 20
    invoice["id"] = "evt-other-same-invoice"
    payload = json.dumps(invoice).encode()
    client.post(
        "/stripe/webhook",
        headers=webhook_header(payload, "test-webhook-secret"),
        content=payload,
    )
    assert client.get("/account", headers=auth).json()["credits"] == 20
    assert (
        client.post(
            "/mock/confirm", headers=ADMIN, json={"checkout_id": checkout["id"]}
        ).status_code
        == 404
    )


def test_gateway_uses_server_prices_and_records_provider_usage(billing, monkeypatch):
    client, _ = billing
    _, auth = paid_account(client, "Business")
    client.post("/activate", headers=auth, json={"device_id": DEVICE})
    monkeypatch.setenv("NIGHTBREW_GATEWAY_API_KEY", "test-gateway-key")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_MODEL", "test-model")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "1")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION", "2")
    real_client = httpx.Client

    def handler(request):
        assert request.headers["Authorization"] == "Bearer test-gateway-key"
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "Gateway answer"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20},
            },
        )

    monkeypatch.setattr(
        authority.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    data = {
        "device_id": DEVICE,
        "request_id": uuid.uuid4().hex,
        "message": "hello",
        "cloud_consent": True,
        "input_price": 0,
    }
    result = client.post("/inference", headers=auth, json=data)
    assert result.status_code == 200, result.text
    assert result.json()["cost_usd"] == pytest.approx(0.00005)
    assert client.get("/account", headers=auth).json()["credits"] == pytest.approx(
        9.99995
    )
    assert client.post("/inference", headers=auth, json=data).status_code == 409


def test_desktop_activation_and_online_quota_use_verified_grants(
    billing, tmp_path, monkeypatch
):
    client, _ = billing
    _, auth = paid_account(client)
    monkeypatch.setenv("NIGHTBREW_ENFORCE_LICENSE", "1")
    monkeypatch.setenv("NIGHTBREW_ALLOW_MOCK_LICENSE", "1")
    monkeypatch.setattr(licensing, "device_id", lambda: DEVICE)

    def remote(path, body=None):
        response = (
            client.post(path, headers=auth, json=body)
            if body is not None
            else client.get(path, headers=auth)
        )
        if response.status_code >= 300:
            raise ValueError("Authority rejected operation")
        return response.json()

    monkeypatch.setattr(licensing, "remote", remote)
    connect = lambda: store.open_db(tmp_path / "desktop.sqlite3")
    assert licensing.activate(connect)["plan"] == "Starter"
    licensing.reserve_task(connect, uuid.uuid4().hex)
    with authority.db() as db:
        db.execute("UPDATE accounts SET active=0")
    with pytest.raises(ValueError):
        licensing.reserve_task(connect, uuid.uuid4().hex)


def test_gateway_rejects_unconfigured_or_invalid_prices(billing, monkeypatch):
    client, _ = billing
    _, auth = paid_account(client, "Business")
    client.post("/activate", headers=auth, json={"device_id": DEVICE})
    monkeypatch.setenv("NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "nan")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION", "-1")
    response = client.post(
        "/inference/estimate",
        headers=auth,
        json={
            "device_id": DEVICE,
            "request_id": uuid.uuid4().hex,
            "message": "hello",
            "cloud_consent": True,
        },
    )
    assert response.status_code == 503


def test_licensed_queue_reserves_and_executes_idempotently(
    billing, tmp_path, monkeypatch
):
    from backend import tasks
    from backend.tests.test_documents import PAYLOAD

    client, _ = billing
    _, auth = paid_account(client)
    monkeypatch.setenv("NIGHTBREW_ENFORCE_LICENSE", "1")
    monkeypatch.setenv("NIGHTBREW_ALLOW_MOCK_LICENSE", "1")
    monkeypatch.setattr(licensing, "device_id", lambda: DEVICE)

    def remote(path, body=None):
        response = (
            client.post(path, headers=auth, json=body)
            if body is not None
            else client.get(path, headers=auth)
        )
        if response.status_code >= 300:
            raise ValueError("Authority rejected operation")
        return response.json()

    monkeypatch.setattr(licensing, "remote", remote)
    connect = lambda: store.open_db(tmp_path / "desktop.sqlite3")
    licensing.activate(connect)
    identifier, _ = tasks.create(connect, "document.generate", PAYLOAD)
    tasks.execute(connect, tmp_path / "desktop.sqlite3", identifier)
    with connect() as db:
        assert db.execute("SELECT status FROM tasks").fetchone()[0] == "completed"
    with authority.db() as db:
        assert db.execute("SELECT COUNT(*) FROM operations").fetchone()[0] == 1


def test_deepseek_gateway_defaults_and_secret_boundary(billing, monkeypatch):
    client, _ = billing
    _, auth = paid_account(client, 'Business')
    client.post('/activate', headers=auth, json={'device_id':DEVICE})
    monkeypatch.delenv('NIGHTBREW_GATEWAY_URL', raising=False)
    monkeypatch.delenv('NIGHTBREW_GATEWAY_MODEL', raising=False)
    monkeypatch.setenv('NIGHTBREW_GATEWAY_API_KEY','deepseek-test-placeholder')
    monkeypatch.setenv('NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION','1')
    monkeypatch.setenv('NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION','2')
    real_client=httpx.Client
    calls=[]
    def handler(request):
        calls.append(request)
        assert str(request.url)=='https://api.deepseek.com/v1/chat/completions'
        assert request.headers['Authorization']=='Bearer deepseek-test-placeholder'
        payload=json.loads(request.content)
        assert payload['model']=='deepseek-chat'
        assert payload['stream'] is False
        assert payload['max_tokens']==512
        return httpx.Response(200,json={'choices':[{'message':{'content':'Test provider reply'}}],'usage':{'prompt_tokens':10,'completion_tokens':20}})
    monkeypatch.setattr(authority.httpx,'Client',lambda **kw:real_client(transport=httpx.MockTransport(handler),**kw))
    body={'device_id':DEVICE,'request_id':uuid.uuid4().hex,'message':'Approved test text','cloud_consent':False}
    assert client.post('/inference',headers=auth,json=body).status_code==403
    assert calls==[]
    body['cloud_consent']=True
    estimate=client.post('/inference/estimate',headers=auth,json=body)
    assert estimate.json()['model']=='deepseek-chat'
    result=client.post('/inference',headers=auth,json=body)
    assert result.status_code==200,result.text
    assert result.json()['cost_usd']==pytest.approx(0.00005)
    assert 'deepseek-test-placeholder' not in result.text
    assert client.post('/inference',headers=auth,json=body).status_code==409
    assert len(calls)==1


@pytest.mark.parametrize('endpoint',['http://api.deepseek.com/v1','https://secret:key@api.deepseek.com/v1','https://api.deepseek.com/v1?api_key=secret','https://api.deepseek.com:8443/v1'])
def test_gateway_provider_url_validation(monkeypatch,endpoint):
    from billing_service.provider import configuration
    monkeypatch.setenv('NIGHTBREW_GATEWAY_URL',endpoint)
    monkeypatch.setenv('NIGHTBREW_GATEWAY_API_KEY','not-a-real-key')
    from fastapi import HTTPException
    with pytest.raises(HTTPException):configuration()
