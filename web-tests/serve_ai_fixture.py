"""Owned browser-test server: no real keys, model calls or production deployment."""
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryptography.fernet import Fernet
import httpx
import uvicorn
from backend.web_ai import WebConfig, create_web_app, password_hash


def provider(request):
    assert request.headers['Authorization'] == 'Bearer fixture-provider-key-for-web-ui'
    if request.url.path == '/v1/models':
        return httpx.Response(200, json={'data': [{'id':'deepseek-chat'}]})
    return httpx.Response(200, json={'choices':[{'message':{'content':'Owned browser-test AI answer'}}], 'usage':{'prompt_tokens':10,'completion_tokens':5}})

config = WebConfig(Path(os.environ['NIGHTBREW_WEB_TEST_DATABASE']), password_hash('fixture-owner-password-123'), Fernet.generate_key().decode(), origin='http://127.0.0.1:8789', frontend=Path('build/web-preview').resolve())
app = create_web_app(config, client_factory=lambda **kw: httpx.Client(transport=httpx.MockTransport(provider), **kw))
uvicorn.run(app, host='127.0.0.1', port=8789, access_log=False)
