"""Exact server accounting invariants with synthetic, nonbillable provider responses."""
import json
import uuid
from decimal import Decimal

import httpx
import pytest

from backend.tests.test_billing import ADMIN, DEVICE, billing, paid_account  # noqa: F401
from billing_service import accounting
from billing_service import app as authority


@pytest.fixture
def funded(billing, monkeypatch):
    client, _ = billing
    account, auth = paid_account(client, "Business")
    assert client.post("/activate", headers=auth, json={"device_id": DEVICE}).status_code == 200
    monkeypatch.setenv("NIGHTBREW_GATEWAY_API_KEY", "test-only-key")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "1")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION", "2")
    return client, account["account_id"], auth


def body():
    return {"device_id": DEVICE, "request_id": uuid.uuid4().hex,
            "message": "hello", "cloud_consent": True}


def provider(monkeypatch, usage, callback=lambda: None):
    real = httpx.Client
    def handler(_):
        callback()
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": usage})
    monkeypatch.setattr(authority.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_float_projection_cannot_grant_spending(funded, monkeypatch):
    client, account, auth = funded
    with authority.db() as db:
        db.execute("BEGIN IMMEDIATE")
        accounting.change(db, account, "exhaust", Decimal("-10"), "test")
        db.execute("UPDATE accounts SET credits=1000000 WHERE id=?", (account,))
    provider(monkeypatch, {}, lambda: pytest.fail("must not send unpaid inference"))
    assert client.post("/inference", headers=auth, json=body()).status_code == 402
    assert client.get("/account", headers=auth).json()["available_usd_exact"] == "0"


def test_decimal_entries_are_exact_and_idempotent(funded):
    client, account, auth = funded
    with authority.db() as db:
        db.execute("BEGIN IMMEDIATE")
        for n in range(100):
            assert accounting.change(db, account, f"credit{n}", Decimal("0.1"), "test")
            assert accounting.change(db, account, f"debit{n}", Decimal("-0.03"), "test")
            assert not accounting.change(db, account, f"debit{n}", Decimal("-0.03"), "test")
        assert accounting.balance(db, account) == Decimal("17")
    assert Decimal(client.get("/account", headers=auth).json()["available_usd_exact"]) == Decimal("17")


def test_snapshot_and_settlement_ignore_later_rate_changes(funded, monkeypatch):
    client, account, auth = funded
    def change_prices():
        monkeypatch.setenv("NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "9999")
        monkeypatch.setenv("NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION", "9999")
    provider(monkeypatch, {"prompt_tokens": 10, "completion_tokens": 20}, change_prices)
    request = body()
    response = client.post("/inference", headers=auth, json=request)
    assert response.status_code == 200, response.text
    assert response.json()["cost_usd_exact"] == "0.00005"
    with authority.db() as db:
        row = db.execute("SELECT * FROM inference_costs WHERE account=? AND id=?", (account, request["request_id"])).fetchone()
        snapshot = json.loads(row["snapshot"])
        assert snapshot["input_usd_per_million"] == "1"
        assert snapshot["output_usd_per_million"] == "2"
        assert row["reported_cost_usd"] == "0.00005"
        assert accounting.balance(db, account) == Decimal("9.99995")


@pytest.mark.parametrize("usage", [{"prompt_tokens": 9999999, "completion_tokens": 1},
                                     {"prompt_tokens": 1, "completion_tokens": 513}])
def test_excess_provider_usage_holds_without_hidden_debt(funded, monkeypatch, usage):
    client, account, auth = funded
    provider(monkeypatch, usage)
    request = body()
    estimate = client.post("/inference/estimate", headers=auth, json=request).json()["estimated_cost_usd_exact"]
    assert client.post("/inference", headers=auth, json=request).status_code == 502
    status = client.get("/account", headers=auth).json()
    assert status["accounting_state"] == "hold"
    assert Decimal(status["available_usd_exact"]) == Decimal("10") - Decimal(estimate)
    assert client.post("/inference", headers=auth, json=body()).status_code == 409
    with authority.db() as db:
        row = db.execute("SELECT * FROM inference_costs WHERE account=? AND id=?", (account, request["request_id"])).fetchone()
        assert row["outcome"] == "usage_discrepancy"
        assert Decimal(row["reported_cost_usd"]) > Decimal(estimate) or usage["completion_tokens"] > 512
    path = f"/admin/accounts/{account}/inference/{request['request_id']}/reconcile"
    assert client.post(path, headers=auth, json={"final_customer_cost_usd": "0", "review_reference": "review"}).status_code == 401
    assert client.post(path, headers=ADMIN, json={"final_customer_cost_usd": "100", "review_reference": "review"}).status_code == 409
    review = {"final_customer_cost_usd": "0", "review_reference": "Provider reviewed, NightBrew absorbs disputed cost"}
    assert client.post(path, headers=ADMIN, json=review).status_code == 200
    assert client.post(path, headers=ADMIN, json=review).status_code == 409
    status = client.get("/account", headers=auth).json()
    assert status["accounting_state"] == "active" and Decimal(status["available_usd_exact"]) == 10


@pytest.mark.parametrize("usage", [None, {}, {"prompt_tokens": True, "completion_tokens": 1},
                                     {"prompt_tokens": -1, "completion_tokens": 1},
                                     {"prompt_tokens": 1, "completion_tokens": "12"}])
def test_invalid_usage_retains_unknown_reservation(funded, monkeypatch, usage):
    client, account, auth = funded
    provider(monkeypatch, usage)
    request = body()
    assert client.post("/inference", headers=auth, json=request).status_code == 502
    with authority.db() as db:
        row = db.execute("SELECT * FROM inference_costs WHERE account=? AND id=?", (account, request["request_id"])).fetchone()
        assert row["outcome"] == "unknown_billed"
        assert accounting.balance(db, account) < 10
    assert client.post("/inference", headers=auth, json=request).status_code == 409


def test_legacy_opening_requires_explicit_review_and_cannot_repeat(funded, monkeypatch):
    client, account, auth = funded
    with authority.db() as db:
        db.execute("DELETE FROM money_accounts WHERE account=?", (account,))
        db.execute("DELETE FROM money_entries WHERE account=?", (account,))
    provider(monkeypatch, {}, lambda: pytest.fail("legacy balance must be reviewed"))
    assert client.post("/inference", headers=auth, json=body()).status_code == 503
    path = f"/admin/accounts/{account}/opening-balance"
    data = {"expected_legacy_usd": "10", "reviewed_opening_usd": "9.99", "review_reference": "opening balance approved"}
    assert client.post(path, headers=auth, json=data).status_code == 401
    assert client.post(path, headers=ADMIN, json={**data, "expected_legacy_usd": "11"}).status_code == 409
    assert client.post(path, headers=ADMIN, json=data).status_code == 200
    assert client.post(path, headers=ADMIN, json=data).status_code == 409
    assert client.get("/account", headers=auth).json()["available_usd_exact"] == "9.99"
