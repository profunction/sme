"""Bounded, approved macOS Accessibility form inspection and filling.

Only a static bundled JXA program is executed. User strings are JSON on stdin,
never shell commands or generated AppleScript/JavaScript. UI reads return field
metadata, not existing field values. macOS permissions must be granted by the
user; this module never edits TCC or disables operating-system controls.
"""

import hashlib
import json
import platform
import re
import subprocess
import time
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend import store

SCRIPT = Path(__file__).with_name("macos_accessibility.jxa.js")
ROLES = {"AXTextField", "AXTextArea"}
BUNDLE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+\Z")
SENSITIVE = re.compile(r"password|passwd|secret|api.?key|token|otp|\bpin\b|密码|口令|密钥|验证码", re.I)


def validate_bundle_id(value):
    if not isinstance(value, str) or len(value) > 200 or not BUNDLE_ID.fullmatch(value):
        raise ValueError("Mac applications require an exact bundle identifier, for example com.apple.TextEdit")
    # System scripting, terminals and credential managers are not form targets.
    if value.lower() in {"com.apple.systemevents", "com.apple.terminal", "com.apple.scripteditor2", "com.apple.keychainaccess",
                         "com.googlecode.iterm2", "dev.warp.warp-stable", "net.kovidgoyal.kitty",
                         "org.alacritty", "com.mitchellh.ghostty"}:
        raise ValueError("This system application cannot be an autofill target")
    return value


class Inspect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def exact_title(cls, value):
        if not value.strip() or any(ord(c) < 32 for c in value):
            raise ValueError("Specify the exact nonempty Mac window title")
        return value


