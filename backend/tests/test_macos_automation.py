"""Mac adapter contracts with non-billable, non-native subprocess fixtures."""

import json
from pathlib import Path

import pytest

from backend import macos_automation as mac, store


def field(identifier="customer", label="Customer", original="Initial"):
    target = {"role": "AXTextField", "identifier": identifier, "label": label}
    return {**target, "selector": json.dumps(target), "editable": True, "original_value": original}


@pytest.fixture
def configured(tmp_path):
    connect = lambda: store.open_db(tmp_path / "mac.sqlite3")
    apps = {"fixture": "com.nightbrew.fixture"}
    with connect() as db:
        store.put(db, "automation_policy", {"mac_applications": apps})
    return connect, apps, tmp_path / "mac.sqlite3"


def inspect_payload(apps):
    return mac.prepare("macos.inspect", {"application_id": "fixture", "title": "Fixture"}, apps)


def inspection(monkeypatch, configured, fields=None):
    connect, apps, path = configured
    fields = fields if fields is not None else [field()]
    monkeypatch.setattr(mac, "invoke", lambda request, checkpoint: {"fields": fields})
    return mac.run(connect, path, inspect_payload(apps), lambda: None)


def test_inspection_hashes_existing_values_without_returning_them(configured, monkeypatch):
    result = inspection(monkeypatch, configured)
    assert "Initial" not in json.dumps(result)
    assert len(result["form_snapshot"]) == 64
    assert result["fields"][0]["label"] == "Customer"
    changed = inspection(monkeypatch, configured, [field(original="Changed")])
    assert result["form_snapshot"] != changed["form_snapshot"]


def test_fill_revalidates_original_values_and_exact_targets(configured, monkeypatch):
    connect, apps, path = configured
    fields = [field(), field("reference", "Reference", "Ref0")]
    result = inspection(monkeypatch, configured, fields)
    requested = []
    state = json.loads(json.dumps(fields))

    def invoke(request, checkpoint):
        requested.append(request)
        if request["operation"] == "inspect":
            return {"fields": json.loads(json.dumps(state))}
        assert request["expected_fields"] == state
        for entry in state:
            if mac.descriptor(entry["selector"]) == request["target"]:
                entry["original_value"] = request["text"]
        return {"verified": True}

    monkeypatch.setattr(mac, "invoke", invoke)
    plan = mac.prepare("macos.fill", {
        "application_id": "fixture", "title": "Fixture", "form_snapshot": result["form_snapshot"],
        "values": [{"selector": fields[0]["selector"], "text": "Customer name"},
                   {"selector": fields[1]["selector"], "text": "Ref1"}],
    }, apps)
    output = mac.run(connect, path, plan, lambda: None)
    assert len(output["steps"]) == 2
    assert all(step["verified"] for step in output["steps"])
    assert [req["operation"] for req in requested] == ["inspect", "fill", "fill"]
    assert "Customer name" not in json.dumps(output)


def test_stale_value_and_policy_changes_prevent_filling(configured, monkeypatch):
    connect, apps, path = configured
    before = inspection(monkeypatch, configured)
    plan = mac.prepare("macos.fill", {"application_id": "fixture", "title": "Fixture",
        "form_snapshot": before["form_snapshot"], "values": [{"selector": field()["selector"], "text": "After"}]}, apps)
    monkeypatch.setattr(mac, "invoke", lambda request, checkpoint: {"fields": [field(original="new outside edit")]})
    with pytest.raises(ValueError, match="changed"):
        mac.run(connect, path, plan, lambda: None)
    with connect() as db:
        store.put(db, "automation_policy", {"mac_applications": {}})
    monkeypatch.setattr(mac, "invoke", lambda *args: pytest.fail("revoked policy must not inspect"))
    with pytest.raises(ValueError, match="policy changed"):
        mac.run(connect, path, plan, lambda: None)


@pytest.mark.parametrize("selector", [
    '{"role":"AXButton","identifier":"send","label":"Send"}',
    '{"role":"AXTextField","identifier":"password","label":"Password"}',
    '{"role":"AXTextField","identifier":"","label":""}',
    '{"role":"AXTextField","identifier":"x","label":"x","code":"evil"}',
    '[]', 'null', 'not-json',
])
def test_unsafe_selectors_are_rejected(selector):
    with pytest.raises(ValueError):
        mac.descriptor(selector)


