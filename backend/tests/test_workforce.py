import pytest

from backend import ai, store, workforce
from backend.tests.test_app import AUTH
from backend.tests.test_documents import PAYLOAD, wait


def create_employee(client, **changes):
    response = client.post(
        "/employees",
        headers=AUTH,
        json={
            "name": "Finance AI",
            "role": "Finance",
            "instructions": "Check decimal totals",
            "tools": ["document.generate"],
            **changes,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_employee_assigned_job_and_history(client):
    employee = create_employee(client)
    task = client.post(
        "/tasks",
        headers=AUTH,
        json={
            "tool": "document.generate",
            "payload": PAYLOAD,
            "employee_id": employee["id"],
        },
    ).json()
    assert task["status"] == "pending_approval"
    client.post("/tasks/" + task["id"] + "/approve", headers=AUTH)
    assert wait(client, task["id"])["status"] == "completed"
    history = client.get("/tasks?employee_id=" + employee["id"], headers=AUTH).json()
    assert len(history) == 1 and history[0]["employee_id"] == employee["id"]


def test_employee_permission_revocation_and_task_quota(client):
    employee = create_employee(client, monthly_task_limit=1)
    payload = {
        "tool": "document.generate",
        "payload": PAYLOAD,
        "employee_id": employee["id"],
    }
    first = client.post("/tasks", headers=AUTH, json=payload).json()
    assert client.post("/tasks", headers=AUTH, json=payload).status_code == 422
    updated = {key: value for key, value in employee.items() if key != "id"}
    updated["active"] = False
    client.put("/employees/" + employee["id"], headers=AUTH, json=updated)
    client.post("/tasks/" + first["id"] + "/approve", headers=AUTH)
    assert wait(client, first["id"])["status"] == "failed"


def test_employee_connector_permissions_do_not_inherit_admin(client):
    employee = create_employee(client, tools=["connector.read"], connectors={})
    assert (
        client.post(
            "/tasks",
            headers=AUTH,
            json={
                "tool": "connector.read",
                "payload": {"connector_id": "mock-wms"},
                "employee_id": employee["id"],
            },
        ).status_code
        == 422
    )
    updated = {key: value for key, value in employee.items() if key != "id"}
    updated["connectors"] = {"mock-wms": ["read"]}
    client.put("/employees/" + employee["id"], headers=AUTH, json=updated)
    task = client.post(
        "/tasks",
        headers=AUTH,
        json={
            "tool": "connector.read",
            "payload": {"connector_id": "mock-wms"},
            "employee_id": employee["id"],
        },
    ).json()
    client.post("/tasks/" + task["id"] + "/approve", headers=AUTH)
    assert wait(client, task["id"])["result"]["mock"] is True
    assert (
        client.post(
            "/employees/" + employee["id"] + "/connector-writes/mock-wms",
            headers=AUTH,
            json={"record": {"id": "blocked"}},
        ).status_code
        == 422
    )


def test_employee_spending_is_separate_from_company_balance(tmp_path):
    connect = lambda: store.open_db(tmp_path / "usage.db")
    employee = workforce.save(
        connect,
        workforce.Employee(
            name="Sales",
            role="Sales",
            tools=["ai.chat"],
            monthly_spending_limit_usd=0.001,
        ),
    )
    policy = ai.Policy(
        cloud_allowed=True,
        pricing_confirmed=True,
        credit_balance_usd=10,
        input_usd_per_million=100,
    )
    with connect() as db:
        store.put(db, "ai_policy", policy.model_dump())
    with pytest.raises(ValueError, match="Employee spending"):
        ai.reserve(
            connect,
            "model",
            ai.Chat(message="hello", employee_id=employee["id"]),
            policy,
        )


def test_employee_instructions_reach_local_chat(client, monkeypatch):
    import httpx

    from backend import app as service

    employee = create_employee(
        client, tools=["ai.chat"], instructions="Use exact decimal totals."
    )

    class Provider:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            assert kwargs["json"]["messages"][0] == {
                "role": "system",
                "content": "Role: Finance\nUse exact decimal totals.",
            }
            return httpx.Response(
                200,
                json={"message": {"content": "Instructions applied"}},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(service.httpx, "Client", Provider)
    result = client.post(
        "/chat",
        headers=AUTH,
        json={"message": "Prepare totals", "employee_id": employee["id"]},
    )
    assert result.json()["answer"] == "Instructions applied"
