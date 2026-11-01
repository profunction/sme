"""Regression cases for malformed licenses, duplicate settlement and local quotas."""

import base64
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend import ai, licensing, model_settings, store, workforce
from backend import app as service
from backend.tests.test_app import AUTH


def signed(changes=None):
    key = Ed25519PrivateKey.generate()
    claims = {"iss": "nightbrew-license-authority", "aud": "nightbrew-desktop",
              "version": 1, "device_id": "a" * 64, "account_id": "b" * 32,
              "nbf": 1000, "exp": 2000, "environment": "production",
              "plan": "Starter", "employee_limit": 2, "monthly_tasks": 1000}
    claims.update(changes or {})
    encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=")
    signature = base64.urlsafe_b64encode(key.sign(encoded)).rstrip(b"=")
    public = base64.urlsafe_b64encode(key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode().rstrip("=")
    return (encoded + b"." + signature).decode(), public


@pytest.mark.parametrize("token", [None, [], {}, True, 1, "", ".", "x.y", "a" * 40000])
def test_malformed_license_values_are_rejected_without_crash(token):
    _, public = signed()
    with pytest.raises(ValueError):
        licensing.verify(token, public, device="a" * 64, now=1500)


@pytest.mark.parametrize("claims", [
    {"employee_limit": True}, {"version": True}, {"monthly_tasks": True},
    {"environment": "attacker"}, {"account_id": "invalid"},
    {"exp": 1000000}, {"nbf": True}, {"monthly_tasks": -1},
])
def test_signed_but_invalid_claims_fail_closed(claims):
    token, public = signed(claims)
    with pytest.raises(ValueError):
        licensing.verify(token, public, device="a" * 64, now=1500)


def test_valid_signed_claims_still_work():
    token, public = signed()
    assert licensing.verify(token, public, device="a" * 64, now=1500)["employee_limit"] == 2


@pytest.mark.parametrize("result", [None, [], {}, {"grant": False}])
def test_invalid_activation_response_is_reported_as_validation_error(client, monkeypatch, result):
    monkeypatch.setattr(licensing, "remote", lambda *args: result)
    response = client.post("/license/activate", headers=AUTH)
    assert response.status_code == 422
    assert "invalid activation" in response.json()["detail"]


@pytest.mark.parametrize("url", [
    "https://localhost./v1", "https://127.0.0.1./v1", "https://127.1/v1",
    "https://2130706433/v1", "https://private.lan/v1", "https://provider.example:bad/v1",
    "https://127%2e0%2e0%2e1/v1", "https://[::1]/v1",
])
def test_request_and_saved_url_validation_share_private_destination_rules(url):
    with pytest.raises(ValueError):
        ai.cloud_base(url)
    with pytest.raises(ValueError):
        model_settings.Models(cloud_url=url)


def reserved(tmp_path):
    connect = lambda: store.open_db(tmp_path / "cost.sqlite3")
    policy = ai.Policy(cloud_allowed=True, pricing_confirmed=True,
                       credit_balance_usd=1, input_usd_per_million=1,
                       output_usd_per_million=100)
    with connect() as db:
        store.put(db, "ai_policy", policy.model_dump())
    identifier, amount = ai.reserve(connect, "test-model", ai.Chat(message="hello"), policy)
    return connect, policy, identifier, amount


def test_settlement_refunds_only_once_under_concurrency(tmp_path):
    connect, policy, identifier, _ = reserved(tmp_path)
    usage = {"prompt_tokens": 10, "completion_tokens": 20}
    with ThreadPoolExecutor(max_workers=3) as workers:
        list(workers.map(lambda _: ai.settle(connect, identifier, usage, policy, True), range(3)))
    with connect() as db:
        assert store.get(db, "ai_policy")["credit_balance_usd"] == pytest.approx(1 - 0.00201)
    ai.settle(connect, identifier, None, policy, False)
    with connect() as db:
        assert store.get(db, "ai_policy")["credit_balance_usd"] == pytest.approx(1 - 0.00201)


@pytest.mark.parametrize("cost", [-1, float("nan"), float("inf"), True, "not-money", 2])
def test_invalid_or_excess_cost_holds_reservation_and_disables_cloud(tmp_path, cost):
    connect, policy, identifier, amount = reserved(tmp_path)
    with pytest.raises(ValueError, match="reconciliation"):
        ai.settle(connect, identifier, None, policy, True, actual_cost=cost)
    with connect() as db:
        current = store.get(db, "ai_policy")
        assert current["credit_balance_usd"] == pytest.approx(1 - amount)
        assert current["cloud_allowed"] is False
        assert db.execute("SELECT status FROM usage").fetchone()[0] == "reconciliation_required"
    # A second error handler must not undo the hold/refund again.
    ai.settle(connect, identifier, None, policy, False)


@pytest.mark.parametrize("usage", [[], {"prompt_tokens": -1, "completion_tokens": 2},
                                    {"prompt_tokens": 10, "completion_tokens": 100000}])
def test_invalid_provider_usage_requires_reconciliation(tmp_path, usage):
    connect, policy, identifier, _ = reserved(tmp_path)
    with pytest.raises(ValueError, match="reconciliation"):
        ai.settle(connect, identifier, usage, policy, True)


def test_local_employee_chat_quota_is_atomic_and_retries_count(tmp_path):
    connect = lambda: store.open_db(tmp_path / "employee.sqlite3")
    employee = workforce.save(connect, workforce.Employee(name="Assistant", role="Sales",
                                                          tools=["ai.chat"], monthly_task_limit=1))

    def reserve(_):
        try:
            workforce.reserve_chat(connect, employee["id"], uuid.uuid4().hex)
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=3) as workers:
        assert sum(workers.map(reserve, range(3))) == 1
    with connect() as db:
        row = db.execute("SELECT * FROM employee_chat_operations").fetchone()
    workforce.reserve_chat(connect, employee["id"], row["id"])
    with connect() as db:
        assert db.execute("SELECT COUNT(*) FROM employee_chat_operations").fetchone()[0] == 1


def test_chat_route_rejects_employee_retry_before_provider_dispatch(client, monkeypatch):
    employee = client.post("/employees", headers=AUTH, json={
        "name": "Sales", "role": "Sales", "tools": ["ai.chat"], "monthly_task_limit": 1,
    }).json()
    calls = []

    class Provider:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            calls.append(1)
            # Failed accepted attempts still consume the quota.
            raise httpx.ReadTimeout("test-only timeout")

    monkeypatch.setattr(service.httpx, "Client", Provider)
    payload = {"message": "Test", "employee_id": employee["id"]}
    assert client.post("/chat", headers=AUTH, json=payload).status_code == 502
    assert client.post("/chat", headers=AUTH, json=payload).status_code == 403
    assert len(calls) == 1
