"""Runs only on Windows CI. Linux skips are not counted as Windows verification."""

import os
import platform
import subprocess
from pathlib import Path

import pytest

from backend import automation, store

pytestmark = pytest.mark.skipif(
    platform.system() != "Windows", reason="Interactive Windows UI Automation test"
)


def test_real_windows_uia_fixture(tmp_path):
    source = tmp_path / "Fixture.cs"
    executable = tmp_path / "NightBrewFixture.exe"
    source.write_text("""using System; using System.Windows.Forms;
    class Fixture { [STAThread] static void Main() { var form=new Form(); form.Text="NightBrew automation test"; var input=new TextBox(); input.Name="NightBrewInput"; input.Top=20; input.Width=250; form.Controls.Add(input); Application.Run(form); } }""")
    compiler = (
        Path(os.environ["WINDIR"])
        / "Microsoft.NET"
        / "Framework64"
        / "v4.0.30319"
        / "csc.exe"
    )
    subprocess.run(
        [
            str(compiler),
            "/nologo",
            "/target:winexe",
            "/reference:System.Windows.Forms.dll",
            "/out:" + str(executable),
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    connect = lambda: store.open_db(tmp_path / "db.sqlite3")
    rules = automation.AutomationPolicy(applications={"fixture": str(executable)})
    with connect() as db:
        store.put(db, "automation_policy", rules.model_dump())
    payload = automation.prepare(
        connect,
        "windows.run",
        {
            "application_id": "fixture",
            "title": "NightBrew automation test",
            "steps": [
                {
                    "action": "fill",
                    "control_type": "Edit",
                    "text": "Verified on Windows",
                    "expected_text": "Verified on Windows",
                },
                {"action": "screenshot"},
            ],
        },
    )
    try:
        result = automation.windows(
            connect, tmp_path / "db.sqlite3", payload, lambda: None
        )
        assert result["steps"][0]["verified"] is True
        assert result["artifacts"]
    finally:
        from pywinauto.application import Application

        try:
            Application(backend="uia").connect(path=str(executable)).kill()
        except Exception:  # noqa: BLE001 -- Best-effort cleanup of the isolated test process.
            import logging

            logging.getLogger(__name__).info(
                "Test fixture was already stopped or unavailable"
            )


def test_windows_credential_manager_roundtrip():
    import uuid

    from backend.credentials import windows_vault

    vault = windows_vault()
    service = "NightBrew-test-" + uuid.uuid4().hex
    try:
        vault.set_password(service, "integration", "ephemeral-test-not-real")
        assert vault.get_password(service, "integration") == "ephemeral-test-not-real"
    finally:
        vault.delete_password(service, "integration")
