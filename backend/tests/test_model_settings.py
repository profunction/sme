import httpx
import pytest

from backend import app as service, store
from backend.tests.test_app import AUTH


def test_model_settings_are_authenticated_and_invalidate_readiness(client):
    assert client.get('/settings/models').status_code == 401
    assert client.put('/settings/models', json={}).status_code == 401
    with service.connect() as db:
        store.put(db, 'benchmark', {'model': 'old-model'})
        store.put(db, 'ai_policy', {'cloud_allowed': True, 'pricing_confirmed': True})
    config = {'local_model': 'small:3b', 'cloud_model': 'new-cloud', 'cloud_url': 'https://provider.example/v1'}
    assert client.put('/settings/models', headers=AUTH, json=config).status_code == 200
    assert client.get('/settings/models', headers=AUTH).json() == config
    with service.connect() as db:
        assert store.get(db, 'benchmark') is None
        policy = store.get(db, 'ai_policy')
        assert policy['cloud_allowed'] is False
        assert policy['pricing_confirmed'] is False


@pytest.mark.parametrize('url', [
    'http://provider.example', 'https://user:secret@provider.example/v1',
    'https://127.0.0.1/v1', 'https://169.254.169.254/v1', 'https://[::1]/v1',
    'https://localhost/v1', 'https://server.internal/v1',
    'https://provider.example:8765/v1', 'https://provider.example/v1?key=secret',
    'https://provider.example/v1#secret', 'https://provider.example/\n',
])
def test_ui_provider_settings_reject_unsafe_destinations(client, url):
    response = client.put('/settings/models', headers=AUTH, json={'cloud_url': url})
    assert response.status_code == 422


def test_saved_provider_and_model_are_used_for_real_adapter_requests(client, monkeypatch):
    config = {'local_model': 'llama3.2:3b', 'cloud_model': 'saved-model', 'cloud_url': 'https://saved-provider.example/v1'}
    assert client.put('/settings/models', headers=AUTH, json=config).status_code == 200
    client.put('/settings/ai', headers=AUTH, json={'cloud_allowed': True, 'pricing_confirmed': True, 'credit_balance_usd': 1})
    monkeypatch.setenv('NIGHTBREW_CLOUD_KEY', 'test-placeholder')
    monkeypatch.setenv('NIGHTBREW_CLOUD_MODEL', 'old-environment-model')
    monkeypatch.setenv('NIGHTBREW_CLOUD_URL', 'https://old-provider.example/v1')
    class Provider:
        def __init__(self, **kwargs):
            assert kwargs['follow_redirects'] is False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            assert url == config['cloud_url'] + '/chat/completions'
            assert kwargs['json']['model'] == config['cloud_model']
            return httpx.Response(200, json={'choices': [{'message': {'content': 'Saved configuration used'}}]}, request=httpx.Request('POST', url))
    monkeypatch.setattr(service.httpx, 'Client', Provider)
    response = client.post('/chat', headers=AUTH, json={'message': 'Test', 'mode': 'CLOUD_ONLY', 'cloud_consent': True})
    assert response.status_code == 200
    assert response.json()['answer'] == 'Saved configuration used'


def test_unchanged_models_preserve_benchmark_and_consent(client):
    config = client.get('/settings/models', headers=AUTH).json()
    with service.connect() as db:
        store.put(db, 'benchmark', {'model': config['local_model']})
        store.put(db, 'ai_policy', {'cloud_allowed': True, 'pricing_confirmed': True})
    client.put('/settings/models', headers=AUTH, json=config)
    with service.connect() as db:
        assert store.get(db, 'benchmark')['model'] == config['local_model']
        assert store.get(db, 'ai_policy')['cloud_allowed'] is True
