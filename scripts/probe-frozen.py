"""Authenticate an owned frozen backend and report sanitized startup failures only."""

import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

executable = Path(sys.argv[1]).resolve()
if not executable.is_file():
    raise SystemExit("Frozen executable is missing")
root = Path(tempfile.mkdtemp(prefix="nightbrew-frozen-probe-"))
token = secrets.token_urlsafe(48)
instance = secrets.token_hex(16)
environment = {
    **os.environ,
    "NIGHTBREW_SESSION_TOKEN": token,
    "NIGHTBREW_INSTANCE_ID": instance,
    "NIGHTBREW_DB": str(root / "chat.sqlite3"),
}
output = (root / "process.log").open("wb")
process = subprocess.Popen(
    [str(executable)],
    cwd=root,
    env=environment,
    stdout=output,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
)
passed = False
try:
    deadline = time.monotonic() + 45
    with httpx.Client(trust_env=False, timeout=1) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            try:
                response = client.get(
                    "http://127.0.0.1:8765/session",
                    headers={"Authorization": "Bearer " + token},
                )
                if (
                    response.status_code == 200
                    and response.json()["instance_id"] == instance
                ):
                    passed = True
                    print("Frozen backend authenticated readiness passed")
                    break
            except (httpx.HTTPError, ValueError, KeyError):
                pass
            time.sleep(0.1)
    if not passed:
        output.flush()
        message = (
            (root / "process.log")
            .read_text(errors="replace")[-6000:]
            .replace(token, "[redacted]")
        )
        message = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", message)
        message = re.sub(r"[A-Za-z0-9_+/=-]{36,}", "[redacted]", message)
        print(
            f"::error title=Frozen backend startup::Exit code {process.poll()}; "
            + message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        )
finally:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    output.close()
raise SystemExit(0 if passed else 1)
