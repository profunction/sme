"""Actual browser fixtures: bounded inspected fields, changed data and write consent."""

import copy
import hashlib
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from backend import automation, files, store
from backend.tests.test_app import AUTH
from backend.tests.test_documents import wait


@pytest.fixture
def form_site():
    state = {"initial": "", "posts": []}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = f'''<!doctype html><html><body>
                <label for="name">Customer name</label><input id="name" value="{state['initial']}" oninput="fetch('/save',{{method:'POST',body:this.value}})">
                <label>Email<input name="email" type="email"></label>
                <label for="notes">Notes</label><textarea id="notes"></textarea>
                <label for="language">Language</label><select id="language"><option value="en">English</option><option value="ms">Malay</option></select>
                <input id="password" type="password" value="secret">
                <input id="api_token" value="secret">
                <input id="hidden" type="hidden" value="secret">
                <input id="card" autocomplete="cc-number" value="secret">
                <input id="locked" readonly value="locked">
                <input id="disabled" disabled>
                <button id="send" onclick="fetch('/save',{{method:'POST',body:'sent'}})">Send</button>
                </body></html>'''.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            state["posts"].append(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode())
            self.send_response(204)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.fixture
def forms(tmp_path, monkeypatch):
    executable = os.getenv("NIGHTBREW_TEST_BROWSER", "/usr/bin/chromium")
    if not Path(executable).is_file():
        pytest.skip("Actual fixture browser not installed on this OS")
    monkeypatch.setenv("NIGHTBREW_ENV", "test")
    monkeypatch.setenv("NIGHTBREW_BROWSER_EXECUTABLE", executable)
    path = tmp_path / "forms.sqlite3"
    connect = lambda: store.open_db(path)
    with connect() as connection:
        store.put(connection, "automation_policy", {"browser_hosts": ["127.0.0.1"], "browser_writes": True})

    def run(tool, payload):
        prepared = automation.prepare(connect, tool, payload)
        return automation.browser_forms(connect, path, prepared, lambda: None, tool)

    return connect, path, run


def test_inspect_then_fill_verifies_values_without_submitting(forms, form_site):
    connect, path, run = forms
    url, state = form_site
    inspection = run("browser.inspect", {"url": url})
    fields = inspection["fields"]
    assert len(fields) == 4
    assert {field["label"] for field in fields} == {"Customer name", "Email", "Notes", "Language"}
    assert all("value" not in field and "secret" not in str(field) for field in fields)
    assert fields[0]["value_hash"] == hashlib.sha256(b"").hexdigest()
    email = next(field["selector"] for field in fields if field["type"] == "email")
    result = run("browser.fill", {"url": url, "form_snapshot": inspection["form_snapshot"], "values": [
        {"selector": "#name", "text": "NightBrew"}, {"selector": email, "text": "test@example.com"},
        {"selector": "#notes", "text": "Reviewed notes"}, {"selector": "#language", "text": "ms"},
    ]})
    assert len(result["steps"]) == 4 and all(step["verified"] for step in result["steps"])
    assert result["network_writes_allowed"] is False
    assert result["managed_browser_closed_after_task"] is True
    assert state["posts"] == []  # oninput autosave is blocked even though global policy allows writes
    screenshot, _ = files.locate(connect, path, result["artifacts"][0]["id"])
    assert screenshot.read_bytes().startswith(b"\x89PNG")


def test_changed_existing_data_stops_before_overwrite(forms, form_site):
    _, _, run = forms
    url, state = form_site
    inspection = run("browser.inspect", {"url": url})
    state["initial"] = "newer customer data"
    with pytest.raises(ValueError, match="changed"):
        run("browser.fill", {"url": url, "form_snapshot": inspection["form_snapshot"],
                             "values": [{"selector": "#name", "text": "must not overwrite"}]})
    assert state["posts"] == []


def test_network_writes_need_global_and_task_permission(forms, form_site):
    connect, _, run = forms
    url, state = form_site
    inspection = run("browser.inspect", {"url": url})
    values = {"url": url, "form_snapshot": inspection["form_snapshot"],
              "values": [{"selector": "#name", "text": "explicitly allowed autosave"}],
              "allow_network_writes": True}
    with connect() as connection:
        store.put(connection, "automation_policy", {"browser_hosts": ["127.0.0.1"]})
    with pytest.raises(ValueError, match="both administrator"):
        automation.prepare(connect, "browser.fill", values)
    assert state["posts"] == []
    with connect() as connection:
        store.put(connection, "automation_policy", {"browser_hosts": ["127.0.0.1"], "browser_writes": True})
    result = run("browser.fill", values)
    assert result["network_writes_allowed"] is True
    assert state["posts"] == ["explicitly allowed autosave"]
    assert "sent" not in state["posts"]


