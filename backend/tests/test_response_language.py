import httpx

from backend import ai
from backend import app as service
from backend.tests.test_app import AUTH


def test_reply_language_uses_system_context_without_rewriting_user_history(client, monkeypatch):
    seen = []
    real = httpx.Client
    def handler(request):
        import json
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={'message': {'content': 'Fixture reply'}})
    monkeypatch.setattr(service.httpx, 'Client', lambda **kwargs: real(transport=httpx.MockTransport(handler), **kwargs))
    response = client.post('/chat', headers=AUTH, json={'message': 'Confirmed Friday dispatch.',
        'response_language': 'en', 'intent': 'reply', 'mode': 'LOCAL_ONLY'})
    assert response.status_code == 200
    assert seen[0]['messages'][0]['role'] == 'system'
    assert 'Reply in English.' in seen[0]['messages'][0]['content']
    assert 'Do not send' in seen[0]['messages'][0]['content']
    assert client.get('/messages', headers=AUTH).json()[0]['content'] == 'Confirmed Friday dispatch.'


def test_default_clients_do_not_gain_automation_or_change_existing_context():
    assert ai.instructions(ai.Chat(message='hello'), 'Company policy') == 'Company policy'
    assert ai.instructions(ai.Chat(message='hello', response_language='zh')).startswith('请用中文')
