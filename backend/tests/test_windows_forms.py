"""Deterministic UIA doubles plus a separately skipped real Windows fixture."""

import hashlib
import json
import os
import platform
import subprocess
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend import store, windows_forms as forms


EXE = r"C:\NightBrewFixture\fixture.exe"


class Control:
    def __init__(self, identifier="customer", value="original", *, name="Customer", password=False, readonly=False):
        self.element_info = SimpleNamespace(automation_id=identifier, name=name,
                                            element=SimpleNamespace(CurrentIsPassword=password))
        self.iface_value = SimpleNamespace(CurrentIsReadOnly=readonly)
        self.value = value
        self.writes = []

    def is_visible(self):
        return True

    def is_enabled(self):
        return True

    def get_value(self):
        return self.value

    def set_edit_text(self, value):
        self.writes.append(value)
        self.value = value


class Window:
    def __init__(self, fields):
        self.fields = fields

    def descendants(self, **kwargs):
        assert kwargs == {"control_type": "Edit", "depth": 12}
        return self.fields


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    connect = lambda: store.open_db(tmp_path / "forms.sqlite3")
    rules = {"applications": {"fixture": EXE}}
    with connect() as db:
        store.put(db, "automation_policy", rules)
    fields = [Control(), Control("notes", "existing", name="Notes")]
    identity = {"pid": 123, "created": "456", "executable": EXE, "window_title": "Fixture"}

    @contextmanager
    def session(executable, title):
        assert executable == EXE and title == "Fixture"
        yield Window(fields), dict(identity)

    monkeypatch.setattr(forms.platform, "system", lambda: "Windows")
    monkeypatch.setattr(forms, "window_session", session)
    return connect, rules, fields, identity


def inspect(workspace):
    connect, rules, _, _ = workspace
    payload = forms.prepare("windows.inspect", {"application_id": "fixture", "title": "Fixture"}, rules["applications"])
    return forms.run(connect, None, payload, lambda: None)


def fill(workspace, result, values=None):
    connect, rules, _, _ = workspace
    payload = forms.prepare("windows.fill", {
        "application_id": "fixture", "title": "Fixture", "form_snapshot": result["form_snapshot"],
        "values": values or [{"selector": field["selector"], "text": "Approved " + field["identifier"]} for field in result["fields"]],
    }, rules["applications"])
    return forms.run(connect, None, payload, lambda: None)


def test_supported_fields_are_hashed_and_exact_values_are_verified(workspace):
    result = inspect(workspace)
    assert len(result["fields"]) == 2
    assert result["fields"][0]["value_digest"] == hashlib.sha256(b"original").hexdigest()
    assert "original" not in json.dumps(result)
    completed = fill(workspace, result)
    assert [step["verified"] for step in completed["steps"]] == [True, True]
    assert [field.writes for field in workspace[2]] == [["Approved customer"], ["Approved notes"]]


@pytest.mark.parametrize("change", ["value", "identity", "policy", "added_field"])
def test_stale_inspection_never_writes(workspace, change):
    connect, rules, fields, identity = workspace
    result = inspect(workspace)
    if change == "value":
        fields[0].value = "newer customer data"
    elif change == "identity":
        identity["created"] = "457"
    elif change == "policy":
        with connect() as db:
            store.put(db, "automation_policy", {"applications": {"fixture": r"C:\Other\other.exe"}})
    else:
        fields.append(Control("new_field", name="New field"))
    with pytest.raises(ValueError, match="changed"):
        fill(workspace, result)
    assert not any(field.writes for field in fields)


def test_inspection_omits_password_readonly_unknown_and_ambiguous_fields():
    password = Control("safe_name", value="secret", password=True)
    readonly = Control("readonly", readonly=True)
    unknown = Control("unknown", password=None)
    mislabeled = Control("plainPassword", value="secret")
    duplicate_a, duplicate_b = Control("duplicate"), Control("duplicate")
    shipping = Control("shipping", name="Shipping address")
    fields = forms.controls(Window([password, readonly, unknown, mislabeled, duplicate_a, duplicate_b, shipping]), lambda: None)
    assert [entry[2].auto_id for entry in fields.values()] == ["shipping"]


