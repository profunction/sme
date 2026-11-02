"""Approved deterministic plans; no AI-generated Python, JavaScript or shell commands."""

import io
import ipaddress
import hashlib
import json
import os
import platform
import shutil
import time
from pathlib import Path, PureWindowsPath
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend import files, store


class AutomationPolicy(BaseModel):
    browser_hosts: list[str] = Field(default_factory=list, max_length=30)
    browser_writes: bool = False
    browser_engine: Literal["auto", "edge", "chrome", "chromium"] = "auto"
    # App IDs map to exact executable paths. Only the local administrator edits this policy.
    applications: dict[str, str] = Field(default_factory=dict, max_length=30)
    mac_applications: dict[str, str] = Field(default_factory=dict, max_length=30)

    @model_validator(mode="after")
    def validate_policy(self):
        if self.mac_applications:
            from backend.macos_automation import validate_bundle_id
            for alias, bundle_id in self.mac_applications.items():
                if not alias.isidentifier() or len(alias) > 80:
                    raise ValueError("Mac application aliases must be simple identifiers")
                validate_bundle_id(bundle_id)
        for host in self.browser_hosts:
            if (
                not host
                or "/" in host
                or ":" in host
                or "*" in host
                or host != host.lower()
            ):
                raise ValueError("Browser hosts must be exact lower-case hostnames")
        for identifier, executable in self.applications.items():
            if (
                not identifier.isidentifier()
                or not PureWindowsPath(executable).is_absolute()
                or executable.startswith("\\\\")
                or not executable.lower().endswith(".exe")
            ):
                raise ValueError(
                    "Applications require a simple ID and absolute .exe path"
                )
        return self


class BrowserStep(BaseModel):
    action: Literal["read", "click", "fill", "press", "screenshot"]
    selector: str = Field(default="body", min_length=1, max_length=300)
    text: str = Field(default="", max_length=4000)
    expected_text: str = Field(default="", max_length=1000)
    key: Literal["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"] = "Tab"


class BrowserPlan(BaseModel):
    url: str = Field(max_length=2000)
    steps: list[BrowserStep] = Field(min_length=1, max_length=20)


class BrowserInspect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2000)
    visible: bool = False
    hold_seconds: int = Field(default=0, ge=0, le=120, strict=True)

    @model_validator(mode="after")
    def visible_hold(self):
        if self.hold_seconds and not self.visible:
            raise ValueError("A browser hold requires a visible managed window")
        return self


class FormOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str = Field(max_length=200)
    label: str = Field(max_length=200)