class Value(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selector: str = Field(min_length=1, max_length=1200)
    text: str = Field(max_length=4000)

    @field_validator("selector")
    @classmethod
    def safe_selector(cls, value):
        descriptor(value)
        return value


class Fill(Inspect):
    form_snapshot: str = Field(pattern=r"^[a-f0-9]{64}$")
    values: list[Value] = Field(min_length=1, max_length=20)

    @field_validator("values")
    @classmethod
    def unique_fields(cls, values):
        selectors = [json.dumps(descriptor(v.selector), sort_keys=True) for v in values]
        if len(selectors) != len(set(selectors)):
            raise ValueError("A Mac field may only be filled once per approved task")
        return values


def descriptor(value):
    try:
        result = json.loads(value)
        if not isinstance(result, dict) or set(result) != {"role", "identifier", "label"}:
            raise ValueError()
        if result["role"] not in ROLES:
            raise ValueError()
        if any(not isinstance(result[key], str) or len(result[key]) > 200 for key in ("identifier", "label")):
            raise ValueError()
        if not (result["identifier"] or result["label"]):
            raise ValueError()
        if SENSITIVE.search(result["identifier"] + " " + result["label"]):
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise ValueError("Use an identified, non-sensitive text field returned by Mac inspection") from None


def prepare(tool, payload, mac_applications):
    if tool not in {"macos.inspect", "macos.fill"}:
        raise ValueError("Unsupported Mac form operation")
    plan = (Fill if tool == "macos.fill" else Inspect).model_validate(payload)
    bundle_id = mac_applications.get(plan.application_id)
    if not bundle_id:
        raise ValueError("Mac application is not on the approved bundle-ID list")
    validate_bundle_id(bundle_id)
    return {"mac_tool": tool, "plan": plan.model_dump(),
            "policy_snapshot": {"mac_applications": dict(mac_applications)}}


def invoke(request, checkpoint):
    if platform.system() != "Darwin":
        raise ValueError("Mac Accessibility automation requires macOS")
    if not SCRIPT.is_file():
        raise ValueError("Bundled Mac Accessibility adapter is missing")
    process = subprocess.Popen(
        ["/usr/bin/osascript", "-l", "JavaScript", str(SCRIPT)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8",
    )
    deadline = time.monotonic() + 15
    data = json.dumps(request, ensure_ascii=False)
    try:
        while True:
            checkpoint()
            if time.monotonic() > deadline:
                raise ValueError("Mac form operation timed out; inspect the application before retrying")
            try:
                output, _ = process.communicate(input=data, timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                data = None
        if process.returncode != 0 or len(output.encode("utf-8")) > 262144:
            raise ValueError("Mac accessibility operation failed; check Accessibility/Automation permissions and the exact application window")
        try:
            result = json.loads(output)
            if not isinstance(result, dict):
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError("Mac accessibility adapter returned an invalid result") from None
        if result.get("error"):
            messages = {
                "permissions": "Allow NightBrew in macOS Privacy & Security → Accessibility and Automation, then try again",
                "application": "Open the approved Mac application first; its bundle ID must match exactly",
                "window": "The exact Mac window was not found or is ambiguous; inspect it again",
                "unsupported": "This window does not expose supported identifiable text fields through macOS Accessibility",
                "changed": "The Mac form changed; inspect it and request a new approval",
                "target": "The approved Mac field is absent, ambiguous, secure or not editable",
                "verification": "Mac field verification failed; check the window before creating another task",
            }
            raise ValueError(messages.get(result["error"], "Mac form operation failed; inspect the application before retrying"))
        return result
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)


def normalize_fields(result):
    fields = result.get("fields")
    if not isinstance(fields, list) or len(fields) > 60:
        raise ValueError("Mac accessibility adapter returned invalid form metadata")
    normalized = []
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("selector"), str):
            raise ValueError("Mac accessibility adapter returned invalid form metadata")
        target = descriptor(field["selector"])
        if any(field.get(key) != target[key] for key in ("role", "identifier", "label")):
            raise ValueError("Mac accessibility metadata does not match its field identity")
        original = field.get("original_value")
        if not isinstance(original, str) or len(original) > 4000:
            raise ValueError("Mac form value exceeds supported snapshot bounds")
        normalized.append({**target, "selector": field["selector"], "editable": field.get("editable") is True,
                           "value_digest": hashlib.sha256(original.encode("utf-8")).hexdigest()})
    if len({field["selector"] for field in normalized}) != len(normalized):
        raise ValueError("Mac form contains ambiguous field identities")
    return normalized


def fingerprint(bundle_id, title, fields):
    return hashlib.sha256(json.dumps({"bundle_id": bundle_id, "title": title, "fields": fields},
                                     sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def run(connect, db_path, payload, checkpoint):
    del db_path  # Mac operations never accept file-system destinations.
    tool = payload.get("mac_tool")
    if tool not in {"macos.inspect", "macos.fill"}:
        raise ValueError("Unsupported Mac form operation")
    plan = (Fill if tool == "macos.fill" else Inspect).model_validate(payload["plan"])
    with connect() as db:
        current = store.get(db, "automation_policy", {}).get("mac_applications", {})
    approved = payload["policy_snapshot"].get("mac_applications", {})
    if current != approved or plan.application_id not in current:
        raise ValueError("Mac application policy changed; request a new approval")
    bundle_id = validate_bundle_id(current[plan.application_id])
    checkpoint()
    request = {"operation": "inspect", "bundle_id": bundle_id, "title": plan.title}
    original = invoke(request, checkpoint)
    fields = normalize_fields(original)
    native_fields = original["fields"]
    snapshot = fingerprint(bundle_id, plan.title, fields)
    if tool == "macos.inspect":
        return {"fields": fields, "form_snapshot": snapshot, "application_id": plan.application_id,
                "title": plan.title, "untrusted_content": True,
                "note": "Existing field values are hashed locally for stale-form checks; their text and sensitive fields are not returned or stored."}
    if snapshot != plan.form_snapshot:
        raise ValueError("Mac form changed; inspect it and request a new approval")
    known = {json.dumps(descriptor(f["selector"]), sort_keys=True): f for f in fields}
    results = []
    for value in plan.values:
        checkpoint()
        target = descriptor(value.selector)
        field = known.get(json.dumps(target, sort_keys=True))
        if not field or not field["editable"]:
            raise ValueError("Approved Mac field is absent or not editable")
        response = invoke({**request, "operation": "fill", "target": target,
                           "text": value.text, "expected_fields": native_fields}, checkpoint)
        if response.get("verified") is not True:
            raise ValueError("Mac field verification failed; check the window before retrying")
        results.append({"action": "fill", "selector": value.selector, "verified": True, "result": "filled"})
        for native_field in native_fields:
            if descriptor(native_field["selector"]) == target:
                native_field["original_value"] = value.text
    checkpoint()
    return {"steps": results, "untrusted_content": True,
            "note": "Only approved Accessibility text values were set; no buttons, menus or keyboard shortcuts were invoked. Application autosave behavior is outside NightBrew's control."}


def capabilities():
    available = platform.system() == "Darwin" and Path("/usr/bin/osascript").is_file() and SCRIPT.is_file()
    return {"available": available, "permission_required": available,
            "reason": "Grant Accessibility and Automation permissions in macOS settings before inspecting an approved app" if available
            else "Mac Accessibility automation requires macOS"}
