"""Server-only OpenAI-compatible provider selection; no secrets returned to clients."""
import os
from urllib.parse import urlsplit

from fastapi import HTTPException

DEFAULT_URL = 'https://api.deepseek.com/v1'
DEFAULT_MODEL = 'deepseek-chat'


def configuration(require_key=True):
    key = os.getenv('NIGHTBREW_GATEWAY_API_KEY', '')
    model = os.getenv('NIGHTBREW_GATEWAY_MODEL', DEFAULT_MODEL).strip()
    base = os.getenv('NIGHTBREW_GATEWAY_URL', DEFAULT_URL).rstrip('/')
    try:
        url = urlsplit(base)
        valid = (url.scheme == 'https' and url.hostname and not url.username
                 and not url.password and not url.query and not url.fragment
                 and url.port in (None, 443) and not any(ord(c) < 33 for c in base))
    except ValueError:
        valid = False
    if not valid or not model or any(ord(c) < 32 for c in model) or (require_key and not key):
        raise HTTPException(503, 'Configure a provider model, secure API key and HTTPS API root without embedded credentials')
    return key, model, base
