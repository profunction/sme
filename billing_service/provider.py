"""Server-only OpenAI-compatible provider selection; no secrets returned to clients."""
import os
import ipaddress
from urllib.parse import urlsplit

from fastapi import HTTPException

DEFAULT_URL = 'https://api.deepseek.com/v1'
DEFAULT_MODEL = 'deepseek-chat'


def public_endpoint(url):
    host = (url.hostname or '').rstrip('.').lower()
    if (not host or '.' not in host or all(c in '0123456789.' for c in host)
            or '%' in host or '\\' in host
            or host.endswith(('.local', '.localhost', '.internal', '.lan', '.home', '.home.arpa'))):
        return False
    try:
        if not ipaddress.ip_address(host).is_global:
            return False
    except ValueError:
        pass
    # Reject ambiguous normalization and encoded paths before attaching a secret.
    return not any(part in url.path for part in ('%', '\\', '..', '//'))


def configuration(require_key=True):
    key = os.getenv('NIGHTBREW_GATEWAY_API_KEY', '')
    model = os.getenv('NIGHTBREW_GATEWAY_MODEL', DEFAULT_MODEL).strip()
    base = os.getenv('NIGHTBREW_GATEWAY_URL', DEFAULT_URL).rstrip('/')
    try:
        url = urlsplit(base)
        valid = (url.scheme == 'https' and url.hostname and not url.username
                 and not url.password and not url.query and not url.fragment
                 and url.port in (None, 443) and not any(ord(c) < 33 for c in base)
                 and public_endpoint(url))
    except ValueError:
        valid = False
    if (not valid or not model or len(model) > 256 or any(ord(c) < 33 for c in model)
            or (require_key and (not key or len(key) > 4096 or any(not 33 <= ord(c) <= 126 for c in key)))):
        raise HTTPException(503, 'Configure a provider model, secure API key and HTTPS API root without embedded credentials')
    return key, model, base
