"""Classify real adapter failures using owned responses, never real credentials."""
import httpx
import pytest

from backend import app as service
from backend.tests.test_app import AUTH


def prepare(client, monkeypatch, cloud):
    if cloud:
        monkeypatch.setattr(service.credentials, 'cloud_key', lambda: 'fixture-secret-never-returned')
        client.put('/settings/ai', headers=AUTH, json={
            'cloud_allowed': True, 'pricing_confirmed': True,
            'monthly_limit_usd': 1, 'credit_balance_usd': 1,
            'input_usd_per_million': 1, 'output_usd_per_million': 2,
        })
    return {'message': 'Do not leak business content', 'mode': 'CLOUD_ONLY' if cloud else 'LOCAL_ONLY', 'cloud_consent': cloud}


@pytest.mark.parametrize('cloud,status,code', [
    (True, 401, 'AI_CLOUD_AUTH'), (True, 403, 'AI_CLOUD_AUTH'),
    (True, 402, 'AI_CLOUD_BALANCE'), (True, 404, 'AI_CLOUD_NOT_FOUND'),
    (True, 429, 'AI_CLOUD_RATE_LIMIT'), (True, 400, 'AI_CLOUD_REQUEST'),
    (True, 302, 'AI_CLOUD_REQUEST'), (True, 503, 'AI_CLOUD_SERVER'),
    (False, 404, 'AI_LOCAL_MODEL_MISSING'), (False, 500, 'AI_LOCAL_SERVER'),
])
def test_http_failure_is_specific_and_sanitized(client, monkeypatch, cloud, status, code):
    payload = prepare(client, monkeypatch, cloud)
    original = httpx.Client
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={'error': 'fixture-secret-never-returned', 'echo': payload['message']})
    monkeypatch.setattr(service.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    response = client.post('/chat', headers=AUTH, json=payload)
    assert response.status_code == 502
    detail = response.json()['detail']
    assert detail['code'] == code and detail['provider_status'] == status
    assert detail['mode'] == payload['mode']
    assert detail['model'] == ('deepseek-chat' if cloud else 'llama3.2:3b')
    assert 'fixture-secret' not in response.text and payload['message'] not in response.text
    assert len(calls) == 1  # No automatic retry or provider fallback.
    assert str(calls[0].url).endswith('/chat/completions' if cloud else '/api/chat')
    assert client.get('/messages', headers=AUTH).json() == []
    if cloud:
        # Keep the existing conservative estimate when provider billing is
        # unknown. It must not be presented as a verified provider charge.
        entries = client.get('/usage', headers=AUTH).json()['entries']
        assert len(entries) == 1 and entries[0]['status'] == 'failed_estimated'
        assert client.get('/settings/ai', headers=AUTH).json()['credit_balance_usd'] == pytest.approx(1 - entries[0]['cost'])


@pytest.mark.parametrize('cloud,exception,code', [
    (True, httpx.ConnectError, 'AI_CLOUD_NETWORK'), (False, httpx.ConnectError, 'AI_LOCAL_OFFLINE'),
    (True, httpx.ReadTimeout, 'AI_CLOUD_TIMEOUT'), (False, httpx.ReadTimeout, 'AI_LOCAL_TIMEOUT'),
])
def test_transport_failures_do_not_expose_sensitive_exception_text(client, monkeypatch, cloud, exception, code):
    payload = prepare(client, monkeypatch, cloud)
    def fail(**kw):
        raise exception('fixture-secret-never-returned')
    monkeypatch.setattr(service.httpx, 'Client', fail)
    response = client.post('/chat', headers=AUTH, json=payload)
    assert response.json()['detail']['code'] == code
    assert 'fixture-secret' not in response.text


@pytest.mark.parametrize('cloud', [False, True])
def test_invalid_provider_reply_is_distinct_from_an_invalid_key(client, monkeypatch, cloud):
    payload = prepare(client, monkeypatch, cloud)
    original = httpx.Client
    monkeypatch.setattr(service.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'unexpected': 'fixture-secret-never-returned'})), **kw))
    response = client.post('/chat', headers=AUTH, json=payload)
    assert response.json()['detail']['code'] == ('AI_CLOUD_RESPONSE' if cloud else 'AI_LOCAL_RESPONSE')
    assert 'fixture-secret' not in response.text
