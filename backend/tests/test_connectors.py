import httpx
import pytest

from backend import connectors, store
from backend.tests.test_app import AUTH
from backend.tests.test_documents import wait


def configure(client, identifier="mock-wms", **changes):
    configs = client.get("/connectors", headers=AUTH).json()
    config = next(c for c in configs if c["id"] == identifier)
    keys = connectors.Connector.model_fields
    config = {key: value for key, value in config.items() if key in keys}
    response = client.put("/connectors", headers=AUTH, json={**config, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def test_registry_and_all_plan_entitlements(client):
    configs = client.get("/connectors", headers=AUTH).json()
    assert {c["category"] for c in configs} == {"ERP", "POS", "WMS", "TMS"}
    assert all(c["mock"] and not c["vendor_verified"] for c in configs)
    for plan in connectors.PLANS:
        for category in connectors.CATEGORIES:
            assert connectors.entitled(plan, category)
    plans = client.get("/plans", headers=AUTH).json()
    assert plans["all_connectors_in_every_plan"] is True
    for config in configs:
        assert (
            client.post(f"/connectors/{config['id']}/test", headers=AUTH).json()["mock"]
            is True
        )


def test_read_write_permissions_and_approval(client):
    assert (
        client.post(
            "/connectors/mock-wms/writes",
            headers=AUTH,
            json={"record": {"id": "stock", "quantity": 9}},
        ).status_code
        == 422
    )
    configure(client, read_enabled=False, write_enabled=True)
    assert client.get("/connectors/mock-wms/records", headers=AUTH).status_code == 422
    configure(client, read_enabled=True, write_enabled=True)
    task = client.post(
        "/connectors/mock-wms/writes",
        headers=AUTH,
        json={"record": {"id": "stock", "quantity": 9}},
    ).json()
    assert task["status"] == "pending_approval"
    assert not any(
        r["id"] == "stock"
        for r in client.get("/connectors/mock-wms/records", headers=AUTH).json()["data"]
    )
    assert (
        client.post("/tasks/" + task["id"] + "/approve", headers=AUTH).status_code
        == 200
    )
    assert wait(client, task["id"])["status"] == "completed"
    assert any(
        r["id"] == "stock"
        for r in client.get("/connectors/mock-wms/records", headers=AUTH).json()["data"]
    )
    assert (
        client.post("/tasks/" + task["id"] + "/approve", headers=AUTH).status_code
        == 409
    )
    assert any(
        row["event"] == "connector_write"
        for row in client.get("/audit", headers=AUTH).json()
    )


def test_permission_revoked_after_approval_requested(client):
    configure(client, write_enabled=True)
    task = client.post(
        "/connectors/mock-wms/writes",
        headers=AUTH,
        json={"record": {"id": "stock", "quantity": 9}},
    ).json()
    configure(client, write_enabled=False)
    client.post("/tasks/" + task["id"] + "/approve", headers=AUTH)
    assert wait(client, task["id"])["status"] == "failed"
    assert not any(
        r["id"] == "stock"
        for r in client.get("/connectors/mock-wms/records", headers=AUTH).json()["data"]
    )


def test_rate_limit_and_no_task_bypass(client):
    configure(client, requests_per_minute=1)
    assert client.get("/connectors/mock-wms/records", headers=AUTH).status_code == 200
    assert client.get("/connectors/mock-wms/records", headers=AUTH).status_code == 422
    assert (
        client.post(
            "/tasks", headers=AUTH, json={"tool": "connector.write", "payload": {}}
        ).status_code
        == 403
    )


def rest_config(monkeypatch, **changes):
    monkeypatch.setenv("NIGHTBREW_CONNECTOR_ALLOWED_HOSTS", "api.vendor.example")
    return connectors.Connector(
        id="vendor-api",
        name="Vendor API",
        category="API",
        kind="rest",
        base_url="https://api.vendor.example/v1",
        auth_env="NIGHTBREW_CONNECTOR_VENDOR_KEY",
        write_enabled=True,
        **changes,
    )


def test_rest_retries_auth_and_sanitized_audit(tmp_path, monkeypatch):
    config = rest_config(monkeypatch)
    monkeypatch.setenv(config.auth_env, "test-secret-not-real")
    connect = lambda: store.open_db(tmp_path / "db.sqlite3")
    connectors.save(connect, config)
    calls = []

    def handler(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer test-secret-not-real"
        assert str(request.url) == "https://api.vendor.example/v1/records"
        return httpx.Response(
            503 if len(calls) == 1 else 200, json={"records": [{"id": "one"}]}
        )

    real_client = httpx.Client
    monkeypatch.setattr(
        connectors.httpx,
        "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    response = connectors.read(connect, config.id)
    assert response["data"]["records"][0]["id"] == "one"
    assert len(calls) == 2
    with connect() as db:
        serialized = str([dict(row) for row in db.execute("SELECT * FROM audit")])
        assert "test-secret-not-real" not in serialized
        assert "records" not in serialized


def test_rest_writes_never_retry(tmp_path, monkeypatch):
    config = rest_config(monkeypatch)
    monkeypatch.setenv(config.auth_env, "test-secret")
    connect = lambda: store.open_db(tmp_path / "db.sqlite3")
    connectors.save(connect, config)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503, json={"error": "do not leak secrets"})

    real_client = httpx.Client
    monkeypatch.setattr(
        connectors.httpx,
        "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    payload = connectors.prepare_write(
        connect, config.id, connectors.Write(record={"id": "one"})
    )
    with pytest.raises(ValueError, match="outcome may be unknown"):
        connectors.write(connect, payload, lambda: None)
    assert len(calls) == 1


def test_rest_rejects_destinations_redirects_and_credential_leaks(
    tmp_path, monkeypatch
):
    for url in [
        "http://api.vendor.example",
        "https://evil.example",
        "https://api.vendor.example@evil.example",
        "https://127.0.0.1",
        "https://api.vendor.example:444",
        "https://api.vendor.example/%2fsecret",
    ]:
        monkeypatch.setenv(
            "NIGHTBREW_CONNECTOR_ALLOWED_HOSTS", "api.vendor.example,127.0.0.1"
        )
        with pytest.raises(ValueError):
            connectors.Connector(
                id="test-api", name="test", category="API", kind="rest", base_url=url
            )
    config = rest_config(monkeypatch)
    monkeypatch.setenv(config.auth_env, "test-secret")
    connect = lambda: store.open_db(tmp_path / "db.sqlite3")
    connectors.save(connect, config)
    real_client = httpx.Client
    monkeypatch.setattr(
        connectors.httpx,
        "Client",
        lambda **kw: real_client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    302, headers={"location": "https://evil.example"}
                )
            ),
            **kw,
        ),
    )
    with pytest.raises(ValueError):
        connectors.read(connect, config.id)
    monkeypatch.setenv("NIGHTBREW_CONNECTOR_ALLOWED_HOSTS", "")
    with pytest.raises(ValueError):
        connectors.get(connect, config.id)


def test_approved_mock_payload_is_immutable(client):
    configure(client, write_enabled=True)
    task = client.post(
        "/connectors/mock-wms/writes",
        headers=AUTH,
        json={"record": {"id": "immutable", "quantity": 1}},
    ).json()
    assert (
        client.put(
            "/tasks/" + task["id"], headers=AUTH, json={"record": {"quantity": 999}}
        ).status_code
        == 404
    )
    client.post("/tasks/" + task["id"] + "/approve", headers=AUTH)
    result = wait(client, task["id"])
    assert result["result"]["data"]["quantity"] == 1
