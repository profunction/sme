"""Expose sanitized CI failure annotations without needing authenticated log access."""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    print("::error title=Test diagnostics::Pytest did not produce its JUnit report")
    raise SystemExit(0)
for case in ET.parse(path).iter("testcase"):
    for kind in ("failure", "error"):
        failure = case.find(kind)
        if failure is None:
            continue
        message = failure.attrib.get("message") or (failure.text or "").splitlines()[-1]
        message = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", message)
        message = re.sub(r"[A-Za-z0-9_+/=-]{36,}", "[redacted]", message)[:1800]
        message = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title={case.attrib.get('name', 'Test failure')}::{message}")