class FormField(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selector: str = Field(min_length=1, max_length=300)
    label: str = Field(max_length=200)
    type: str = Field(max_length=30)
    tag: Literal["input", "textarea", "select"]
    name: str = Field(max_length=200)
    id: str = Field(max_length=200)
    placeholder: str = Field(max_length=200)
    required: bool
    pattern: str = Field(max_length=200)
    minimum: str = Field(max_length=100)
    maximum: str = Field(max_length=100)
    max_length: int
    readonly: bool
    disabled: bool
    options: list[FormOption] = Field(default_factory=list, max_length=100)
    value_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


def form_fingerprint(url, fields):
    values = [field.model_dump() if isinstance(field, FormField) else field for field in fields]
    return hashlib.sha256(json.dumps({"url": url, "fields": values}, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


class FormSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2000)
    fields: list[FormField] = Field(max_length=40)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def valid_fingerprint(self):
        if (len({field.selector for field in self.fields}) != len(self.fields)
                or self.fingerprint != form_fingerprint(self.url, self.fields)):
            raise ValueError("Inspected form snapshot is invalid")
        return self


class FormValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selector: str = Field(min_length=1, max_length=300)
    text: str = Field(max_length=4000)


class BrowserFill(BrowserInspect):
    form_snapshot: FormSnapshot
    values: list[FormValue] = Field(min_length=1, max_length=40)
    allow_network_writes: bool = False

    @model_validator(mode="after")
    def inspected_values(self):
        names = [value.selector for value in self.values]
        if (self.url != self.form_snapshot.url or len(set(names)) != len(names)
                or not set(names) <= {field.selector for field in self.form_snapshot.fields}):
            raise ValueError("Fill values must reference distinct inspected fields at the exact URL")
        return self


class WindowsStep(BaseModel):
    action: Literal["read", "click", "fill", "menu", "screenshot"]
    auto_id: str = Field(default="", max_length=200)
    control_type: str = Field(default="", max_length=80)
    text: str = Field(default="", max_length=2000)
    expected_text: str = Field(default="", max_length=1000)


class WindowsPlan(BaseModel):
    application_id: str = Field(min_length=1, max_length=80)
    title: str = Field(default="", max_length=200)
    steps: list[WindowsStep] = Field(min_length=1, max_length=20)


def policy(connect):
    with connect() as db:
        return AutomationPolicy(**store.get(db, "automation_policy", {}))


def destination(url, rules):
    p = urlsplit(url)
    host = (p.hostname or "").rstrip(".").lower()
    testing = os.getenv("NIGHTBREW_ENV") == "test"
    local_test = testing and p.hostname in ("127.0.0.1", "localhost")
    if (
        p.username
        or p.password
        or p.hostname not in rules.browser_hosts
        or p.scheme not in ("https", "http")
        or (p.scheme != "https" and not local_test)
    ):
        raise ValueError("Browser destination is not allowed")
    if not local_test and (
        host in ("localhost", "127.0.0.1", "169.254.169.254")
        or host.endswith((".local", ".internal", ".localhost", ".lan", ".home", ".home.arpa"))
        or "%" in host or "\\" in host
    ):
        raise ValueError("Private browser destinations are forbidden")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if not local_test and address and not address.is_global:
        raise ValueError("Private browser addresses are forbidden")
    if not local_test and address is None and all(c in "0123456789." for c in host):
        raise ValueError("Ambiguous numeric browser addresses are forbidden")
    if not local_test and p.port not in (None, 443):
        raise ValueError("Production browser destinations require HTTPS port 443")
    return url


def prepare(connect, tool, payload):
    rules = policy(connect)
    if tool in ("browser.inspect", "browser.fill"):
        plan = BrowserFill.model_validate(payload) if tool == "browser.fill" else BrowserInspect.model_validate(payload)
        destination(plan.url, rules)
        if tool == "browser.fill" and plan.allow_network_writes and not rules.browser_writes:
            raise ValueError("Network writes require both administrator policy and exact-task permission")
    elif tool == "browser.run":
        plan = BrowserPlan.model_validate(payload)
        destination(plan.url, rules)
    elif tool == "windows.run":
        plan = WindowsPlan.model_validate(payload)
        if plan.application_id not in rules.applications:
            raise ValueError("Application is not approved")
    else:
        raise ValueError("Unknown automation tool")
    return {"plan": plan.model_dump(), "policy_snapshot": rules.model_dump()}


def browser_launch_options(rules, db_path, *, visible=False):
    """Only installed browsers; no download, default profile or credential reuse."""
    launch = {"headless": not visible, "downloads_path": str(files.file_root(db_path))}
    name, executable = installed_browser(rules.browser_engine)
    proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
    if proxy:
        launch["proxy"] = {"server": proxy, "bypass": "localhost,127.0.0.1,[::1]"}
    launch["executable_path"] = executable
    return launch


def installed_browser(engine="auto"):
    configured = os.getenv("NIGHTBREW_BROWSER_EXECUTABLE")
    if configured:
        if not Path(configured).is_file():
            raise ValueError("Configured browser executable is unavailable")
        return "Configured browser", configured
    system = platform.system()
    candidates = {"chrome": [], "edge": [], "chromium": []}
    if system == "Darwin":
        for prefix in (Path("/Applications"), Path.home() / "Applications"):
            candidates["chrome"].append(str(prefix / "Google Chrome.app/Contents/MacOS/Google Chrome"))
            candidates["edge"].append(str(prefix / "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"))
    elif system == "Windows":
        for prefix in (os.getenv("ProgramFiles"), os.getenv("ProgramFiles(x86)"), os.getenv("LOCALAPPDATA")):
            if prefix:
                candidates["chrome"].append(str(Path(prefix) / "Google/Chrome/Application/chrome.exe"))
                candidates["edge"].append(str(Path(prefix) / "Microsoft/Edge/Application/msedge.exe"))
    for kind, commands in {"chrome": ("google-chrome", "google-chrome-stable"),
                           "edge": ("msedge", "microsoft-edge"), "chromium": ("chromium", "chromium-browser")}.items():
        candidates[kind].extend(value for command in commands if (value := shutil.which(command)))
    order = [engine] if engine != "auto" else (["edge", "chrome", "chromium"] if system == "Windows" else ["chrome", "edge", "chromium"])
    for kind in order:
        for filename in candidates[kind]:
            if Path(filename).is_file():
                return {"chrome": "Google Chrome", "edge": "Microsoft Edge", "chromium": "Chromium"}[kind], filename
    if "chromium" in order:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            bundled = playwright.chromium.executable_path
        if Path(bundled).is_file():
            return "Playwright Chromium", bundled
    raise ValueError("No selected browser is installed. Install Google Chrome or Microsoft Edge, or configure an existing browser executable; NightBrew does not download browsers automatically")


def browser_capabilities(connect=None):
    try:
        configured = policy(connect).browser_engine if connect else "auto"
        name, _ = installed_browser(configured)
        return {"available": True, "name": name, "reason": "Installed browser available. Uses a separate session, not your existing signed-in window."}
    except Exception:
        return {"available": False, "name": "", "reason": "Install the selected Chrome/Edge browser or configure an existing executable. Safari and existing signed-in windows are not automatically controlled."}


def browser(connect, db_path, payload, checkpoint):
    from playwright.sync_api import sync_playwright

    rules = policy(connect)
    if rules.model_dump() != payload["policy_snapshot"]:
        raise ValueError("Automation policy changed; request new approval")
    plan = BrowserPlan.model_validate(payload["plan"])
    destination(plan.url, rules)
    results, artifacts = [], []
    try:
        launch = browser_launch_options(rules, db_path)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(**launch)
            try:
                context = browser.new_context(
                    accept_downloads=False,
                    service_workers="block",
                    viewport={"width": 1280, "height": 800},
                )

                def route(request_route):
                    request = request_route.request
                    try:
                        destination(request.url, rules)
                        if (
                            request.method not in ("GET", "HEAD")
                            and not rules.browser_writes
                        ):
                            raise ValueError("Network write denied")
                        request_route.continue_()
                    except ValueError:
                        request_route.abort("blockedbyclient")

                context.route("**/*", route)
                context.route_web_socket("**/*", lambda websocket: websocket.close())
                context.on(
                    "page",
                    lambda page: page.close() if len(context.pages) > 1 else None,
                )
                page = context.new_page()
                page.set_default_timeout(5000)
                page.goto(plan.url, wait_until="domcontentloaded", timeout=15000)
                for step in plan.steps:
                    checkpoint()
                    target = page.locator(step.selector)
                    if step.action == "read":
                        value = target.inner_text()[:10000]
                    elif step.action == "click":
                        target.click()
                        value = "clicked"
                    elif step.action == "fill":
                        if target.get_attribute("type") == "password":
                            raise ValueError(
                                "Password entry is not supported in stored plans"
                            )
                        target.fill(step.text)
                        value = "filled"
                    elif step.action == "press":
                        target.press(step.key)
                        value = "key sent"
                    else:
                        data = page.screenshot(type="png")
                        artifact = files.save(
                            connect,
                            db_path,
                            "browser-screenshot.png",
                            data,
                            trusted=True,
                        )
                        artifacts.append(artifact)
                        value = artifact
                    if step.expected_text:
                        from playwright.sync_api import expect

                        if step.action == "fill":
                            expect(target).to_have_value(step.expected_text)
                        else:
                            expect(target).to_contain_text(step.expected_text)
                    results.append(
                        {
                            "action": step.action,
                            "verified": bool(step.expected_text),
                            "result": value,
                        }
                    )
                checkpoint()
                return {
                    "steps": results,
                    "artifacts": artifacts,
                    "untrusted_content": True,
                }
            finally:
                browser.close()
    except Exception:
        for artifact in artifacts:
            files.delete(connect, db_path, artifact["id"])
        raise


# Fixed read-only DOM inspection code. No page/user supplied script is evaluated.
FORM_INSPECTION_SCRIPT = r"""() => {
  const candidates = Array.from(document.querySelectorAll('input,textarea,select'));
  if (candidates.length > 200) throw new Error('Too many form controls to inspect safely');
  const result = [];
  const safeTypes = new Set(['text','email','tel','url','number','date','time','datetime-local','month','week']);
  const sensitive = /password|passwd|secret|token|one.?time|\botp\b|\bpin\b|\bcvv\b|\bcvc\b|credit.?card|card.?number|card.?security/i;
  const cssPath = element => {
    if (element.id) {
      const selector = '#' + CSS.escape(element.id);
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(e => e.tagName === current.tagName) : [];
      parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''));
      if (tag === 'html') break;
    }
    return parts.join(' > ');
  };
  for (const element of candidates) {
    const tag = element.tagName.toLowerCase();
    const type = tag === 'input' ? element.type.toLowerCase() : tag;
    const style = getComputedStyle(element);
    if ((tag === 'input' && !safeTypes.has(type)) || element.disabled || element.readOnly ||
        style.visibility === 'hidden' || style.display === 'none' || !element.getClientRects().length) continue;
    const label = (Array.from(element.labels || []).map(e => e.textContent || '').join(' ') ||
      element.getAttribute('aria-label') || element.placeholder || element.name || element.id || type).trim();
    const autocomplete = element.getAttribute('autocomplete') || '';
    if (sensitive.test([label, element.name, element.id, autocomplete].join(' ')) || /^(?:cc-|current-password|new-password|one-time-code)/i.test(autocomplete)) continue;
    const selector = cssPath(element);
    const current = String(element.value ?? '');
    if (selector.length > 300 || current.length > 4000 || (element.options && (element.options.length > 100 || Array.from(element.options).some(option => option.value.length > 200 || option.label.length > 200)))) continue;
    const options = tag === 'select' ? Array.from(element.options).map(option => ({value: option.value.slice(0, 200), label: option.label.slice(0, 200)})) : [];
    result.push({selector, label: label.slice(0, 200), type, tag,
      name: String(element.name || '').slice(0, 200), id: String(element.id || '').slice(0, 200),
      placeholder: String(element.placeholder || '').slice(0, 200), required: !!element.required,
      pattern: String(element.pattern || '').slice(0, 200), minimum: String(element.min || '').slice(0, 100),
      maximum: String(element.max || '').slice(0, 100), max_length: Number.isInteger(element.maxLength) ? element.maxLength : -1,
      readonly: !!element.readOnly, disabled: !!element.disabled, options, _current_value: current});
    if (result.length > 40) throw new Error('Maximum forty supported form fields');
  }
  return result;
}"""


def inspected_form(page):
    fields = []
    for item in page.evaluate(FORM_INSPECTION_SCRIPT):
        value = item.pop("_current_value")
        item["value_hash"] = hashlib.sha256(value.encode()).hexdigest()
        fields.append(FormField.model_validate(item))
    return FormSnapshot(url=page.url, fields=fields, fingerprint=form_fingerprint(page.url, fields))


def browser_forms(connect, db_path, payload, checkpoint, tool):
    """Inspect or fill an approved exact form; never clicks a submit/send control."""
    from playwright.sync_api import expect, sync_playwright

    if tool not in ("browser.inspect", "browser.fill"):
        raise ValueError("Unknown form automation tool")
    rules = policy(connect)
    if rules.model_dump() != payload["policy_snapshot"]:
        raise ValueError("Automation policy changed; request new approval")
    plan = BrowserFill.model_validate(payload["plan"]) if tool == "browser.fill" else BrowserInspect.model_validate(payload["plan"])
    destination(plan.url, rules)
    writes = tool == "browser.fill" and plan.allow_network_writes
    if writes and not rules.browser_writes:
        raise ValueError("Network write permission was revoked")
    artifacts = []
    try:
        launch = browser_launch_options(rules, db_path, visible=plan.visible)
        with sync_playwright() as playwright:
            managed = playwright.chromium.launch(**launch)
            try:
                context = managed.new_context(accept_downloads=False, service_workers="block", viewport={"width": 1280, "height": 800})

                def route(request_route):
                    try:
                        checkpoint()
                        destination(request_route.request.url, rules)
                        if request_route.request.method not in ("GET", "HEAD") and not writes:
                            raise ValueError("This inspected task does not permit network writes")
                        request_route.continue_()
                    except Exception:
                        request_route.abort("blockedbyclient")

                context.route("**/*", route)
                context.route_web_socket("**/*", lambda websocket: websocket.close())
                context.on("page", lambda opened: opened.close() if len(context.pages) > 1 else None)
                page = context.new_page()
                page.set_default_timeout(5000)
                checkpoint()
                page.goto(plan.url, wait_until="domcontentloaded", timeout=15000)
                destination(page.url, rules)
                snapshot = inspected_form(page)
                results = []
                if tool == "browser.fill":
                    if snapshot != plan.form_snapshot:
                        raise ValueError("Page, fields or existing values changed; inspect and approve again")
                    expected_fields = [field.model_copy(deep=True) for field in snapshot.fields]
                    for item in plan.values:
                        checkpoint()
                        current = inspected_form(page)
                        if current.fingerprint != form_fingerprint(plan.url, expected_fields):
                            raise ValueError("Form changed during filling; stop and inspect again")
                        field = next(field for field in expected_fields if field.selector == item.selector)
                        target = page.locator(item.selector)
                        if target.count() != 1 or not target.is_visible() or not target.is_editable():
                            raise ValueError("Inspected field is ambiguous or no longer editable")
                        if field.tag == "select":
                            if item.text not in {option.value for option in field.options}:
                                raise ValueError("Select value was not an inspected option")
                            target.select_option(value=item.text)
                        else:
                            target.fill(item.text)
                        expect(target).to_have_value(item.text)
                        if not target.evaluate("element => element.checkValidity()"):
                            raise ValueError("Filled value violates the form's validation rules")
                        field.value_hash = hashlib.sha256(item.text.encode()).hexdigest()
                        if inspected_form(page).fingerprint != form_fingerprint(plan.url, expected_fields):
                            raise ValueError("Form changed after filling; stop and inspect again")
                        results.append({"action": "fill", "selector": item.selector, "label": field.label, "verified": True, "result": "filled"})
                checkpoint()
                allowed_selectors = ','.join(field.selector for field in snapshot.fields)
                masked_selector = ':is(input,textarea,select)' + (':not(' + allowed_selectors + ')' if allowed_selectors else '')
                artifact = files.save(connect, db_path, "browser-form.png",
                                      page.screenshot(type="png", mask=[page.locator(masked_selector)]), trusted=True)
                artifacts.append(artifact)
                end = time.monotonic() + plan.hold_seconds
                while time.monotonic() < end and managed.is_connected() and not page.is_closed():
                    checkpoint()
                    try:
                        page.wait_for_timeout(min(200, max(1, int((end - time.monotonic()) * 1000))))
                    except Exception:
                        if page.is_closed() or not managed.is_connected():
                            break
                        raise
                checkpoint()
                return {
                    "form_snapshot": snapshot.model_dump(), "fields": [field.model_dump() for field in snapshot.fields],
                    "steps": results, "artifacts": artifacts, "network_writes_allowed": writes,
                    "untrusted_content": True, "managed_browser_closed_after_task": True,
                    "note": "Independent managed session; no existing login is reused. No automatic submit/send. Password/payment/hidden fields and iframe controls are unsupported. Review window closes after its approved hold.",
                }
            finally:
                managed.close()
    except Exception:
        for artifact in artifacts:
            files.delete(connect, db_path, artifact["id"])
        raise


def windows(connect, db_path, payload, checkpoint):
    if platform.system() != "Windows":
        raise ValueError("Windows UI Automation requires Windows")
    from pywinauto.application import Application, ProcessNotFoundError
    from pywinauto.timings import TimeoutError as UIATimeoutError

    rules = policy(connect)
    if rules.model_dump() != payload["policy_snapshot"]:
        raise ValueError("Automation policy changed; request new approval")
    plan = WindowsPlan.model_validate(payload["plan"])
    executable = rules.applications.get(plan.application_id)
    if not executable or not Path(executable).is_file():
        raise ValueError("Approved executable is unavailable")
    checkpoint()
    # No shell, arguments, regular expressions or coordinate mouse control are accepted.
    application = Application(backend="uia")
    try:
        application.connect(path=executable, timeout=2)
    except (ProcessNotFoundError, UIATimeoutError):
        application.start('"' + executable + '"', timeout=10)
    window = (
        application.window(title=plan.title) if plan.title else application.top_window()
    )
    window.wait("visible", timeout=10)
    results, artifacts = [], []
    try:
        for step in plan.steps:
            checkpoint()
            if step.auto_id or step.control_type:
                criteria = {}
                if step.auto_id:
                    criteria["auto_id"] = step.auto_id
                if step.control_type:
                    criteria["control_type"] = step.control_type
                target = window.child_window(**criteria)
            else:
                target = window
            if step.action == "read":
                value = [c.window_text()[:1000] for c in target.descendants()[:100]]
            elif step.action == "click":
                target.invoke()
                value = "invoked"
            elif step.action == "fill":
                target.set_edit_text(step.text)
                value = "filled"
            elif step.action == "menu":
                window.menu_select(step.text)
                value = "menu selected"
            else:
                output = io.BytesIO()
                window.capture_as_image().save(output, format="PNG")
                artifact = files.save(
                    connect,
                    db_path,
                    "window-screenshot.png",
                    output.getvalue(),
                    trusted=True,
                )
                artifacts.append(artifact)
                value = artifact
            verify_windows_result(target, step, checkpoint)
            results.append(
                {
                    "action": step.action,
                    "verified": bool(step.expected_text),
                    "result": value,
                }
            )
        checkpoint()
        return {"steps": results, "artifacts": artifacts, "untrusted_content": True}
    except Exception:
        for artifact in artifacts:
            files.delete(connect, db_path, artifact["id"])
        raise


def verify_windows_result(target, step, checkpoint):
    if not step.expected_text:
        return
    until = time.monotonic() + 5
    # UIA control Name/Text and Value are different properties. Edits verify the Value pattern.
    while step.expected_text not in (
        target.get_value() if step.action == "fill" else target.window_text()
    ):
        checkpoint()
        if time.monotonic() > until:
            raise ValueError("Windows result verification failed")
        time.sleep(0.1)