@pytest.mark.parametrize("bundle", ["", "com.apple.Terminal", "com.apple.terminal", "com.googlecode.iterm2",
                                   "com.apple.systemevents", "../App", "com.example.App;evil", "single"])
def test_bundle_identifiers_are_not_paths_or_scripts(bundle):
    with pytest.raises(ValueError):
        mac.validate_bundle_id(bundle)


def test_static_program_receives_only_json_stdin_and_has_bounded_execution(monkeypatch):
    monkeypatch.setattr(mac.platform, "system", lambda: "Darwin")
    arguments, inputs = [], []

    class Process:
        returncode = 0
        def __init__(self, args, **kwargs):
            arguments.extend(args)
            assert "shell" not in kwargs
        def communicate(self, input=None, timeout=None):
            inputs.append(json.loads(input))
            assert timeout == 0.1
            return '{"verified":true}', ""
        def poll(self): return 0

    monkeypatch.setattr(mac.subprocess, "Popen", Process)
    text = '"; do shell script "unsafe"; $(`unsafe`)'
    assert mac.invoke({"operation": "fill", "text": text}, lambda: None) == {"verified": True}
    assert arguments == ["/usr/bin/osascript", "-l", "JavaScript", str(mac.SCRIPT)]
    assert text not in " ".join(arguments)
    assert inputs[0]["text"] == text


def test_cancellation_stops_owned_subprocess(monkeypatch):
    monkeypatch.setattr(mac.platform, "system", lambda: "Darwin")
    stopped = []

    class Process:
        returncode = None
        def __init__(self, *args, **kwargs): pass
        def poll(self): return None
        def terminate(self): stopped.append("terminate")
        def wait(self, timeout): stopped.append("wait")

    monkeypatch.setattr(mac.subprocess, "Popen", Process)
    def cancelled(): raise RuntimeError("cancelled")
    with pytest.raises(RuntimeError, match="cancelled"):
        mac.invoke({"operation": "inspect"}, cancelled)
    assert stopped == ["terminate", "wait"]


def test_foreign_platform_does_not_spawn_or_claim_native_verification(monkeypatch):
    monkeypatch.setattr(mac.platform, "system", lambda: "Linux")
    monkeypatch.setattr(mac.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("must not spawn"))
    with pytest.raises(ValueError, match="requires macOS"):
        mac.invoke({}, lambda: None)
    assert mac.capabilities()["available"] is False


def test_readonly_duplicate_and_missing_fields_fail_closed(configured, monkeypatch):
    connect, apps, path = configured
    item = field()
    item["editable"] = False
    result = inspection(monkeypatch, configured, [item])
    plan = mac.prepare("macos.fill", {"application_id": "fixture", "title": "Fixture",
        "form_snapshot": result["form_snapshot"], "values": [{"selector": item["selector"], "text": "After"}]}, apps)
    with pytest.raises(ValueError, match="not editable"):
        mac.run(connect, path, plan, lambda: None)
    with pytest.raises(ValueError, match="only be filled once"):
        mac.Fill.model_validate({"application_id": "fixture", "title": "Fixture", "form_snapshot": "a" * 64,
            "values": [{"selector": item["selector"], "text": "one"}, {"selector": item["selector"], "text": "two"}]})


def test_missing_permissions_gives_actionable_message(monkeypatch):
    monkeypatch.setattr(mac.platform, "system", lambda: "Darwin")
    class Process:
        returncode = 0
        def __init__(self, *args, **kwargs): pass
        def communicate(self, **kwargs): return '{"error":"permissions"}', "sensitive diagnostics ignored"
        def poll(self): return 0
    monkeypatch.setattr(mac.subprocess, "Popen", Process)
    with pytest.raises(ValueError, match="Accessibility and Automation"):
        mac.invoke({}, lambda: None)


def test_bundled_script_contains_no_code_evaluation_or_keystroke_fallback():
    script = mac.SCRIPT.read_text(encoding="utf-8")
    for forbidden in ["eval(", "new Function", "doShellScript", "keystroke(", "keyCode(", ".click("]:
        assert forbidden not in script
    assert "AXSecureTextField" in script
    assert "expected_fields" in script
