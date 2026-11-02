"""Provider checks use mocked HTTP; no real API credentials or paid inference."""
import httpx
import pytest

from backend import app as service, licensing, store
from backend.tests.test_app import AUTH
from backend.tests.test_documents import PAYLOAD, wait
from backend.tests.test_workforce import create_employee


def test_task_detail_reports_actual_approved_result(client):
    employee = create_employee(client)
    receipt = client.post('/tasks', headers=AUTH, json={
        'tool': 'document.generate', 'employee_id': employee['id'], 'payload': PAYLOAD,
    }).json()
    path = '/tasks/' + receipt['id']
    assert client.get(path).status_code == 401
    assert client.get('/tasks/not-found', headers=AUTH).status_code == 404
    pending = client.get(path, headers=AUTH).json()
    assert pending['employee_id'] == employee['id']
    assert pending['status'] == 'pending_approval' and pending['result'] is None
    client.post(path + '/approve', headers=AUTH)
    wait(client, receipt['id'])
    completed = client.get(path, headers=AUTH).json()
    assert completed['status'] == 'completed'
    file = client.get('/files/' + completed['result']['file']['id'], headers=AUTH)
    assert file.content.startswith(b'%PDF')


def test_connection_metadata_never_returns_key(client, monkeypatch):
    monkeypatch.setattr(service.credentials, 'cloud_key', lambda: 'fixture-secret-not-real')
    assert client.get('/settings/cloud-connection').status_code == 401
    response = client.get('/settings/cloud-connection', headers=AUTH)
    assert response.json()['key_present'] is True
    assert 'fixture-secret' not in response.text


def test_provider_check_requires_explicit_consent_and_sends_no_content(client, monkeypatch):
    calls = []
    monkeypatch.setattr(service.credentials, 'cloud_key', lambda: 'fixture-secret-not-real')
    original = httpx.Client

    def handler(request):
        calls.append(request)
        assert str(request.url) == 'https://api.deepseek.com/v1/models'
        assert request.headers['Authorization'] == 'Bearer fixture-secret-not-real'
        assert request.method == 'GET' and not request.content
        return httpx.Response(200, json={'data': [{'id': 'deepseek-chat'}]})

    monkeypatch.setattr(service.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    path = '/settings/cloud-connection/test'
    assert client.post(path, headers=AUTH, json={}).status_code == 403
    assert not calls
    response = client.post(path, headers=AUTH, json={'consent': True})
    assert response.json() == {'authenticated': True, 'model_available': True, 'inference_tested': False}
    assert 'fixture-secret' not in response.text
    assert client.post(path, headers=AUTH, json={'consent': True}).status_code == 429
    assert len(calls) == 1


@pytest.mark.parametrize('status,body', [(401, {'error': 'fixture-secret'}), (302, {}), (200, {'wrong': []}), (200, {'data': None})])
def test_connection_failures_are_sanitized(client, monkeypatch, status, body):
    monkeypatch.setattr(service.credentials, 'cloud_key', lambda: 'fixture-secret-not-real')
    original = httpx.Client
    monkeypatch.setattr(service.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(lambda _: httpx.Response(status, json=body)), **kw))
    response = client.post('/settings/cloud-connection/test', headers=AUTH, json={'consent': True})
    assert response.status_code == 502
    assert 'fixture-secret' not in response.text


def test_byok_preview_keeps_paid_authority_unavailable(client, monkeypatch):
    monkeypatch.setenv('NIGHTBREW_ENV', 'byok-preview')
    monkeypatch.setenv('NIGHTBREW_BYOK_PREVIEW', '1')
    monkeypatch.setenv('NIGHTBREW_ENFORCE_LICENSE', '0')
    assert client.get('/license', headers=AUTH).json()['claims']['environment'] == 'byok_preview'
    with pytest.raises(ValueError, match='no cloud gateway'):
        licensing.remote('/checkout', {})
    assert client.put('/settings/ai', headers=AUTH, json={'billing_source': 'INCLUDED'}).status_code == 403
    # Even a manually edited SQLite policy cannot unlock shared gateway funding.
    with service.connect() as db:
        store.put(db, 'ai_policy', {'billing_source': 'INCLUDED', 'cloud_allowed': True})
    for path in ('/chat', '/ai/estimate'):
        assert client.post(path, headers=AUTH, json={'message': 'test', 'mode': 'CLOUD_ONLY', 'cloud_consent': True}).status_code == 403


def test_byok_preview_cloud_still_requires_consent_and_budget(client, monkeypatch):
    monkeypatch.setenv('NIGHTBREW_ENV', 'byok-preview')
    monkeypatch.setenv('NIGHTBREW_BYOK_PREVIEW', '1')
    monkeypatch.setenv('NIGHTBREW_ENFORCE_LICENSE', '0')
    monkeypatch.setattr(service.credentials, 'cloud_key', lambda: 'fixture-secret-not-real')
    original = httpx.Client
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': 'Test answer'}}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}})
    monkeypatch.setattr(service.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    policy = {'cloud_allowed': True, 'pricing_confirmed': True, 'input_usd_per_million': 1, 'output_usd_per_million': 2, 'credit_balance_usd': 1, 'monthly_limit_usd': 1}
    assert client.put('/settings/ai', headers=AUTH, json=policy).status_code == 200
    request = {'message': 'User approved fixture', 'mode': 'CLOUD_ONLY'}
    assert client.post('/chat', headers=AUTH, json=request).status_code == 403
    request['cloud_consent'] = True
    assert client.post('/chat', headers=AUTH, json=request).json()['answer'] == 'Test answer'
    assert len(calls) == 1
    client.put('/settings/ai', headers=AUTH, json={**policy, 'monthly_limit_usd': 0})
    assert client.post('/chat', headers=AUTH, json=request).status_code == 402
    assert len(calls) == 1
