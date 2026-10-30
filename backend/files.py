"""Opaque file IDs only; no API accepts an arbitrary local path."""

import io
import os
import re
import uuid
import zipfile
from pathlib import Path

from backend import store

MAX_BYTES = 10 * 1024 * 1024
ALLOWED = {".xlsx", ".pdf", ".docx", ".csv"}


def file_root(db_path):
    root = db_path.parent / "files"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink():
        raise ValueError("File workspace must not be a symlink")
    return root.resolve()


def validate(data, extension):
    if not data or len(data) > MAX_BYTES:
        raise ValueError("File must contain 1 byte to 10 MiB")
    if extension not in ALLOWED:
        raise ValueError("Supported uploads: XLSX, PDF, DOCX, CSV")
    if extension in (".xlsx", ".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if (
                    len(entries) > 2000
                    or sum(e.file_size for e in entries) > 32 * 1024**2
                ):
                    raise ValueError("Office archive exceeds extraction limits")
                for e in entries:
                    if (
                        e.file_size > 16 * 1024**2
                        or e.file_size > max(1, e.compress_size) * 200
                        or "vbaproject" in e.filename.lower()
                    ):
                        raise ValueError("Unsafe or oversized Office archive")
                if "[Content_Types].xml" not in archive.namelist():
                    raise ValueError("Invalid Office file")
        except zipfile.BadZipFile:
            raise ValueError("Invalid Office archive") from None
    if extension == ".pdf" and not data.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF header")


def save(connect, db_path, name, data, trusted=False):
    name = re.split(r"[/\\]", name)[-1][:120]
    extension = Path(name).suffix.lower()
    if not trusted:
        validate(data, extension)
    if not name or extension not in ALLOWED:
        raise ValueError("Unsupported file name")
    identifier = uuid.uuid4().hex
    path = file_root(db_path) / (identifier + extension)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)
    try:
        with connect() as db:
            db.execute(
                "INSERT INTO files(id,name,extension,size) VALUES(?,?,?,?)",
                (identifier, name, extension, len(data)),
            )
            store.audit(db, "file_created", identifier)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return {"id": identifier, "name": name, "size": len(data)}


def locate(connect, db_path, identifier):
    if not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise ValueError("Invalid file ID")
    with connect() as db:
        row = db.execute("SELECT * FROM files WHERE id=?", (identifier,)).fetchone()
    if not row:
        raise ValueError("File not found")
    root = file_root(db_path)
    path = root / (identifier + row["extension"])
    if path.is_symlink() or path.resolve().parent != root or not path.is_file():
        raise ValueError("File unavailable")
    return path, dict(row)


def delete(connect, db_path, identifier):
    path, _ = locate(connect, db_path, identifier)
    path.unlink()
    with connect() as db:
        db.execute("DELETE FROM files WHERE id=?", (identifier,))
        store.audit(db, "file_deleted", identifier)
