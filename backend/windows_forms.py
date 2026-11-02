"""Inspected Windows text fields, never coordinates, keys, menus or scripts.

The adapter operates only on the exact allowlisted executable/window. Existing
field values contribute local hashes to a stale-form check; inspection does not
return their plaintext. UIA support varies by application and control provider.
"""

import hashlib
import json
import os
import platform
import re
import time
from contextlib import contextmanager
from pathlib import Path, PureWindowsPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend import store

SENSITIVE = re.compile(
    r"password|passwd|secret|token|api[ _-]?key|credit.?card|card.?number|"
    r"(?:^|[^a-z])(?:pin|otp|cvv|cvc)(?:$|[^a-z])|密码|口令|密钥|验证码|安全码",
    re.IGNORECASE,
)
MAX_FIELDS = 40
MAX_ORIGINAL_TEXT = 4000


class Inspect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def exact_window(self):
        if not self.title.strip() or any(ord(c) < 32 for c in self.title):
            raise ValueError("Use the exact visible window title")
        return self


class Value(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selector: str = Field(min_length=1, max_length=1600)
    text: str = Field(max_length=2000)


class Fill(Inspect):
    form_snapshot: str = Field(pattern=r"^[a-f0-9]{64}$")
    values: list[Value] = Field(min_length=1, max_length=MAX_FIELDS)

    @model_validator(mode="after")
    def unique_fields(self):
        selectors = [canonical_selector(value.selector) for value in self.values]
        if len(set(selectors)) != len(selectors):
            raise ValueError("A Windows field may be filled only once per task")
        return self


class Selector(BaseModel):
    model_config = ConfigDict(extra="forbid")
    auto_id: str = Field(default="", max_length=200)
    name: str = Field(default="", max_length=200)
    control_type: Literal["Edit"] = "Edit"

    @model_validator(mode="after")
    def identified_text(self):
        if not (self.auto_id or self.name):
            raise ValueError("Windows field lacks a stable identity")
        if SENSITIVE.search(self.auto_id + " " + self.name):
            raise ValueError("Sensitive Windows fields cannot be filled")
        return self


def canonical_selector(value):
    try:
        selector = Selector.model_validate_json(value)
    except (ValueError, TypeError):
        raise ValueError("Use a supported field returned by Windows inspection") from None
    return json.dumps(selector.model_dump(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def approved_path(value):
    if (not isinstance(value, str) or not PureWindowsPath(value).is_absolute()
            or value.startswith("\\\\") or not value.lower().endswith(".exe")
            or any(ord(c) < 32 for c in value)):
        raise ValueError("Approved Windows application requires an exact local .exe path")
    return value


def prepare(tool, payload, applications):
    if tool not in {"windows.inspect", "windows.fill"}:
        raise ValueError("Unsupported Windows form operation")
    plan = (Fill if tool == "windows.fill" else Inspect).model_validate(payload)
    executable = applications.get(plan.application_id)
    if not executable:
        raise ValueError("Windows application is not approved")
    approved_path(executable)
    return {"windows_tool": tool, "plan": plan.model_dump(),
            "policy_snapshot": {"applications": dict(applications)}}


@contextmanager
def window_session(executable, title):
    """Initialize UIA on its owning worker, then bind exact window and process."""
    import psutil
    from pywinauto.application import Application, ProcessNotFoundError
    from pywinauto.timings import TimeoutError as UIATimeoutError
    from comtypes import CoInitializeEx, CoUninitialize

    if not Path(executable).is_file():
        raise ValueError("Approved Windows executable is unavailable")
    initialized = False
    try:
        # pywinauto chooses the COM apartment model. Each queue worker still
        # needs its own balanced initialization when imports are already cached.
        CoInitializeEx()
        initialized = True
        application = Application(backend="uia")
        try:
            application.connect(path=executable, timeout=5)
        except (ProcessNotFoundError, UIATimeoutError):
            raise ValueError("Open the approved Windows application and exact window before inspecting") from None
        specification = application.window(title=title)
        specification.wait("visible enabled", timeout=10)
        window = specification.wrapper_object()
        if window.window_text() != title:
            raise ValueError("Windows title does not match the approved target")
        process = psutil.Process(window.process_id())
        expected = os.path.normcase(str(Path(executable).resolve()))
        observed = os.path.normcase(str(Path(process.exe()).resolve()))
        if expected != observed:
            raise ValueError("Windows process does not match the approved executable")
        identity = {"pid": process.pid, "created": str(process.create_time()),
                    "executable": observed, "window_title": title}
        yield window, identity
    finally:
        if initialized:
            CoUninitialize()


def controls(window, checkpoint):
    """Only unambiguous enabled writable non-password UIA Value-pattern edits."""
    available, duplicates = {}, set()
    candidates = window.descendants(control_type="Edit", depth=12)
    if len(candidates) > 200:
        raise ValueError("Window has too many text controls; select a narrower window")
    for control in candidates:
        checkpoint()
        try:
            if not control.is_visible() or not control.is_enabled():
                continue
            raw_password = control.element_info.element.CurrentIsPassword
            raw_readonly = control.iface_value.CurrentIsReadOnly
            if type(raw_password) not in (bool, int) or raw_password not in (False, 0):
                continue
            if type(raw_readonly) not in (bool, int) or raw_readonly not in (False, 0):
                continue
            descriptor = Selector(auto_id=control.element_info.automation_id or "",
                                  name=control.element_info.name or "",
                                  control_type="Edit")
            value = control.get_value()
            if not isinstance(value, str) or len(value) > MAX_ORIGINAL_TEXT:
                continue
            selector = canonical_selector(descriptor.model_dump_json())
        except Exception:
            # A provider that cannot prove password/read-only/value properties
            # is unsupported; do not read or write it using a weaker fallback.
            continue
        if selector in available:
            duplicates.add(selector)
        else:
            available[selector] = (control, value, descriptor)
    for selector in duplicates:
        available.pop(selector, None)
    if len(available) > MAX_FIELDS:
        raise ValueError("Window has too many supported fields; select a narrower window")
    return available


def public_fields(available):
    return sorted([
        {"selector": selector, "identifier": descriptor.auto_id,
         "label": descriptor.name or descriptor.auto_id, "role": "Edit", "editable": True,
         "value_digest": hashlib.sha256(value.encode("utf-8")).hexdigest()}
        for selector, (_, value, descriptor) in available.items()
    ], key=lambda field: field["selector"])


def fingerprint(identity, fields):
    return hashlib.sha256(json.dumps({"identity": identity, "fields": fields}, sort_keys=True,
                                    separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def ensure_policy(connect, payload, application_id):
    with connect() as db:
        current = store.get(db, "automation_policy", {}).get("applications", {})
    approved = payload["policy_snapshot"].get("applications", {})
    if current != approved or application_id not in current:
        raise ValueError("Windows application policy changed; request new approval")
    return approved_path(current[application_id])


def run(connect, db_path, payload, checkpoint):
    del db_path
    if platform.system() != "Windows":
        raise ValueError("Windows form inspection requires an interactive Windows session")
    tool = payload.get("windows_tool")
    if tool not in {"windows.inspect", "windows.fill"}:
        raise ValueError("Unsupported Windows form operation")
    plan = (Fill if tool == "windows.fill" else Inspect).model_validate(payload["plan"])
    executable = ensure_policy(connect, payload, plan.application_id)
    checkpoint()
    try:
        with window_session(executable, plan.title) as (window, identity):
            available = controls(window, checkpoint)
            fields = public_fields(available)
            snapshot = fingerprint(identity, fields)
            if tool == "windows.inspect":
                return {"fields": fields, "form_snapshot": snapshot,
                        "application_id": plan.application_id, "title": plan.title,
                        "untrusted_content": True,
                        "note": "Only supported non-password writable text fields are listed. Original text is hashed locally, not returned."}
            if snapshot != plan.form_snapshot:
                raise ValueError("Windows form changed; inspect it and request a new approval")
            selected = [(value, canonical_selector(value.selector)) for value in plan.values]
            if any(selector not in available for _, selector in selected):
                raise ValueError("Approved Windows field is absent or ambiguous")
            results = []
            for value, selector in selected:
                checkpoint()
                ensure_policy(connect, payload, plan.application_id)
                # Recheck every remaining original before each write. Earlier
                # writes in this same task are incorporated into the snapshot.
                current_controls = controls(window, checkpoint)
                if fingerprint(identity, public_fields(current_controls)) != fingerprint(identity, public_fields(available)):
                    raise ValueError("Windows form changed during filling; inspect before retrying")
                control, old, descriptor = current_controls[selector]
                control.set_edit_text(value.text)
                deadline = time.monotonic() + 5
                while control.get_value() != value.text:
                    checkpoint()
                    if time.monotonic() >= deadline:
                        raise ValueError("Windows field value could not be verified")
                    time.sleep(0.05)
                available[selector] = (control, value.text, descriptor)
                results.append({"action": "fill", "selector": selector, "verified": True,
                                "result": "filled"})
            checkpoint()
            return {"steps": results, "untrusted_content": True,
                    "note": "Approved text values were set and verified. No send buttons, menus or keyboard shortcuts were invoked. Application autosave remains application-controlled."}
    except ValueError:
        raise
    except Exception:
        raise ValueError("Windows UI Automation failed; check the exact window and inspect before retrying. Existing writes may already have occurred.") from None


def capabilities():
    available = platform.system() == "Windows"
    return {"available": available,
            "reason": "Requires an interactive Windows desktop and a tested UIA application" if available
            else "Windows form inspection requires Windows"}
