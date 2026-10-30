import pytest
from fastapi.testclient import TestClient

from backend import app as service


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DB", tmp_path / "test.sqlite3")
    monkeypatch.setattr(service, "TOKEN", "test-session")
    return TestClient(service.app)
