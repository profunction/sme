"""Build on the target OS; PyInstaller is not a cross compiler."""

import subprocess
import sys
from pathlib import Path

if sys.platform != "win32" and "--allow-native" not in sys.argv:
    raise SystemExit(
        "Windows backend must be built on Windows; use the Windows CI workflow. --allow-native builds Linux for local packaging validation only."
    )
command = [
    sys.executable,
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name",
    "nightbrew-backend",
    "--distpath",
    "build/backend",
    "--workpath",
    "build/pyinstaller",
    "--specpath",
    "build",
    "--paths",
    str(Path.cwd()),
    "--collect-all",
    "playwright",
    "--collect-all",
    "reportlab",
    "--collect-all",
    "keyring",
    "--hidden-import",
    "uvicorn.logging",
    "--hidden-import",
    "uvicorn.loops.auto",
    "--hidden-import",
    "uvicorn.protocols.http.h11_impl",
    "--hidden-import",
    "uvicorn.lifespan.on",
]
if sys.platform == "win32":
    command += [
        "--hidden-import",
        "keyring.backends.Windows",
        "--collect-all",
        "pywinauto",
        "--collect-all",
        "comtypes",
    ]
command += ["backend/entrypoint.py"]
subprocess.run(command, check=True)
