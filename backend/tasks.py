"""Bounded local task queue. Payloads are immutable once approval is requested."""

import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from backend import automation, documents, files, licensing, purchaseorders, store, workforce

EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="nightbrew-task")
TOOLS = {
    "document.generate",
    "excel.analyze",
    "document.extract",
    "file.delete",
    "browser.run",
    "windows.run",
    "connector.read",
    "purchase_order.import",
    "purchase_order.review",
    "purchase_order.export",
}
APPROVAL = {"file.delete", "connector.write", "browser.run", "windows.run", "purchase_order.export"}
TIMEOUT_SECONDS = 60
# A single process owns the SQLite job queue. No external action is replayed after restart.


class Cancelled(Exception):
    pass


def create(connect, tool, payload, employee_id=None):
    if tool not in TOOLS and tool != "connector.write":
        raise ValueError("Tool is not permitted")
    if tool.startswith("purchase_order."):
        payload = purchaseorders.prepare(tool, payload)
    elif tool == "document.generate":
        payload = documents.BusinessDocument.model_validate(payload).model_dump(
            mode="json"
        )
    elif tool in ("browser.run", "windows.run"):
        payload = automation.prepare(connect, tool, payload)
    elif tool == "connector.read":
        from backend import connectors

        connectors.get(connect, payload.get("connector_id"))
        payload = {"connector_id": payload["connector_id"]}
    elif tool in TOOLS:
        payload = documents.FileOperation.model_validate(payload).model_dump()
    identifier = uuid.uuid4().hex
    status = "pending_approval" if tool in APPROVAL else "queued"
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if store.get(db, "emergency_stop", False):
            raise ValueError("Emergency stop is active")
        employee = (
            workforce.check(db, employee_id, tool, payload) if employee_id else None
        )
        if employee and employee.require_approval:
            status = "pending_approval"
        licensing.reserve_task(connect, identifier, employee_id)
        pending = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE status IN ('queued','running','pending_approval','cancel_requested')"
        ).fetchone()[0]
        if pending >= 100:
            raise ValueError("Task queue is full")
        db.execute(
            "INSERT INTO tasks(id,tool,payload,status) VALUES(?,?,?,?)",
            (identifier, tool, json.dumps(payload), status),
        )
        if employee:
            db.execute(
                "INSERT INTO assignments VALUES(?,?,?)",
                (identifier, employee_id, employee.model_dump_json()),
            )
        store.audit(db, "task_created", identifier, tool)
    return identifier, status


def checkpoint(connect, identifier, deadline):
    with connect() as db:
        row = db.execute(
            "SELECT status FROM tasks WHERE id=?", (identifier,)
        ).fetchone()
        if (
            not row
            or row["status"] != "running"
            or store.get(db, "emergency_stop", False)
        ):
            raise Cancelled()
    if time.monotonic() > deadline:
        raise TimeoutError("Task deadline exceeded")


def execute(connect, db_path, identifier):
    with connect() as db:
        changed = db.execute(
            "UPDATE tasks SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'",
            (identifier,),
        ).rowcount
        if not changed:
            return
        row = db.execute("SELECT * FROM tasks WHERE id=?", (identifier,)).fetchone()
    deadline = time.monotonic() + TIMEOUT_SECONDS
    check = lambda: checkpoint(connect, identifier, deadline)
    result = None
    try:
        check()
        licensing.enforce(connect)
        employee_id = workforce.execution_check(connect, identifier)
        licensing.reserve_task(connect, identifier, employee_id)
        payload = json.loads(row["payload"])
        if row["tool"].startswith("purchase_order."):
            result = purchaseorders.run(row["tool"], payload, connect, db_path, check)
        elif row["tool"] == "connector.write":
            from backend import connectors

            result = connectors.write(connect, payload, check)
        elif row["tool"] == "connector.read":
            from backend import connectors

            result = connectors.read(
                connect, payload["connector_id"], reserve_license=False
            )
        elif row["tool"] == "browser.run":
            result = automation.browser(connect, db_path, payload, check)
        elif row["tool"] == "windows.run":
            result = automation.windows(connect, db_path, payload, check)
        else:
            result = documents.run(row["tool"], payload, connect, db_path, check)
        check()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute(
                "SELECT status FROM tasks WHERE id=?", (identifier,)
            ).fetchone()[0]
            if current != "running" or store.get(db, "emergency_stop", False):
                raise Cancelled()
            db.execute(
                "UPDATE tasks SET status='completed',result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (json.dumps(result), identifier),
            )
            store.audit(db, "task_completed", identifier, row["tool"])
    except Exception as exc:  # noqa: BLE001 -- Persist a terminal status for all tool/plugin failures.
        # Generated files from a cancelled/failed task must not linger as successful outputs.
        if result and isinstance(result, dict) and result.get("file"):
            try:
                files.delete(connect, db_path, result["file"]["id"])
            except (ValueError, OSError):
                pass
        if result and isinstance(result, dict):
            for artifact in result.get("artifacts", []):
                try:
                    files.delete(connect, db_path, artifact["id"])
                except (ValueError, OSError):
                    pass
        status = "cancelled" if isinstance(exc, Cancelled) else "failed"
        error = (
            "Cancelled. In-flight external writes may already have occurred; verify the remote system before retrying."
            if status == "cancelled"
            else (
                "Task exceeded deadline"
                if isinstance(exc, TimeoutError)
                else "Task failed; check input, connector configuration and permissions. External write outcome may be unknown; verify before retrying."
            )
        )
        with connect() as db:
            db.execute(
                "UPDATE tasks SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (status, error, identifier),
            )
            store.audit(db, "task_" + status, identifier, row["tool"])


def schedule(connect, db_path, identifier):
    EXECUTOR.submit(execute, connect, db_path, identifier)


def approve(connect, identifier):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if store.get(db, "emergency_stop", False):
            raise ValueError("Emergency stop is active")
        changed = db.execute(
            "UPDATE tasks SET status='queued',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_approval'",
            (identifier,),
        ).rowcount
        if not changed:
            raise ValueError("Task is not awaiting approval")
        store.audit(db, "task_approved", identifier)


def cancel(connect, identifier):
    with connect() as db:
        changed = db.execute(
            "UPDATE tasks SET status=CASE WHEN status='running' THEN 'cancel_requested' ELSE 'cancelled' END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','pending_approval','running')",
            (identifier,),
        ).rowcount
        if not changed:
            raise ValueError("Task not found or no longer cancellable")
        store.audit(db, "task_cancel_requested", identifier)


def stop(connect):
    with connect() as db:
        store.put(db, "emergency_stop", True)
        db.execute(
            "UPDATE tasks SET status=CASE WHEN status='running' THEN 'cancel_requested' ELSE 'cancelled' END,updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','pending_approval','running')"
        )
        store.audit(db, "emergency_stop", "all_tasks")


def recover(connect):
    with connect() as db:
        db.execute(
            "UPDATE tasks SET status='interrupted',error='Backend restarted; external outcome may be unknown. Inspect before creating a new task.' WHERE status IN ('running','queued','cancel_requested')"
        )