def test_uninspected_or_duplicate_selectors_are_rejected(workspace):
    result = inspect(workspace)
    missing = json.dumps({"auto_id": "not-inspected", "name": "Other", "control_type": "Edit"})
    with pytest.raises(ValueError, match="absent"):
        fill(workspace, result, [{"selector": missing, "text": "no"}])
    selector = result["fields"][0]["selector"]
    with pytest.raises(ValueError, match="only once"):
        fill(workspace, result, [{"selector": selector, "text": "one"}, {"selector": selector, "text": "two"}])
    assert not any(field.writes for field in workspace[2])


def test_policy_is_rechecked_after_every_write(workspace):
    connect, rules, fields, _ = workspace
    result = inspect(workspace)
    original = fields[0].set_edit_text

    def revoke(value):
        original(value)
        with connect() as db:
            store.put(db, "automation_policy", {"applications": {}})

    fields[0].set_edit_text = revoke
    with pytest.raises(ValueError, match="policy changed"):
        fill(workspace, result)
    assert len(fields[0].writes) == 1 and fields[1].writes == []


@pytest.mark.parametrize("path", ["fixture.exe", r"\\server\share\app.exe", r"C:\app.bat", "C:\\app.exe\n"])
def test_paths_are_allowlisted_exact_local_executables(path):
    with pytest.raises(ValueError):
        forms.prepare("windows.inspect", {"application_id": "fixture", "title": "Fixture"}, {"fixture": path})


def test_real_platform_is_required(monkeypatch):
    monkeypatch.setattr(forms.platform, "system", lambda: "Darwin")
    with pytest.raises(ValueError, match="interactive Windows"):
        forms.run(None, None, {}, lambda: None)


@pytest.mark.skipif(platform.system() != "Windows", reason="Actual Windows UIA form fixture")
def test_native_windows_inspection_and_fill(tmp_path):
    source = tmp_path / "InspectedFixture.cs"
    executable = tmp_path / "NightBrewInspectedFixture.exe"
    source.write_text('''using System; using System.Windows.Forms;
class Fixture { [STAThread] static void Main() {
  var form=new Form(); form.Text="NightBrew inspected form fixture";
  var customer=new TextBox(); customer.Name="CustomerInput"; customer.AccessibleName="Customer"; customer.Text="Before"; customer.Top=10;
  var secret=new TextBox(); secret.Name="LoginSecret"; secret.Text="Never return this"; secret.UseSystemPasswordChar=true; secret.Top=50;
  var readOnly=new TextBox(); readOnly.Name="Reference"; readOnly.Text="Read only"; readOnly.ReadOnly=true; readOnly.Top=90;
  form.Controls.Add(customer); form.Controls.Add(secret); form.Controls.Add(readOnly); Application.Run(form);
} }''')
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    subprocess.run([str(compiler), "/nologo", "/target:winexe", "/reference:System.Windows.Forms.dll",
                    "/out:" + str(executable), str(source)], check=True, capture_output=True)
    connect = lambda: store.open_db(tmp_path / "native.sqlite3")
    applications = {"fixture": str(executable)}
    with connect() as db:
        store.put(db, "automation_policy", {"applications": applications})
    basic = {"application_id": "fixture", "title": "NightBrew inspected form fixture"}
    process = subprocess.Popen([str(executable)])
    try:
        result = forms.run(connect, None, forms.prepare("windows.inspect", basic, applications), lambda: None)
        assert len(result["fields"]) == 1
        assert result["fields"][0]["identifier"] == "CustomerInput"
        assert "Never return this" not in json.dumps(result)
        payload = forms.prepare("windows.fill", {**basic, "form_snapshot": result["form_snapshot"],
                                  "values": [{"selector": result["fields"][0]["selector"], "text": "Approved fixture value"}]}, applications)
        completed = forms.run(connect, None, payload, lambda: None)
        assert completed["steps"][0]["verified"] is True
        # The inspected snapshot is consumed logically by the changed values.
        with pytest.raises(ValueError, match="changed"):
            forms.run(connect, None, payload, lambda: None)
    finally:
        process.terminate()
        process.wait(timeout=10)
