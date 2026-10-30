import os
import platform
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from backend import automation, store
from backend.tests.test_app import AUTH
from backend.tests.test_documents import wait


@pytest.fixture
def website():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b'<html><body><h1>Approved test site</h1><input id="name"><button onclick="document.querySelector("h1").textContent="Done"">Apply</button></body></html>'
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()
    thread.join()


def test_real_browser_approved_plan_and_screenshot(client, website, monkeypatch):
    monkeypatch.setenv("NIGHTBREW_ENV", "test")
    executable = os.getenv("NIGHTBREW_TEST_BROWSER", "/usr/bin/chromium")
    if not Path(executable).is_file():
        pytest.skip("Test browser not installed on this OS")
    monkeypatch.setenv("NIGHTBREW_BROWSER_EXECUTABLE", executable)
    client.put(
        "/automation/policy", headers=AUTH, json={"browser_hosts": ["127.0.0.1"]}
    )
    plan = {
        "url": website,
        "steps": [
            {"action": "read", "selector": "h1", "expected_text": "Approved test site"},
            {
                "action": "fill",
                "selector": "#name",
                "text": "NightBrew",
                "expected_text": "NightBrew",
            },
            {"action": "screenshot"},
        ],
    }
    response = client.post(
        "/tasks", headers=AUTH, json={"tool": "browser.run", "payload": plan}
    )
    assert response.status_code == 201, response.text
    identifier = response.json()["id"]
    assert response.json()["status"] == "pending_approval"
    client.post("/tasks/" + identifier + "/approve", headers=AUTH)
    task = wait(client, identifier)
    assert task["status"] == "completed", task
    assert task["result"]["steps"][0]["verified"] is True
    screenshot = client.get(
        "/files/" + task["result"]["artifacts"][0]["id"], headers=AUTH
    )
    assert screenshot.content.startswith(b"\x89PNG")


def test_automation_cannot_execute_code_or_bypass_policy(client):
    assert (
        client.post(
            "/tasks",
            headers=AUTH,
            json={
                "tool": "browser.run",
                "payload": {
                    "url": "https://evil.example",
                    "steps": [{"action": "read"}],
                },
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/tasks",
            headers=AUTH,
            json={
                "tool": "browser.run",
                "payload": {
                    "url": "https://example.com",
                    "steps": [{"action": "evaluate", "text": "anything"}],
                },
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/tasks",
            headers=AUTH,
            json={
                "tool": "windows.run",
                "payload": {
                    "application_id": "unapproved",
                    "steps": [{"action": "click"}],
                },
            },
        ).status_code
        == 422
    )


def test_browser_policy_revocation_invalidates_approval(client, monkeypatch):
    client.put(
        "/automation/policy", headers=AUTH, json={"browser_hosts": ["example.com"]}
    )
    task = client.post(
        "/tasks",
        headers=AUTH,
        json={
            "tool": "browser.run",
            "payload": {"url": "https://example.com", "steps": [{"action": "read"}]},
        },
    ).json()
    client.put("/automation/policy", headers=AUTH, json={"browser_hosts": []})
    client.post("/tasks/" + task["id"] + "/approve", headers=AUTH)
    assert wait(client, task["id"])["status"] == "failed"


def test_windows_adapter_reports_platform_limit(tmp_path):
    if platform.system() != "Windows":
        with pytest.raises(ValueError, match="requires Windows"):
            automation.windows(
                lambda: store.open_db(tmp_path / "db.sqlite3"),
                tmp_path / "db.sqlite3",
                {},
                lambda: None,
            )
