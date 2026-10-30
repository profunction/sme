import httpx

from backend import app as service

AUTH = {"Authorization": "Bearer test-session"}


def test_auth(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/messages").status_code == 401
    assert client.post("/chat", json={"message": "hi"}).status_code == 401


def test_consent(client):
    assert (
        client.post(
            "/chat", headers=AUTH, json={"message": "hi", "mode": "CLOUD_ONLY"}
        ).status_code
        == 403
    )


def test_missing_key(client, monkeypatch):
    monkeypatch.delenv("NIGHTBREW_CLOUD_KEY", raising=False)
    client.put("/settings/ai", headers=AUTH, json={"cloud_allowed": True})
    assert (
        client.post(
            "/chat",
            headers=AUTH,
            json={"message": "hi", "mode": "CLOUD_ONLY", "cloud_consent": True},
        ).status_code
        == 503
    )


def test_persistence(client, monkeypatch):
    class Provider:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            assert url.endswith("/api/chat")
            return httpx.Response(
                200,
                json={"message": {"content": "Hello"}},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(service.httpx, "Client", Provider)
    assert (
        client.post("/chat", headers=AUTH, json={"message": "hi"}).json()["answer"]
        == "Hello"
    )
    assert len(client.get("/messages", headers=AUTH).json()) == 2


def test_failure(client, monkeypatch):
    def fail(**kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(service.httpx, "Client", fail)
    assert client.post("/chat", headers=AUTH, json={"message": "hi"}).status_code == 502
    assert client.get("/messages", headers=AUTH).json() == []


def test_mode(client):
    assert (
        client.post(
            "/chat", headers=AUTH, json={"message": "hi", "mode": "INVALID"}
        ).status_code
        == 422
    )


def test_cloud_adapter(client, monkeypatch):
    client.put(
        "/settings/ai",
        headers=AUTH,
        json={
            "cloud_allowed": True,
            "pricing_confirmed": True,
            "credit_balance_usd": 1,
        },
    )
    monkeypatch.setenv("NIGHTBREW_CLOUD_KEY", "test-key")
    monkeypatch.setenv("NIGHTBREW_CLOUD_MODEL", "test-model")
    monkeypatch.setenv("NIGHTBREW_CLOUD_URL", "https://provider.example/v1")

    class Provider:
        def __init__(self, **kwargs):
            assert kwargs["follow_redirects"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            assert url == "https://provider.example/v1/chat/completions"
            assert kwargs["headers"]["Authorization"] == "Bearer test-key"
            assert kwargs["json"]["model"] == "test-model"
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "Cloud answer"}}]},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(service.httpx, "Client", Provider)
    assert (
        client.post(
            "/chat",
            headers=AUTH,
            json={"message": "hi", "mode": "CLOUD_ONLY", "cloud_consent": True},
        ).json()["answer"]
        == "Cloud answer"
    )
