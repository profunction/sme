import json

import pytest
from fastapi import HTTPException

from billing_service import model_registry, provider


@pytest.mark.parametrize('url', ['https://127.0.0.1/v1', 'https://169.254.169.254/v1',
    'https://localhost/v1', 'https://service.internal/v1', 'https://example.com/%2e%2e/v1',
    'https://example.com/../v1', 'https://example.com//v1', 'https://127.1/v1',
    'https://127.0.0.1./v1', 'https://localhost./v1', 'https://127%2e0%2e0%2e1/v1'])
def test_gateway_does_not_attach_keys_to_private_or_ambiguous_endpoints(monkeypatch, url):
    monkeypatch.setenv('NIGHTBREW_GATEWAY_URL', url)
    monkeypatch.setenv('NIGHTBREW_GATEWAY_API_KEY', 'test-key')
    with pytest.raises(HTTPException) as caught:
        provider.configuration()
    assert caught.value.status_code == 503
    assert 'test-key' not in str(caught.value.detail)


@pytest.mark.parametrize('key', [' ', 'test\nkey', 'test\tkey', '非ASCII', 'key\x7f'])
def test_invalid_key_fails_before_reserving_or_dispatching(monkeypatch, key):
    monkeypatch.setenv('NIGHTBREW_GATEWAY_API_KEY', key)
    with pytest.raises(HTTPException):
        provider.configuration()


def test_capability_and_context_gates_are_administrator_owned(monkeypatch):
    monkeypatch.setenv('NIGHTBREW_GATEWAY_MODELS_JSON', json.dumps({'chosen': {
        'capabilities': ['TEXT'], 'max_input_bytes': 100, 'max_output_tokens': 512,
        'context_window_tokens': 800,
    }}))
    assert model_registry.validate_text_request('chosen', 'hello', '', 512).verification_status == 'UNVERIFIED'
    for model, capabilities in [('chosen', {'VISION'}), ('unlisted', {'TEXT'})]:
        with pytest.raises(HTTPException):
            model_registry.require_capabilities(model, capabilities)
    with pytest.raises(HTTPException):
        model_registry.validate_text_request('chosen', 'a' * 33, '', 512)
    with pytest.raises(HTTPException):
        model_registry.validate_text_request('chosen', 'hi', '', 513)


def test_production_refuses_implicit_or_unverified_model_claims(monkeypatch):
    monkeypatch.setenv('NIGHTBREW_ENV', 'production')
    monkeypatch.delenv('NIGHTBREW_GATEWAY_MODELS_JSON', raising=False)
    with pytest.raises(HTTPException):
        model_registry.resolve('chosen')
    entry = {'capabilities': ['TEXT'], 'context_window_tokens': 800,
             'verification_status': 'UNVERIFIED', 'source': 'https://provider.example/docs'}
    monkeypatch.setenv('NIGHTBREW_GATEWAY_MODELS_JSON', json.dumps({'chosen': entry}))
    with pytest.raises(HTTPException):
        model_registry.resolve('chosen')
    entry['verification_status'] = 'VERIFIED'
    monkeypatch.setenv('NIGHTBREW_GATEWAY_MODELS_JSON', json.dumps({'chosen': entry}))
    assert model_registry.validate_text_request('chosen', 'hi', '', 512).verification_status == 'VERIFIED'