def test_unknown_field_and_modified_snapshot_cannot_bypass_inspection(forms, form_site):
    connect, _, run = forms
    url, _ = form_site
    inspection = run("browser.inspect", {"url": url})
    body = {"url": url, "form_snapshot": inspection["form_snapshot"],
            "values": [{"selector": "#password", "text": "do not fill"}]}
    with pytest.raises(ValueError, match="inspected fields"):
        automation.prepare(connect, "browser.fill", body)
    body["values"] = [{"selector": "#name", "text": "valid"}]
    changed = copy.deepcopy(body)
    changed["form_snapshot"]["fields"][0]["selector"] = "#password"
    with pytest.raises(ValueError, match="snapshot"):
        automation.prepare(connect, "browser.fill", changed)


def test_invalid_email_and_uninspected_select_value_fail(forms, form_site):
    _, _, run = forms
    url, _ = form_site
    inspection = run("browser.inspect", {"url": url})
    email = next(field["selector"] for field in inspection["fields"] if field["type"] == "email")
    for selector, text, error in [(email, "invalid-email", "validation"), ("#language", "unseen", "inspected option")]:
        with pytest.raises(ValueError, match=error):
            run("browser.fill", {"url": url, "form_snapshot": inspection["form_snapshot"],
                                 "values": [{"selector": selector, "text": text}]})


@pytest.mark.parametrize("payload", [{"visible": False, "hold_seconds": 1},
                                     {"visible": True, "hold_seconds": 121},
                                     {"visible": True, "hold_seconds": True}])
def test_managed_hold_is_visible_and_bounded(payload):
    with pytest.raises(ValueError):
        automation.BrowserInspect(url="https://example.com", **payload)


def test_browser_capabilities_match_configured_launch(monkeypatch, tmp_path):
    executable = tmp_path / "owned-browser-fixture"
    executable.touch()
    monkeypatch.setenv("NIGHTBREW_BROWSER_EXECUTABLE", str(executable))
    assert automation.browser_capabilities()["available"] is True
    options = automation.browser_launch_options(automation.AutomationPolicy(), tmp_path / "database", visible=True)
    assert options["executable_path"] == str(executable) and options["headless"] is False
    executable.unlink()
    assert automation.browser_capabilities()["available"] is False


@pytest.mark.parametrize("host", ["localhost.", "127.0.0.1.", "127.1", "2130706433", "service.home.arpa", "127%2e0%2e0%2e1"])
def test_browser_allowlist_does_not_override_private_address_protection(monkeypatch, host):
    monkeypatch.delenv("NIGHTBREW_ENV", raising=False)
    rules = automation.AutomationPolicy(browser_hosts=[host])
    with pytest.raises(ValueError):
        automation.destination("https://" + host + "/", rules)


def test_inspection_and_fill_both_require_exact_task_approval(client, form_site, monkeypatch):
    executable = os.getenv("NIGHTBREW_TEST_BROWSER", "/usr/bin/chromium")
    if not Path(executable).is_file():
        pytest.skip("Actual fixture browser not installed on this OS")
    monkeypatch.setenv("NIGHTBREW_ENV", "test")
    monkeypatch.setenv("NIGHTBREW_BROWSER_EXECUTABLE", executable)
    url, state = form_site
    client.put("/automation/policy", headers=AUTH, json={"browser_hosts": ["127.0.0.1"]})
    inspection = client.post("/tasks", headers=AUTH, json={"tool": "browser.inspect", "payload": {"url": url}})
    assert inspection.status_code == 201, inspection.text
    assert inspection.json()["status"] == "pending_approval"
    identifier = inspection.json()["id"]
    untouched = next(item for item in client.get("/tasks", headers=AUTH).json() if item["id"] == identifier)
    assert untouched["result"] is None
    client.post(f"/tasks/{identifier}/approve", headers=AUTH)
    inspected = wait(client, identifier)
    assert inspected["status"] == "completed", inspected
    snapshot = inspected["result"]["form_snapshot"]
    filling = client.post("/tasks", headers=AUTH, json={"tool": "browser.fill", "payload": {
        "url": snapshot["url"], "form_snapshot": snapshot, "values": [{"selector": "#name", "text": "Approved exact value"}],
    }})
    assert filling.status_code == 201, filling.text
    assert filling.json()["status"] == "pending_approval"
    assert state["posts"] == []
    identifier = filling.json()["id"]
    client.post(f"/tasks/{identifier}/approve", headers=AUTH)
    filled = wait(client, identifier)
    assert filled["status"] == "completed", filled
    assert filled["result"]["steps"][0]["verified"] is True
    assert state["posts"] == []
