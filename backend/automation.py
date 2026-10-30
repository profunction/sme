"""Approved deterministic plans; no AI-generated Python, JavaScript or shell commands."""

import io
import ipaddress
import os
import platform
import time
from pathlib import Path, PureWindowsPath
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, model_validator

from backend import files, store


class AutomationPolicy(BaseModel):
    browser_hosts: list[str] = Field(default_factory=list, max_length=30)
    browser_writes: bool = False
    # App IDs map to exact executable paths. Only the local administrator edits this policy.
    applications: dict[str, str] = Field(default_factory=dict, max_length=30)

    @model_validator(mode="after")
    def validate_policy(self):
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
        p.hostname in ("localhost", "127.0.0.1", "169.254.169.254")
        or p.hostname.endswith((".local", ".internal", ".localhost"))
    ):
        raise ValueError("Private browser destinations are forbidden")
    try:
        address = ipaddress.ip_address(p.hostname)
    except ValueError:
        address = None
    if not local_test and address and not address.is_global:
        raise ValueError("Private browser addresses are forbidden")
    if not local_test and p.port not in (None, 443):
        raise ValueError("Production browser destinations require HTTPS port 443")
    return url


def prepare(connect, tool, payload):
    rules = policy(connect)
    if tool == "browser.run":
        plan = BrowserPlan.model_validate(payload)
        destination(plan.url, rules)
    elif tool == "windows.run":
        plan = WindowsPlan.model_validate(payload)
        if plan.application_id not in rules.applications:
            raise ValueError("Application is not approved")
    else:
        raise ValueError("Unknown automation tool")
    return {"plan": plan.model_dump(), "policy_snapshot": rules.model_dump()}


def browser(connect, db_path, payload, checkpoint):
    from playwright.sync_api import sync_playwright

    rules = policy(connect)
    if rules.model_dump() != payload["policy_snapshot"]:
        raise ValueError("Automation policy changed; request new approval")
    plan = BrowserPlan.model_validate(payload["plan"])
    destination(plan.url, rules)
    results, artifacts = [], []
    try:
        with sync_playwright() as playwright:
            executable = os.getenv("NIGHTBREW_BROWSER_EXECUTABLE")
            # Use bundled Chrome on Windows or the explicitly configured cloud browser.
            launch = {"headless": True, "downloads_path": str(files.file_root(db_path))}
            proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
            if proxy:
                launch["proxy"] = {
                    "server": proxy,
                    "bypass": "localhost,127.0.0.1,[::1]",
                }
            if executable:
                launch["executable_path"] = executable
            else:
                launch["channel"] = "msedge"
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
