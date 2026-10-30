"""Native vault selection must not silently use another keyring backend."""
from types import SimpleNamespace

import pytest

from backend import credentials


def test_macos_uses_explicit_keychain_backend(monkeypatch):
    import sys

    sentinel = object()
    monkeypatch.setattr(credentials.sys, 'platform', 'darwin')
    monkeypatch.setitem(sys.modules, 'keyring.backends.macOS', SimpleNamespace(Keyring=lambda: sentinel))
    assert credentials.native_vault() is sentinel


def test_linux_never_falls_back_to_plaintext(monkeypatch):
    monkeypatch.setattr(credentials.sys, 'platform', 'linux')
    monkeypatch.delenv('NIGHTBREW_CLOUD_KEY', raising=False)
    assert credentials.cloud_key() is None
    with pytest.raises(ValueError):
        credentials.save_key('test-placeholder')


def test_macos_cloud_key_reads_native_vault(monkeypatch):
    monkeypatch.setattr(credentials.sys, 'platform', 'darwin')
    monkeypatch.delenv('NIGHTBREW_CLOUD_KEY', raising=False)
    calls = []
    monkeypatch.setattr(credentials, 'native_vault', lambda: SimpleNamespace(
        get_password=lambda service, name: calls.append((service, name)) or 'placeholder'))
    assert credentials.cloud_key() == 'placeholder'
    assert calls == [('NightBrew', 'cloud-api-key')]
