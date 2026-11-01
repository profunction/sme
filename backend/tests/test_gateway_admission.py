"""Real SQLite reservation races; mocked, non-billable provider HTTP responses."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from billing_service import app as authority
from backend.tests.test_billing import DEVICE, billing, paid_account  # noqa: F401 -- shared fixture


@pytest.fixture
def gateway(billing, monkeypatch):
    client, _ = billing
    monkeypatch.setenv("NIGHTBREW_GATEWAY_API_KEY", "test-only-gateway-key")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "1")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION", "2")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_MAX_CONCURRENT", "2")
    monkeypatch.setenv("NIGHTBREW_GATEWAY_ACCOUNT_MAX_CONCURRENT", "1")
    identities = []
    for _ in range(2):
        account, auth = paid_account(client, "Business")
        assert client.post("/activate", headers=auth, json={"device_id": DEVICE}).status_code == 200
        identities.append((account["account_id"], auth))
    return client, identities


def request(message="hello"):
    return {"device_id": DEVICE, "request_id": uuid.uuid4().hex,
            "message": message, "cloud_consent": True}


def install_provider(monkeypatch, handler):
    real_client = httpx.Client
    monkeypatch.setattr(authority.httpx, "Client", lambda **kwargs:
                        real_client(transport=httpx.MockTransport(handler), **kwargs))


def answer():
    return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}],
                                    "usage": {"prompt_tokens": 10, "completion_tokens": 20}})


@pytest.mark.parametrize("scope", ["global", "account"])
def test_atomic_admission_rejects_without_charging_and_recovers(gateway, monkeypatch, scope):
    client, identities = gateway
    first_id, first_auth = identities[0]
    second_id, second_auth = identities[1]
    if scope == "global":
        monkeypatch.setenv("NIGHTBREW_GATEWAY_MAX_CONCURRENT", "1")
    started, release = threading.Event(), threading.Event()
    calls = []

    def provider(http_request):
        calls.append(http_request)
        if len(calls) == 1:
            started.set()
            assert release.wait(10), "test did not release the provider fixture"
        return answer()

    install_provider(monkeypatch, provider)
    pending = request("held request")
    rejected = request()
    rejected_id, rejected_auth = (second_id, second_auth) if scope == "global" else (first_id, first_auth)
    with ThreadPoolExecutor(max_workers=1) as workers:
        running = workers.submit(client.post, "/inference", headers=first_auth, json=pending)
        try:
            assert started.wait(5)
            before = client.get("/account", headers=rejected_auth).json()["credits"]
            response = client.post("/inference", headers=rejected_auth, json=rejected)
            assert response.status_code == 429, response.text
            assert client.get("/account", headers=rejected_auth).json()["credits"] == before
            with authority.db() as connection:
                assert not connection.execute(
                    "SELECT 1 FROM inference WHERE account=? AND id=?",
                    (rejected_id, rejected["request_id"]),
                ).fetchone()
            assert len(calls) == 1
            # A second customer may still use the other global slot.
            if scope == "account":
                assert client.post("/inference", headers=second_auth, json=request()).status_code == 200
            # Duplicate in-flight IDs never send a second provider request.
            assert client.post("/inference", headers=first_auth, json=pending).status_code == 409
        finally:
            release.set()
        assert running.result(timeout=5).status_code == 200
    assert client.post("/inference", headers=rejected_auth, json=rejected).status_code == 200


@pytest.mark.parametrize("setting", ["NIGHTBREW_GATEWAY_MAX_CONCURRENT", "NIGHTBREW_GATEWAY_ACCOUNT_MAX_CONCURRENT"])
@pytest.mark.parametrize("value", ["0", "-1", "NaN", "129"])
def test_invalid_limits_fail_before_reservation_or_provider(gateway, monkeypatch, setting, value):
    client, identities = gateway
    _, auth = identities[0]
    monkeypatch.setenv(setting, value)
    install_provider(monkeypatch, lambda _: pytest.fail("must not send provider request"))
    assert client.post("/inference", headers=auth, json=request()).status_code == 503
    assert client.get("/account", headers=auth).json()["credits"] == 10
    with authority.db() as connection:
        assert connection.execute("SELECT COUNT(*) FROM inference").fetchone()[0] == 0


@pytest.mark.parametrize("failure", ["malformed_usage", "timeout"])
def test_unknown_outcome_keeps_money_but_releases_concurrency(gateway, monkeypatch, failure):
    client, identities = gateway
    account_id, auth = identities[0]
    calls = []

    def provider(http_request):
        calls.append(1)
        if len(calls) == 1:
            if failure == "timeout":
                raise httpx.ReadTimeout("test-only provider timeout", request=http_request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "answer"}}], "usage": []})
        return answer()

    install_provider(monkeypatch, provider)
    failed = request()
    estimate = client.post("/inference/estimate", headers=auth, json=failed).json()["estimated_cost_usd"]
    assert client.post("/inference", headers=auth, json=failed).status_code == 502
    with authority.db() as connection:
        row = connection.execute("SELECT * FROM inference WHERE account=? AND id=?", (account_id, failed["request_id"])).fetchone()
        assert row["status"] == "unknown_billed" and row["charged"] == estimate
    assert client.get("/account", headers=auth).json()["credits"] == pytest.approx(10 - estimate)
    assert client.post("/inference", headers=auth, json=failed).status_code == 409
    assert client.post("/inference", headers=auth, json=request()).status_code == 200
    assert len(calls) == 2


def test_crashed_reserved_slot_does_not_expire_or_replay(gateway, monkeypatch):
    client, identities = gateway
    account_id, auth = identities[0]
    install_provider(monkeypatch, lambda _: pytest.fail("reserved slot must fail closed"))
    with authority.db() as connection:
        connection.execute("INSERT INTO inference VALUES(?,?,?,?,?,?)",
                           (account_id, uuid.uuid4().hex, 0.01, "reserved", "2000-01", 0))
    assert client.post("/inference", headers=auth, json=request()).status_code == 429
