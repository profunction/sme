"""Personal website security and real endpoint flow with mocked provider responses."""
import hashlib
import json
import time

from cryptography.fernet import Fernet
import httpx
import pytest
from fastapi.testclient import TestClient

from backend import store
from backend.web_ai import COOKIE, WebConfig, create_web_app, password_hash

ORIGIN = 'http://127.0.0.1:8787'
PASSWORD = 'fixture-owner-password-123'
API_KEY = 'fixture-provider-key-never-returned'

@pytest.fixture
def website(tmp_path):
    calls = []
    def provider(request):
        calls.append(request)
        assert request.headers['Authorization'] == 'Bearer ' + API_KEY
        if request.url.path == '/v1/models':
            return httpx.Response(200, json={'data': [{'id': 'deepseek-chat'}]})
        return httpx.Response(200, json={'choices': [{'message': {'content': 'Owned provider fixture answer'}}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}})
    config = WebConfig(tmp_path/'web.sqlite3', password_hash(PASSWORD), Fernet.generate_key().decode(), origin=ORIGIN)
    factory = lambda **kw: httpx.Client(transport=httpx.MockTransport(provider), **kw)
    client = TestClient(create_web_app(config, client_factory=factory), base_url=ORIGIN)
    return client, config, calls


def login(client):
    response = client.post('/web-api/login', headers={'Origin': ORIGIN}, json={'password': PASSWORD})
    assert response.status_code == 200, response.text
    return {'Origin': ORIGIN, 'X-CSRF-Token': response.json()['csrf_token']}


def configure(client, headers):
    assert client.put('/web-api/key', headers=headers, json={'key': API_KEY}).status_code == 200
    response = client.put('/web-api/settings', headers=headers, json={'model': 'deepseek-chat', 'policy': {
        'billing_source': 'BYOK', 'cloud_allowed': True, 'pricing_confirmed': True,
        'monthly_limit_usd': 1, 'credit_balance_usd': 1,
        'input_usd_per_million': 1, 'output_usd_per_million': 2,
    }})
    assert response.status_code == 200, response.text


def test_owner_login_cookie_csrf_logout_and_no_desktop_access(website):
    client, config, calls = website
    assert client.get('/web-api/status').json()['authenticated'] is False
    assert client.put('/web-api/key', headers={'Origin': ORIGIN}, json={'key': API_KEY}).status_code == 401
    assert client.post('/web-api/login', headers={'Origin': 'https://attacker.example'}, json={'password': PASSWORD}).status_code == 403
    headers = login(client)
    cookie = client.cookies.get(COOKIE)
    assert cookie and len(cookie) > 30
    assert client.put('/web-api/key', headers={'Origin': ORIGIN}, json={'key': API_KEY}).status_code == 403
    assert client.get('/hardware').status_code == 404
    assert client.post('/tasks', headers=headers, json={'tool':'windows.run'}).status_code == 404
    assert client.post('/web-api/logout', headers=headers).status_code == 200
    assert not client.get('/web-api/status').json()['authenticated']
    # Replaying the old cookie cannot restore the revoked session.
    client.cookies.set(COOKIE, cookie)
    assert client.get('/web-api/usage').status_code == 401
    assert not calls


def test_key_is_encrypted_and_never_read_back(website):
    client, config, _ = website
    headers = login(client)
    response = client.put('/web-api/key', headers=headers, json={'key': API_KEY})
    assert response.json()['stored'] is True
    status = client.get('/web-api/status')
    assert status.json()['settings']['key_present'] is True
    assert API_KEY not in status.text and PASSWORD not in status.text
    with store.open_db(config.database) as db:
        encrypted = store.get(db, 'web_key_ciphertext')
        rows = str([dict(row) for row in db.execute('SELECT * FROM audit')])
    assert encrypted != API_KEY and API_KEY not in rows
    assert Fernet(config.master_key.encode()).decrypt(encrypted.encode()).decode() == API_KEY
    assert API_KEY.encode() not in config.database.read_bytes()
    client.put('/web-api/key', headers=headers, json={'key': ''})
    assert not client.get('/web-api/status').json()['settings']['key_present']


def test_actual_key_test_chat_consent_privacy_and_budget(website):
    client, _, calls = website
    headers = login(client)
    configure(client, headers)
    assert client.post('/web-api/test', headers=headers, json={}).status_code == 403
    check = client.post('/web-api/test', headers=headers, json={'consent': True})
    assert check.json() == {'endpoint_reachable': True, 'model_listed': True, 'inference_tested': False}
    assert client.post('/web-api/test', headers=headers, json={'consent': True}).status_code == 429
    assert len(calls) == 1
    assert client.post('/web-api/chat', headers=headers, json={'message':'hello'}).status_code == 403
    assert client.post('/web-api/chat', headers=headers, json={'message':'private','consent':True,'private':True}).status_code == 403
    assert len(calls) == 1
    result = client.post('/web-api/chat', headers=headers, json={'message':'hello','consent':True,'language':'en'})
    assert result.status_code == 200, result.text
    assert result.json()['answer'] == 'Owned provider fixture answer'
    assert len(calls) == 2
    payload = json.loads(calls[-1].content)
    assert payload['stream'] is False and payload['messages'][0]['content'] == 'Reply in English.'
    settings = client.get('/web-api/status').json()['settings']
    settings['policy']['monthly_limit_usd'] = 0
    client.put('/web-api/settings', headers=headers, json={k:v for k,v in settings.items() if k != 'key_present'})
    assert client.post('/web-api/chat', headers=headers, json={'message':'over budget','consent':True}).status_code == 402
    assert len(calls) == 2


