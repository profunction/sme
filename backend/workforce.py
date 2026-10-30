"""Employee identities are application records, not untrusted prompt-supplied permissions."""

import json
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from backend import licensing, store

ALLOWED_TOOLS = {
    "document.generate",
    "excel.analyze",
    "document.extract",
    "file.delete",
    "connector.read",
    "connector.write",
    "browser.run",
    "windows.run",
    "ai.chat",
}


class Employee(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=100)
    instructions: str = Field(default="", max_length=4000)
    tools: list[str] = Field(
        default_factory=lambda: [
            "document.generate",
            "excel.analyze",
            "document.extract",
        ],
        max_length=20,
    )
    connectors: dict[str, list[Literal["read", "write"]]] = Field(
        default_factory=dict, max_length=50
    )
    monthly_spending_limit_usd: float = Field(
        default=0, ge=0, le=10000, allow_inf_nan=False
    )
    monthly_task_limit: int = Field(default=100, ge=0, le=100000)
    require_approval: bool = True
    active: bool = True

    @field_validator("tools")
    @classmethod
    def known_tools(cls, values):
        if not set(values) <= ALLOWED_TOOLS:
            raise ValueError("Unknown employee tool")
        return sorted(set(values))


def get(db, identifier):
    row = db.execute(
        "SELECT config FROM employees WHERE id=?", (identifier,)
    ).fetchone()
    if not row:
        raise ValueError("Unknown employee")
    return Employee(**json.loads(row[0]))


def save(connect, employee, identifier=None):
    identifier = identifier or uuid.uuid4().hex
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if (
            db.execute("SELECT COUNT(*) FROM employees").fetchone()[0] >= 100
            and not db.execute(
                "SELECT 1 FROM employees WHERE id=?", (identifier,)
            ).fetchone()
        ):
            raise ValueError("Maximum 100 employees")
        licensing.reserve_seat(connect, identifier, employee.active)
        db.execute(
            "INSERT INTO employees(id,config) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
            (identifier, employee.model_dump_json()),
        )
        store.audit(db, "employee_saved", identifier)
    return {"id": identifier, **employee.model_dump()}


def check(db, identifier, tool, payload):
    employee = get(db, identifier)
    if not employee.active or tool not in employee.tools:
        raise ValueError("Employee is inactive or lacks tool permission")
    if tool in ("connector.read", "connector.write"):
        access = "write" if tool.endswith("write") else "read"
        if access not in employee.connectors.get(payload.get("connector_id"), []):
            raise ValueError("Employee lacks connector permission")
    count = db.execute(
        "SELECT COUNT(*) FROM assignments a JOIN tasks t ON t.id=a.task_id WHERE a.employee_id=? AND strftime('%Y-%m',t.created_at)=strftime('%Y-%m','now')",
        (identifier,),
    ).fetchone()[0]
    if count >= employee.monthly_task_limit:
        raise ValueError("Employee monthly task quota reached")
    return employee


def execution_check(connect, task_id):
    with connect() as db:
        row = db.execute(
            "SELECT * FROM assignments WHERE task_id=?", (task_id,)
        ).fetchone()
        if not row:
            return
        current = get(db, row["employee_id"])
        if current.model_dump_json() != row["snapshot"] or not current.active:
            raise ValueError(
                "Employee permissions or instructions changed; create a new task"
            )
        return row["employee_id"]


def spending_check(db, identifier, amount):
    employee = get(db, identifier)
    if not employee.active or "ai.chat" not in employee.tools:
        raise ValueError("Employee lacks AI chat permission")
    spent = db.execute(
        "SELECT COALESCE(SUM(u.cost),0) FROM usage u JOIN usage_owners o ON o.usage_id=u.id WHERE o.employee_id=? AND u.month=strftime('%Y-%m','now')",
        (identifier,),
    ).fetchone()[0]
    if spent + amount > employee.monthly_spending_limit_usd:
        raise ValueError("Employee spending limit exceeded")
