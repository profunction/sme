"""Authenticated loopback API; all AI output is untrusted text, never executable instructions."""

import json
import os
import secrets
from contextlib import asynccontextmanager
from datetime import UTC
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, SecretStr

from backend import (
    ai,
    connectors,
    credentials,
    files,
    hardware,
    model_settings,
    licensing,
    store,
    tasks,
)


@asynccontextmanager
async def lifespan(_app):
    tasks.recover(connect)
    yield


app = FastAPI(title="NightBrew AI Employee", version="0.9.2", lifespan=lifespan)
DB = Path(os.getenv("NIGHTBREW_DB", str(Path.home() / ".nightbrew" / "chat.sqlite3")))
TOKEN = os.getenv("NIGHTBREW_SESSION_TOKEN") or secrets.token_urlsafe(32)


def connect():
    return store.open_db(DB)


def authorize(authorization: str | None = Header(default=None)):
    if not authorization or not secrets.compare_digest(
        authorization.encode("utf-8"), f"Bearer {TOKEN}".encode()
    ):
        raise HTTPException(401, "Session authentication required")


@app.get("/health")
def health():
    return {"status": "ok", "version": app.version}


@app.get("/messages", dependencies=[Depends(authorize)])
def messages():
    with connect() as db:
        rows = db.execute(
            "SELECT id,role,content,provider FROM messages ORDER BY id DESC LIMIT 100"
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


@app.get("/hardware", dependencies=[Depends(authorize)])
def hardware_info():
    info = hardware.inspect()
    with connect() as db:
        measured = store.get(db, "benchmark")
    info["benchmark"] = measured
    info["local_plan_recommended"] = bool(
        measured
        and measured.get("local_plan_recommended")
        and measured.get("hardware_fingerprint") == hardware.fingerprint()
        and measured.get("model") in info["models"]
    )
    return info


@app.post("/hardware/benchmark", dependencies=[Depends(authorize)])
def benchmark():
    try:
        result = hardware.benchmark(model_settings.load(connect).local_model)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(
            502,
            "Local model benchmark unavailable; install/start Ollama and the selected model",
        ) from None
    from datetime import datetime

    result["measured_at"] = datetime.now(UTC).isoformat()
    with connect() as db:
        store.put(db, "benchmark", result)
    return result


@app.get("/settings/ai", dependencies=[Depends(authorize)])
def ai_settings():
    with connect() as db:
        return ai.Policy(**store.get(db, "ai_policy", {}))


@app.put("/settings/ai", dependencies=[Depends(authorize)])
def update_ai_settings(policy: ai.Policy):
    if licensing.local_preview() and (policy.cloud_allowed or policy.billing_source != "BYOK"):
        raise HTTPException(403, "Local preview only supports local Ollama; cloud inference is disabled")
    with connect() as db:
        store.put(db, "ai_policy", policy.model_dump())
        store.audit(db, "ai_policy_updated", "settings")
    return policy


@app.get("/settings/models", dependencies=[Depends(authorize)])
def get_models():
    return model_settings.load(connect)


@app.put("/settings/models", dependencies=[Depends(authorize)])
def set_models(config: model_settings.Models):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        previous = model_settings.read(db)
        store.put(db, "model_settings", config.model_dump())
        if config.local_model != previous.local_model:
            store.put(db, "benchmark", None)
        if (config.cloud_model, config.cloud_url) != (previous.cloud_model, previous.cloud_url):
            policy = ai.Policy(**store.get(db, "ai_policy", {}))
            policy.pricing_confirmed = False
            policy.cloud_allowed = False
            store.put(db, "ai_policy", policy.model_dump())
        store.audit(db, "model_settings_updated", "settings")
    return config


class KeyRequest(BaseModel):
    key: SecretStr


@app.put("/settings/cloud-key", dependencies=[Depends(authorize)])
def cloud_key(request: KeyRequest):
    try:
        credentials.save_key(request.key.get_secret_value())
    except Exception:  # noqa: BLE001 -- Native credential backends must not leak secret-bearing errors.
        raise HTTPException(
            503,
            "Native credential vault unavailable; use the backend environment binding",
        ) from None
    return {
        "stored": bool(request.key.get_secret_value()),
        "storage": "OS native credential vault",
    }


@app.get("/usage", dependencies=[Depends(authorize)])
def usage():
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM usage ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
        return {
            "currency": "USD",
            "entries": [dict(row) for row in rows],
            "policy": ai.Policy(**store.get(db, "ai_policy", {})),
        }


@app.post("/chat", dependencies=[Depends(authorize)])
def chat(request: ai.Chat):
    if licensing.local_preview() and request.mode != "LOCAL_ONLY":
        raise HTTPException(403, "Local preview only supports LOCAL_ONLY with your local Ollama")
    import uuid


    try:
        licensing.enforce(connect)
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None
    models = model_settings.load(connect)
    local_model = models.local_model
    with connect() as db:
        if store.get(db, "emergency_stop", False):
            raise HTTPException(409, "Emergency stop is active")
        policy = ai.Policy(**store.get(db, "ai_policy", {}))
        measured = store.get(db, "benchmark")
    try:
        selected = ai.select(request, policy, measured, local_model)
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None
    employee_instructions = ""
    operation_id = uuid.uuid4().hex
    if request.employee_id:
        from backend import workforce

        try:
            employee = workforce.reserve_chat(connect, request.employee_id, operation_id)
            employee_instructions = f"Role: {employee.role}\n{employee.instructions}"
        except ValueError as exc:
            raise HTTPException(403, str(exc)) from None
    try:
        licensing.reserve_task(connect, operation_id, request.employee_id)
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None
    cloud = selected == "CLOUD_ONLY"
    if cloud and policy.billing_source == "INCLUDED":
        reservation = None
        try:
            quote = licensing.remote(
                "/inference/estimate",
                {
                    "device_id": licensing.device_id(),
                    "request_id": uuid.uuid4().hex,
                    "message": request.message,
                    "system_text": employee_instructions,
                    "cloud_consent": request.cloud_consent,
                },
            )
            if not isinstance(quote, dict) or not isinstance(quote.get("model"), str) or "estimated_cost_usd" not in quote:
                raise ValueError("Licensing backend returned an invalid cost estimate")
            reservation, _ = ai.reserve(
                connect,
                quote["model"],
                request,
                policy,
                employee_instructions,
                override_amount=quote["estimated_cost_usd"],
            )
            result = licensing.included_inference(
                connect, request, employee_instructions
            )
            if (not isinstance(result, dict) or not isinstance(result.get("answer"), str)
                    or not result["answer"].strip() or not isinstance(result.get("model"), str)
                    or "cost_usd" not in result):
                raise ValueError("Licensing backend returned an invalid inference response")
            ai.settle(
                connect,
                reservation,
                result.get("usage"),
                policy,
                True,
                actual_cost=result.get("cost_usd_exact", result["cost_usd"]),
            )
        except ValueError as exc:
            if reservation:
                ai.settle(connect, reservation, None, policy, False)
            raise HTTPException(402, str(exc)) from None
        with connect() as db:
            db.executemany(
                "INSERT INTO messages(role,content,provider) VALUES(?,?,?)",
                [
                    ("user", request.message, "INCLUDED"),
                    ("assistant", result["answer"], "INCLUDED"),
                ],
            )
            store.audit(db, "included_chat_completed", result["model"])
        return {
            "answer": result["answer"],
            "provider": "CLOUD_ONLY · included credits",
            "cost_usd": result["cost_usd"],
        }
    model = models.cloud_model if cloud else local_model
    try:
        key = credentials.cloud_key() if cloud else None
    except Exception:  # noqa: BLE001 -- Native credential backends must not leak secret-bearing errors.
        raise HTTPException(503, "Credential store unavailable") from None
    if cloud and (not key or not model):
        raise HTTPException(
            503, "Configure cloud API key and model in AI settings"
        )
    try:
        base = ai.cloud_base(models.cloud_url) if cloud else hardware.ollama_base()
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from None
    reservation = None
    if cloud:
        try:
            reservation, _ = ai.reserve(
                connect, model, request, policy, employee_instructions
            )
        except ValueError as exc:
            raise HTTPException(402, str(exc)) from None
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": request.message}],
        "stream": False,
    }
    if employee_instructions:
        payload["messages"].insert(
            0, {"role": "system", "content": employee_instructions}
        )
    if cloud:
        payload["max_tokens"] = policy.max_output_tokens
    else:
        payload["options"] = {"num_predict": policy.max_output_tokens}
    headers = {"Authorization": f"Bearer {key}"} if cloud else {}
    try:
        with httpx.Client(
            timeout=90, follow_redirects=False, trust_env=cloud
        ) as client:
            response = client.post(
                base + ("/chat/completions" if cloud else "/api/chat"),
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            answer = (
                data["choices"][0]["message"]["content"]
                if cloud
                else data["message"]["content"]
            )
            if not isinstance(answer, str) or not answer.strip():
                raise ValueError("Empty answer")
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        if reservation:
            ai.settle(connect, reservation, None, policy, False)
        raise HTTPException(
            502,
            "AI provider unavailable or returned an invalid response; no automatic fallback was attempted",
        ) from None
    if reservation:
        try:
            ai.settle(connect, reservation, data.get("usage"), policy, True)
        except ValueError as exc:
            raise HTTPException(402, str(exc)) from None
    with connect() as db:
        db.executemany(
            "INSERT INTO messages(role,content,provider) VALUES(?,?,?)",
            [("user", request.message, selected), ("assistant", answer, selected)],
        )
        store.audit(db, "chat_completed", selected)
    return {"answer": answer, "provider": selected, "usage_id": reservation}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.post("/ai/estimate", dependencies=[Depends(authorize)])
def estimate_chat(request: ai.Chat):
    if licensing.local_preview() and request.mode != "LOCAL_ONLY":
        raise HTTPException(403, "Local preview only supports LOCAL_ONLY with your local Ollama")
    with connect() as db:
        policy = ai.Policy(**store.get(db, "ai_policy", {}))
        measured = store.get(db, "benchmark")
    try:
        selected = ai.select(
            request, policy, measured, model_settings.load(connect).local_model
        )
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None
    system_text = ""
    if request.employee_id:
        try:
            with connect() as db:
                employee = workforce.check(db, request.employee_id, "ai.chat", {})
                system_text = f"Role: {employee.role}\n{employee.instructions}"
        except ValueError as exc:
            raise HTTPException(403, str(exc)) from None
    if selected == "CLOUD_ONLY" and policy.billing_source == "INCLUDED":
        import uuid

        try:
            quote = licensing.remote(
                "/inference/estimate",
                {
                    "device_id": licensing.device_id(),
                    "request_id": uuid.uuid4().hex,
                    "message": request.message,
                    "system_text": system_text,
                    "cloud_consent": request.cloud_consent,
                },
            )
            return {
                "provider": selected,
                "estimated_max_cost_usd": quote["estimated_cost_usd"],
                "pricing_confirmed": True,
                "note": "Trusted gateway quote, not a provider invoice",
            }
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    return {
        "provider": selected,
        "estimated_max_cost_usd": ai.estimate(request, policy, system_text)
        if selected == "CLOUD_ONLY"
        else 0,
        "pricing_confirmed": policy.pricing_confirmed,
        "note": "Conservative reservation, not a provider invoice. Failed cloud calls retain the reservation when billing is unknown.",
    }


# Business tasks and restricted files are explicitly invoked, never parsed from model output.


class TaskRequest(BaseModel):
    tool: str = Field(max_length=60)
    payload: dict
    employee_id: str | None = Field(default=None, max_length=80)


@app.post("/tasks", dependencies=[Depends(authorize)], status_code=201)
def create_task(request: TaskRequest):
    if request.tool == "connector.write":
        raise HTTPException(
            403, "Create writes through the connector permissions endpoint"
        )
    try:
        identifier, status = tasks.create(
            connect, request.tool, request.payload, request.employee_id
        )
    except ValueError:
        raise HTTPException(422, "Invalid task, input or queue state") from None
    if status == "queued":
        path = DB
        tasks.schedule(lambda: store.open_db(path), path, identifier)
    return {"id": identifier, "status": status}


@app.get("/tasks", dependencies=[Depends(authorize)])
def task_history(employee_id: str | None = None):
    with connect() as db:
        rows = db.execute(
            "SELECT t.*, a.employee_id FROM tasks t LEFT JOIN assignments a ON a.task_id=t.id WHERE (? IS NULL OR a.employee_id=?) ORDER BY t.rowid DESC LIMIT 100",
            (employee_id, employee_id),
        ).fetchall()
    return [
        {
            **dict(row),
            "payload": json.loads(row["payload"]),
            "result": json.loads(row["result"]) if row["result"] else None,
        }
        for row in rows
    ]


@app.post("/tasks/{identifier}/approve", dependencies=[Depends(authorize)])
def approve_task(identifier: str):
    try:
        tasks.approve(connect, identifier)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    path = DB
    tasks.schedule(lambda: store.open_db(path), path, identifier)
    return {"id": identifier, "status": "queued"}


@app.post("/tasks/{identifier}/cancel", dependencies=[Depends(authorize)])
def cancel_task(identifier: str):
    try:
        tasks.cancel(connect, identifier)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return {"id": identifier, "cancel_requested": True}


@app.post("/control/stop", dependencies=[Depends(authorize)])
def emergency_stop():
    tasks.stop(connect)
    return {
        "stopped": True,
        "note": "New work blocked; cancellation is cooperative. Already dispatched provider calls or external writes cannot be recalled.",
    }


@app.post("/control/resume", dependencies=[Depends(authorize)])
def resume():
    with connect() as db:
        store.put(db, "emergency_stop", False)
        store.audit(db, "emergency_resume", "all_tasks")
    return {"stopped": False}


@app.get("/control", dependencies=[Depends(authorize)])
def control():
    with connect() as db:
        return {"stopped": store.get(db, "emergency_stop", False)}


@app.get("/audit", dependencies=[Depends(authorize)])
def audit_log():
    with connect() as db:
        return [
            dict(row)
            for row in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
        ]


@app.get("/files", dependencies=[Depends(authorize)])
def list_files():
    with connect() as db:
        return [
            dict(row)
            for row in db.execute("SELECT * FROM files ORDER BY rowid DESC LIMIT 100")
        ]


@app.post("/files", dependencies=[Depends(authorize)], status_code=201)
async def upload_file(request: Request, filename: str):
    with connect() as db:
        if store.get(db, "emergency_stop", False):
            raise HTTPException(409, "Emergency stop is active")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > files.MAX_BYTES:
            raise HTTPException(413, "Maximum upload size is 10 MiB")
    try:
        return files.save(connect, DB, filename, bytes(data))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/files/{identifier}", dependencies=[Depends(authorize)])
def download_file(identifier: str):
    try:
        path, metadata = files.locate(connect, DB, identifier)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None
    return FileResponse(
        path,
        filename=metadata["name"],
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.get("/connectors", dependencies=[Depends(authorize)])
def connector_registry():
    return [connectors.public(config) for config in connectors.list_configs(connect)]


@app.put("/connectors", dependencies=[Depends(authorize)])
def configure_connector(config: connectors.Connector):
    try:
        connectors.save(connect, config)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return connectors.public(config.model_dump())


@app.post("/connectors/{identifier}/test", dependencies=[Depends(authorize)])
def test_connector(identifier: str):
    with connect() as db:
        if store.get(db, "emergency_stop", False):
            raise HTTPException(409, "Emergency stop is active")
    try:
        result = connectors.read(connect, identifier)
        with connect() as db:
            store.audit(db, "connector_test_passed", identifier, "read endpoint only")
        return {
            "connected": True,
            "mock": result["mock"],
            "scope": "Configured read endpoint only; no vendor certification or write verification",
        }
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/connectors/{identifier}/records", dependencies=[Depends(authorize)])
def read_connector(identifier: str):
    with connect() as db:
        if store.get(db, "emergency_stop", False):
            raise HTTPException(409, "Emergency stop is active")
    try:
        return connectors.read(connect, identifier)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post(
    "/connectors/{identifier}/writes",
    dependencies=[Depends(authorize)],
    status_code=201,
)
def request_connector_write(identifier: str, request: connectors.Write):
    try:
        payload = connectors.prepare_write(connect, identifier, request)
        task_id, status = tasks.create(connect, "connector.write", payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {
        "id": task_id,
        "status": status,
        "note": "Review and approve the exact task in Business tools before execution",
    }


@app.get("/plans", dependencies=[Depends(authorize)])
def plans():
    with connect() as db:
        config = store.get(db, "plans", connectors.PLANS)
    return {
        "plans": config,
        "integration_categories": connectors.CATEGORIES,
        "all_connectors_in_every_plan": True,
        "billing": "mock; local settings are not proof of payment",
    }


class PlanPrice(BaseModel):
    monthly_myr: int = Field(ge=0, le=1000000)
    employees: int = Field(ge=1, le=10000)
    computers: int = Field(ge=1, le=10000)
    ai_mode: str = Field(pattern="^(LOCAL_ONLY|CLOUD_ONLY|HYBRID)$")


class Plans(BaseModel):
    Starter: PlanPrice
    Business: PlanPrice
    Enterprise: PlanPrice


@app.put("/plans", dependencies=[Depends(authorize)])
def update_plans(config: Plans):
    with connect() as db:
        store.put(db, "plans", config.model_dump())
        store.audit(db, "mock_plans_updated", "all_plans")
    return plans()


from backend import automation


@app.get("/automation/policy", dependencies=[Depends(authorize)])
def automation_policy():
    return automation.policy(connect)


@app.put("/automation/policy", dependencies=[Depends(authorize)])
def save_automation_policy(policy: automation.AutomationPolicy):
    with connect() as db:
        store.put(db, "automation_policy", policy.model_dump())
        store.audit(db, "automation_policy_updated", "automation")
    return policy


from backend import workforce


@app.get("/employees", dependencies=[Depends(authorize)])
def employees():
    with connect() as db:
        return [
            {"id": row["id"], **json.loads(row["config"])}
            for row in db.execute("SELECT * FROM employees ORDER BY created_at,id")
        ]


@app.post("/employees", dependencies=[Depends(authorize)], status_code=201)
def new_employee(employee: workforce.Employee):
    try:
        return workforce.save(connect, employee)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.put("/employees/{identifier}", dependencies=[Depends(authorize)])
def edit_employee(identifier: str, employee: workforce.Employee):
    try:
        with connect() as db:
            workforce.get(db, identifier)
        return workforce.save(connect, employee, identifier)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post(
    "/employees/{identifier}/connector-writes/{connector_id}",
    dependencies=[Depends(authorize)],
    status_code=201,
)
def employee_write(identifier: str, connector_id: str, request: connectors.Write):
    try:
        payload = connectors.prepare_write(connect, connector_id, request)
        task_id, status = tasks.create(connect, "connector.write", payload, identifier)
        return {"id": task_id, "status": status}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None




@app.get("/license", dependencies=[Depends(authorize)])
def license_status():
    try:
        return {
            "required": licensing.required(),
            "device_id": licensing.device_id(),
            "claims": licensing.enforce(connect),
            "valid": licensing.required(),
        }
    except ValueError as exc:
        return {
            "required": True,
            "device_id": licensing.device_id(),
            "valid": False,
            "error": str(exc),
        }


@app.post("/license/activate", dependencies=[Depends(authorize)])
def activate_license():
    try:
        return licensing.activate(connect)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.put("/license/account-key", dependencies=[Depends(authorize)])
def license_account_key(request: KeyRequest):
    try:
        credentials.native_vault().set_password(
            "NightBrew", "license-account-key", request.key.get_secret_value()
        )
        return {"stored": True, "storage": "OS native credential vault"}
    except Exception:  # noqa: BLE001 -- Sanitize native credential backend failures.
        raise HTTPException(
            503, "Use the backend account-key environment binding on Linux"
        ) from None


@app.get("/billing/account", dependencies=[Depends(authorize)])
def billing_account():
    try:
        return licensing.remote("/account")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/billing/catalog", dependencies=[Depends(authorize)])
def billing_catalog():
    try:
        return licensing.remote("/catalog")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


class Purchase(BaseModel):
    sku: str = Field(
        pattern="^(Starter|Business|Enterprise|credits|computer|setup|custom_connector)$"
    )


@app.post("/billing/checkout", dependencies=[Depends(authorize)])
def billing_checkout(request: Purchase):
    try:
        return licensing.remote("/checkout", request.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/marketplace", dependencies=[Depends(authorize)])
def marketplace():
    return {
        "all_plans": True,
        "installation": "No arbitrary plugin code is downloaded or executed",
        "entries": [
            {
                "id": "generic-rest",
                "name": "Generic REST",
                "categories": list(connectors.CATEGORIES),
                "vendor_verified": False,
                "custom_development": "Separate quotation",
            }
        ]
        + [
            {
                "id": "mock-" + category.lower(),
                "name": "Mock " + category,
                "development_only": True,
                "vendor_verified": False,
            }
            for category in connectors.CATEGORIES
            if category != "API"
        ],
    }


@app.post("/billing/portal", dependencies=[Depends(authorize)])
def customer_portal():
    try:
        return licensing.remote("/portal", {})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/session", dependencies=[Depends(authorize)])
def managed_session():
    return {
        "instance_id": os.getenv("NIGHTBREW_INSTANCE_ID", "manual-session"),
        "version": app.version,
    }