def test_malformed_secret_inputs_do_not_echo_and_requests_are_bounded(website):
    client, _, _ = website
    headers = login(client)
    bad = client.put('/web-api/key', headers=headers, json={'key': {'secret': API_KEY}})
    assert bad.status_code == 422 and API_KEY not in bad.text
    bad = client.put('/web-api/key', headers=headers, json={'key': 'Bearer ' + API_KEY})
    assert bad.status_code == 422 and API_KEY not in bad.text
    large = client.post('/web-api/chat', headers=headers, content=b'x'*65537)
    assert large.status_code == 413
    assert client.put('/web-api/key', headers={**headers, 'Origin':'https://attacker.example'}, json={'key':API_KEY}).status_code == 403


def test_session_expiry_and_rate_limit(website):
    client, config, _ = website
    headers = login(client)
    with store.open_db(config.database) as db:
        db.execute('UPDATE web_sessions SET expires=?', (time.time()-1,))
    assert client.get('/web-api/usage').status_code == 401
    for _ in range(7):
        assert client.post('/web-api/login', headers={'Origin': ORIGIN}, json={'password':'wrong'}).status_code == 401
    assert client.post('/web-api/login', headers={'Origin': ORIGIN}, json={'password':PASSWORD}).status_code == 429


def test_config_refuses_public_http_and_weak_setup(tmp_path):
    with pytest.raises(ValueError):
        WebConfig(tmp_path/'x', password_hash(PASSWORD), Fernet.generate_key().decode(), origin='http://public.example').validate()
    with pytest.raises(ValueError): password_hash('short')


def test_provider_errors_are_classified_without_secret_body(tmp_path):
    calls = []
    def reject(request):
        calls.append(request)
        return httpx.Response(402, json={'error':API_KEY})
    config = WebConfig(tmp_path/'web.sqlite3', password_hash(PASSWORD), Fernet.generate_key().decode(), origin=ORIGIN)
    app = create_web_app(config, client_factory=lambda **kw: httpx.Client(transport=httpx.MockTransport(reject), **kw))
    client = TestClient(app, base_url=ORIGIN)
    headers = login(client); configure(client, headers)
    response = client.post('/web-api/chat', headers=headers, json={'message':'hello','consent':True})
    assert response.json()['detail']['code'] == 'AI_CLOUD_BALANCE'
    assert API_KEY not in response.text and len(calls) == 1


def test_https_cookie_is_http_only_secure_and_session_tokens_are_hashed(tmp_path):
    origin = 'https://workspace.example'
    config = WebConfig(tmp_path/'web.sqlite3', password_hash(PASSWORD), Fernet.generate_key().decode(), origin=origin)
    client = TestClient(create_web_app(config), base_url=origin)
    response = client.post('/web-api/login', headers={'Origin':origin}, json={'password':PASSWORD})
    header = response.headers['set-cookie'].lower()
    assert 'httponly' in header and 'secure' in header and 'samesite=strict' in header
    token = client.cookies.get(COOKIE)
    with store.open_db(config.database) as db:
        stored = db.execute('SELECT token_hash FROM web_sessions').fetchone()[0]
    assert stored == hashlib.sha256(token.encode()).hexdigest() and stored != token


def test_concurrent_chat_limit_does_not_reserve_or_dispatch_a_third_call(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    gate = threading.Event()
    both_started = threading.Event()
    guard = threading.Lock()
    calls = []
    def provider(request):
        with guard:
            calls.append(request)
            if len(calls) == 2: both_started.set()
        assert gate.wait(10), 'fixture timed out waiting for release'
        return httpx.Response(200, json={'choices':[{'message':{'content':'bounded fixture'}}], 'usage':{'prompt_tokens':10,'completion_tokens':5}})
    config = WebConfig(tmp_path/'web.sqlite3', password_hash(PASSWORD), Fernet.generate_key().decode(), origin=ORIGIN)
    app = create_web_app(config, client_factory=lambda **kw: httpx.Client(transport=httpx.MockTransport(provider), **kw))
    client = TestClient(app, base_url=ORIGIN)
    headers = login(client); configure(client, headers)
    def send():return client.post('/web-api/chat', headers=headers, json={'message':'bounded call','consent':True})
    with ThreadPoolExecutor(max_workers=2) as pool:
        first,second = pool.submit(send),pool.submit(send)
        try:
            assert both_started.wait(5)
            assert send().status_code == 429
            assert len(client.get('/web-api/usage').json()['entries']) == 2
        finally:gate.set()
        assert first.result().status_code == second.result().status_code == 200
    assert len(calls) == 2
