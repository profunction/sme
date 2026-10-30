"""Frozen/development managed backend entrypoint; logs contain no session token."""

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn


def main():
    token = os.getenv("NIGHTBREW_SESSION_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("A strong managed session token is required")
    path = Path(
        os.getenv("NIGHTBREW_DB", str(Path.home() / ".nightbrew" / "chat.sqlite3"))
    )
    logs = path.parent / "logs"
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    handler = RotatingFileHandler(
        logs / "backend.log", maxBytes=2 * 1024**2, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    for name in ("httpx", "httpcore", "pywinauto", "comtypes"):
        logging.getLogger(name).setLevel(logging.WARNING)
    # No request-body, authorization-header, process-environment or credential logging.
    from backend.app import app

    uvicorn.run(app, host="127.0.0.1", port=8765, log_config=None, access_log=False)


if __name__ == "__main__":
    main()
