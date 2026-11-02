"""Optional owned AppKit fixture; never weakens macOS TCC to make tests pass."""

import os
import platform
import plistlib
import subprocess
import time
import uuid

import pytest

from backend import macos_automation as mac, store


@pytest.mark.skipif(platform.system() != "Darwin", reason="Requires the native macOS JXA compiler")
def test_bundled_jxa_compiles_without_requesting_accessibility(tmp_path):
    subprocess.run(['/usr/bin/osacompile', '-l', 'JavaScript', '-o', str(tmp_path / 'bridge.scpt'),
                    str(mac.SCRIPT)], check=True, timeout=20, capture_output=True)


@pytest.mark.skipif(platform.system() != "Darwin" or os.getenv("NIGHTBREW_TEST_MACOS_ACCESSIBILITY") != "1",
                    reason="Requires interactive macOS with explicitly granted Accessibility/Automation permissions")
def test_real_owned_appkit_form_fill(tmp_path):
    bundle_id = "com.nightbrew.test.fixture." + uuid.uuid4().hex
    application = tmp_path / "NightBrewFormFixture.app"
    binary = application / "Contents/MacOS/Fixture"
    binary.parent.mkdir(parents=True)
    (application / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleExecutable": "Fixture", "CFBundleIdentifier": bundle_id,
        "CFBundleName": "NightBrew Form Fixture", "CFBundlePackageType": "APPL",
        "NSPrincipalClass": "NSApplication",
    }))
    source = tmp_path / "Fixture.swift"
    source.write_text('''import Cocoa
class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 400, height: 220), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "NightBrew owned Mac form"
        let input = NSTextField(frame: NSRect(x: 30, y: 130, width: 300, height: 25))
        input.stringValue = "Initial fixture value"
        input.setAccessibilityIdentifier("NightBrewInput")
        input.setAccessibilityLabel("Customer")
        let secure = NSSecureTextField(frame: NSRect(x: 30, y: 70, width: 300, height: 25))
        secure.stringValue = "never-return-this-value"
        secure.setAccessibilityIdentifier("NightBrewSecret")
        secure.setAccessibilityLabel("Password")
        window.contentView!.addSubview(input)
        window.contentView!.addSubview(secure)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
''')
    subprocess.run(["/usr/bin/swiftc", str(source), "-framework", "Cocoa", "-o", str(binary)], check=True, capture_output=True, timeout=60)
    process = subprocess.Popen([str(binary)])
    connect = lambda: store.open_db(tmp_path / "test.sqlite3")
    apps = {"fixture": bundle_id}
    with connect() as db:
        store.put(db, "automation_policy", {"mac_applications": apps})
    try:
        prepared = mac.prepare("macos.inspect", {"application_id": "fixture", "title": "NightBrew owned Mac form"}, apps)
        until = time.monotonic() + 15
        while True:
            try:
                inspected = mac.run(connect, tmp_path / "test.sqlite3", prepared, lambda: None)
                break
            except ValueError as exc:
                if "Open the approved" not in str(exc) or time.monotonic() >= until:
                    raise
                time.sleep(0.1)
        assert "never-return-this-value" not in str(inspected)
        assert all("Password" not in f["label"] for f in inspected["fields"])
        target = next(f for f in inspected["fields"] if f["identifier"] == "NightBrewInput")
        fill = mac.prepare("macos.fill", {"application_id": "fixture", "title": "NightBrew owned Mac form",
            "form_snapshot": inspected["form_snapshot"], "values": [{"selector": target["selector"], "text": "Verified native Mac value"}]}, apps)
        assert mac.run(connect, tmp_path / "test.sqlite3", fill, lambda: None)["steps"][0]["verified"] is True
        after = mac.run(connect, tmp_path / "test.sqlite3", prepared, lambda: None)
        assert after["form_snapshot"] != inspected["form_snapshot"]
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
