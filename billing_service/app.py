"""Deploy separately. Holds payment/provider secrets and the signing key; never bundle with desktop."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Annotated

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

app = FastAPI(title="NightBrew trusted billing authority", version="0.8.0")
DB = Path(os.getenv("NIGHTBREW_BILLING_DB", "/tmp/nightbrew-billing.sqlite3"))
PLAN_DEFAULTS = {
    "Starter": {
        "monthly_myr": 299,
        "employees": 2,
        "devices": 1,
        "monthly_tasks": 1000,
        "included_credits_usd": 0,
    },
    "Business": {
        "monthly_myr": 599,
        "employees": 5,
        "devices": 1,
        "monthly_tasks": 5000,
        "included_credits_usd": 10,
    },
    "Enterprise": {
        "monthly_myr": 1499,
        "employees": 10,
        "devices": 10,
        "monthly_tasks": 20000,
        "included_credits_usd": 50,
    },
}


def db():
    DB.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(DB, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.executescript("""
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, key_hash TEXT UNIQUE, plan TEXT, active INTEGER, expires INTEGER, customer TEXT, credits REAL DEFAULT 0, extra_devices INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS devices(account TEXT, device TEXT, PRIMARY KEY(account,device));
    CREATE TABLE IF NOT EXISTS employees(account TEXT, employee TEXT, active INTEGER, PRIMARY KEY(account,employee));
    CREATE TABLE IF NOT EXISTS operations(account TEXT, id TEXT, month TEXT, PRIMARY KEY(account,id));
    CREATE TABLE IF NOT EXISTS checkout(id TEXT PRIMARY KEY, account TEXT, sku TEXT, fulfilled INTEGER DEFAULT 0, subscription TEXT, payment_intent TEXT);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created INTEGER);
    CREATE TABLE IF NOT EXISTS inference(account TEXT,id TEXT,charged REAL,status TEXT,month TEXT,created INTEGER,PRIMARY KEY(account,id));
    """)
    return connection


def catalog():
    # Server deployment configuration, never desktop-controlled pricing/entitlements.
    configured = json.loads(
        os.getenv("NIGHTBREW_BILLING_PLANS_JSON", json.dumps(PLAN_DEFAULTS))
    )
    if set(configured) != set(PLAN_DEFAULTS):
        raise ValueError("Configure exactly three plans")
    try:
        return {
            name: AuthorityPlan(**values).model_dump()
            for name, values in configured.items()
        }
    except ValueError:
        raise HTTPException(503, "Invalid authority plan configuration") from None


def mode():
    return os.getenv("NIGHTBREW_BILLING_MODE", "mock")


def account(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Account authentication required")
    digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
    with db() as connection:
        row = connection.execute(
            "SELECT * FROM accounts WHERE key_hash=?", (digest,)
        ).fetchone()
    if not row:
        raise HTTPException(401, "Account authentication required")
    return dict(row)


Account = Annotated[dict, Depends(account)]


def admin(authorization: str | None = Header(default=None)):
    key = os.getenv("NIGHTBREW_BILLING_ADMIN_KEY")
    if (
        not key
        or not authorization
        or not secrets.compare_digest(
            authorization.encode(), ("Bearer " + key).encode()
        )
    ):
        raise HTTPException(401, "Authority administrator authentication required")


def active(row):
    if not row["active"] or row["expires"] <= int(time.time()):
        raise HTTPException(403, "Subscription inactive or expired")


def active_device(connection, row, device):
    current = connection.execute(
        "SELECT * FROM accounts WHERE id=?", (row["id"],)
    ).fetchone()
    row.update(dict(current))
    active(row)
    if not connection.execute(
        "SELECT 1 FROM devices WHERE account=? AND device=?", (row["id"], device)
    ).fetchone():
        raise HTTPException(403, "Device not activated")


def sign(data):
    try:
        private = base64.urlsafe_b64decode(
            os.environ["NIGHTBREW_LICENSE_PRIVATE_KEY"] + "==="
        )
        key = Ed25519PrivateKey.from_private_bytes(private)
    except (KeyError, ValueError):
        raise HTTPException(503, "Authority signing key is not configured") from None
    encoded = base64.urlsafe_b64encode(
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    ).rstrip(b"=")
    return (
        encoded.decode()
        + "."
        + base64.urlsafe_b64encode(key.sign(encoded)).rstrip(b"=").decode()
    )


class NewAccount(BaseModel):
    plan: str = Field(pattern="^(Starter|Business|Enterprise)$")


@app.post("/admin/accounts", dependencies=[Depends(admin)], status_code=201)
def create_account(request: NewAccount):
    identifier = uuid.uuid4().hex
    key = secrets.token_urlsafe(32)
    with db() as connection:
        connection.execute(
            "INSERT INTO accounts(id,key_hash,plan,active,expires) VALUES(?,?,?,?,?)",
            (identifier, hashlib.sha256(key.encode()).hexdigest(), request.plan, 0, 0),
        )
    return {
        "account_id": identifier,
        "account_key": key,
        "note": "Return once to the authorized customer through a secure channel; never log this key",
    }


@app.get("/catalog")
def products():
    return {
        "environment": mode(),
        "plans": catalog(),
        "addons": ["credits", "computer", "setup", "custom_connector"],
        "all_connector_categories_in_every_plan": True,
    }


@app.get("/account")
def account_status(row: Account):
    return {key: value for key, value in row.items() if key != "key_hash"}


class Activation(BaseModel):
    device_id: str = Field(pattern=r"^[a-f0-9]{64}$")


@app.post("/activate")
def activate(request: Activation, row: Account):
    active(row)
    plan = catalog()[row["plan"]]
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT 1 FROM devices WHERE account=? AND device=?",
            (row["id"], request.device_id),
        ).fetchone()
        count = connection.execute(
            "SELECT COUNT(*) FROM devices WHERE account=?", (row["id"],)
        ).fetchone()[0]
        if not existing and count >= plan["devices"] + row["extra_devices"]:
            raise HTTPException(403, "Computer allowance exceeded")
        connection.execute(
            "INSERT OR IGNORE INTO devices VALUES(?,?)", (row["id"], request.device_id)
        )
    now = int(time.time())
    claims = {
        "iss": "nightbrew-license-authority",
        "aud": "nightbrew-desktop",
        "version": 1,
        "environment": mode(),
        "account_id": row["id"],
        "device_id": request.device_id,
        "plan": row["plan"],
        "employee_limit": plan["employees"],
        "monthly_tasks": plan["monthly_tasks"],
        "nbf": now - 5,
        "exp": min(row["expires"], now + 86400),
    }
    return {"grant": sign(claims)}


class Reservation(Activation):
    operation_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    employee_id: str | None = Field(default=None, max_length=80)


@app.post("/quota/reserve")
def quota(request: Reservation, row: Account):
    month = time.strftime("%Y-%m", time.gmtime())
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        active_device(connection, row, request.device_id)
        if connection.execute(
            "SELECT 1 FROM operations WHERE account=? AND id=?",
            (row["id"], request.operation_id),
        ).fetchone():
            return {"reserved": True, "duplicate": True}
        if (
            request.employee_id
            and not connection.execute(
                "SELECT 1 FROM employees WHERE account=? AND employee=? AND active=1",
                (row["id"], request.employee_id),
            ).fetchone()
        ):
            raise HTTPException(403, "Employee seat not registered")
        count = connection.execute(
            "SELECT COUNT(*) FROM operations WHERE account=? AND month=?",
            (row["id"], month),
        ).fetchone()[0]
        if count >= catalog()[row["plan"]]["monthly_tasks"]:
            raise HTTPException(403, "Monthly task quota exceeded")
        connection.execute(
            "INSERT INTO operations VALUES(?,?,?)",
            (row["id"], request.operation_id, month),
        )
    return {"reserved": True}


class Seat(Activation):
    employee_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    active: bool = True


@app.post("/employees/register")
def employee(request: Seat, row: Account):
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        active_device(connection, row, request.device_id)
        current = connection.execute(
            "SELECT active FROM employees WHERE account=? AND employee=?",
            (row["id"], request.employee_id),
        ).fetchone()
        count = connection.execute(
            "SELECT COUNT(*) FROM employees WHERE account=? AND active=1", (row["id"],)
        ).fetchone()[0]
        if (
            request.active
            and (not current or not current["active"])
            and count >= catalog()[row["plan"]]["employees"]
        ):
            raise HTTPException(403, "Employee allowance exceeded")
        connection.execute(
            "INSERT INTO employees VALUES(?,?,?) ON CONFLICT(account,employee) DO UPDATE SET active=excluded.active",
            (row["id"], request.employee_id, request.active),
        )
    return {"registered": True}


class Checkout(BaseModel):
    sku: str = Field(
        pattern=r"^(Starter|Business|Enterprise|credits|computer|setup|custom_connector)$"
    )


def stripe_request(method, path, data=None):
    key = os.getenv("NIGHTBREW_STRIPE_SECRET_KEY")
    if not key:
        raise HTTPException(503, "Stripe merchant configuration missing")
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        response = client.request(
            method,
            "https://api.stripe.com/v1" + path,
            data=data,
            headers={"Authorization": "Bearer " + key},
        )
    if response.status_code >= 300:
        raise HTTPException(502, "Payment provider rejected request")
    return response.json()


@app.post("/checkout")
def checkout(request: Checkout, row: Account):
    if mode() == "mock":
        identifier = "mock_" + uuid.uuid4().hex
        url = None
    else:
        if row["active"] and request.sku in catalog():
            raise HTTPException(
                409, "Use the billing portal to change an existing subscription"
            )
        price = os.getenv("NIGHTBREW_STRIPE_PRICE_" + request.sku.upper())
        success = os.getenv("NIGHTBREW_CHECKOUT_SUCCESS_URL", "")
        cancel = os.getenv("NIGHTBREW_CHECKOUT_CANCEL_URL", "")
        if (
            not price
            or not success.startswith("https://")
            or not cancel.startswith("https://")
        ):
            raise HTTPException(
                503, "Configure price IDs and HTTPS checkout return URLs"
            )
        session = stripe_request(
            "POST",
            "/checkout/sessions",
            {
                "mode": "subscription" if request.sku in catalog() else "payment",
                "line_items[0][price]": price,
                "line_items[0][quantity]": "1",
                "success_url": success,
                "cancel_url": cancel,
                "client_reference_id": row["id"],
            },
        )
        identifier = session["id"]
        url = session["url"]
    with db() as connection:
        connection.execute(
            "INSERT INTO checkout(id,account,sku) VALUES(?,?,?)",
            (identifier, row["id"], request.sku),
        )
    return {"id": identifier, "url": url, "environment": mode(), "paid": False}


def fulfill(connection, session_id, subscription=None, payment_intent=None):
    purchase = connection.execute(
        "SELECT * FROM checkout WHERE id=?", (session_id,)
    ).fetchone()
    if not purchase:
        raise HTTPException(400, "Unknown checkout session")
    if purchase["fulfilled"]:
        return
    sku = purchase["sku"]
    account_id = purchase["account"]
    if sku in catalog():
        plan = catalog()[sku]
        expiry = int(time.time()) + 31 * 86400
        is_active = True
        credits = plan["included_credits_usd"]
        if mode() == "stripe":
            if not subscription:
                raise HTTPException(400, "Subscription missing")
            current = stripe_request("GET", "/subscriptions/" + subscription)
            expiry = current.get("current_period_end") or max(
                (
                    item.get("current_period_end", 0)
                    for item in current.get("items", {}).get("data", [])
                ),
                default=0,
            )
            is_active = current.get("status") in ("active", "trialing")
            credits = 0
        connection.execute(
            "UPDATE accounts SET plan=?,active=?,expires=?,credits=credits+? WHERE id=?",
            (sku, is_active, expiry, credits, account_id),
        )
    elif sku == "credits":
        connection.execute(
            "UPDATE accounts SET credits=credits+? WHERE id=?",
            (float(os.getenv("NIGHTBREW_CREDIT_PACK_USD", "10")), account_id),
        )
    elif sku == "computer":
        connection.execute(
            "UPDATE accounts SET extra_devices=extra_devices+1 WHERE id=?",
            (account_id,),
        )
    # Setup/custom development fees are recorded, never interpreted as a software entitlement.
    connection.execute(
        "UPDATE checkout SET fulfilled=1,subscription=?,payment_intent=? WHERE id=?",
        (subscription, payment_intent, session_id),
    )


class MockPayment(BaseModel):
    checkout_id: str = Field(max_length=100)


@app.post("/mock/confirm", dependencies=[Depends(admin)])
def mock_confirm(request: MockPayment):
    if mode() != "mock":
        raise HTTPException(404, "Mock billing disabled")
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        fulfill(connection, request.checkout_id)
    return {"fulfilled": True, "environment": "mock", "real_payment": False}


@app.post("/stripe/webhook")
async def webhook(request: Request):
    if mode() != "stripe":
        raise HTTPException(404, "Stripe billing disabled")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 1024 * 1024:
            raise HTTPException(413, "Webhook too large")
    payload = bytes(raw)
    secret = os.getenv("NIGHTBREW_STRIPE_WEBHOOK_SECRET", "")
    header = request.headers.get("stripe-signature", "")
    try:
        pieces = {}
        for piece in header.split(","):
            key, value = piece.split("=", 1)
            pieces.setdefault(key, []).append(value)
        timestamp = int(pieces["t"][0])
        expected = hmac.new(
            secret.encode(), str(timestamp).encode() + b"." + payload, hashlib.sha256
        ).hexdigest()
        if (
            not secret
            or abs(time.time() - timestamp) > 300
            or not any(hmac.compare_digest(expected, item) for item in pieces["v1"])
        ):
            raise ValueError()
        event = json.loads(payload)
    except (ValueError, KeyError):
        raise HTTPException(400, "Invalid webhook signature") from None
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM events WHERE id=?", (event["id"],)
        ).fetchone():
            return {"received": True, "duplicate": True}
        obj = event["data"]["object"]
        kind = event["type"]
        if kind == "checkout.session.completed" and obj.get("payment_status") == "paid":
            fulfill(
                connection,
                obj["id"],
                obj.get("subscription"),
                obj.get("payment_intent"),
            )
            purchase = connection.execute(
                "SELECT account FROM checkout WHERE id=?", (obj["id"],)
            ).fetchone()
            if obj.get("customer"):
                connection.execute(
                    "UPDATE accounts SET customer=? WHERE id=?",
                    (obj["customer"], purchase["account"]),
                )
        elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
            purchase = connection.execute(
                "SELECT * FROM checkout WHERE subscription=?", (obj["id"],)
            ).fetchone()
            if purchase:
                # Query canonical provider state; out-of-order events cannot resurrect a cancelled subscription.
                current = stripe_request("GET", "/subscriptions/" + obj["id"])
                periods = [
                    item.get("current_period_end", 0)
                    for item in current.get("items", {}).get("data", [])
                ]
                expiry = current.get("current_period_end") or max(periods, default=0)
                connection.execute(
                    "UPDATE accounts SET active=?,expires=? WHERE id=?",
                    (
                        current.get("status") in ("active", "trialing"),
                        expiry,
                        purchase["account"],
                    ),
                )
        elif kind == "charge.refunded":
            purchase = connection.execute(
                "SELECT * FROM checkout WHERE payment_intent=?",
                (obj.get("payment_intent"),),
            ).fetchone()
            if purchase:
                connection.execute(
                    "UPDATE accounts SET active=0 WHERE id=?", (purchase["account"],)
                )
        elif kind == "invoice.paid":
            subscription = obj.get("subscription") or obj.get("parent", {}).get(
                "subscription_details", {}
            ).get("subscription")
            purchase = connection.execute(
                "SELECT * FROM checkout WHERE subscription=?", (subscription,)
            ).fetchone()
            if not purchase:
                raise HTTPException(
                    503, "Subscription checkout not reconciled yet; retry event"
                )
            if purchase:
                current = stripe_request("GET", "/subscriptions/" + subscription)
                periods = [
                    item.get("current_period_end", 0)
                    for item in current.get("items", {}).get("data", [])
                ]
                expiry = current.get("current_period_end") or max(periods, default=0)
                # Each provider event is idempotent. Invoice ID additionally protects multiple event IDs for one invoice.
                invoice_key = "invoice:" + obj["id"]
                if not connection.execute(
                    "SELECT 1 FROM events WHERE id=?", (invoice_key,)
                ).fetchone():
                    connection.execute(
                        "UPDATE accounts SET active=?,expires=?,credits=credits+? WHERE id=?",
                        (
                            current.get("status") in ("active", "trialing"),
                            expiry,
                            catalog()[purchase["sku"]]["included_credits_usd"],
                            purchase["account"],
                        ),
                    )
                    connection.execute(
                        "INSERT INTO events VALUES(?,?)",
                        (invoice_key, int(time.time())),
                    )
        connection.execute(
            "INSERT INTO events VALUES(?,?)", (event["id"], int(time.time()))
        )
    return {"received": True}


class Inference(Activation):
    request_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    message: str = Field(min_length=1, max_length=32000)
    system_text: str = Field(default="", max_length=5000)
    cloud_consent: bool = False


@app.post("/inference")
def inference(request: Inference, row: Account):
    if not request.cloud_consent:
        raise HTTPException(403, "Cloud consent required")
    key = os.getenv("NIGHTBREW_GATEWAY_API_KEY")
    model = os.getenv("NIGHTBREW_GATEWAY_MODEL")
    base = os.getenv("NIGHTBREW_GATEWAY_URL", "https://api.openai.com/v1").rstrip("/")
    if not key or not model or not base.startswith("https://"):
        raise HTTPException(503, "Inference provider not configured")
    # Prices are authority-controlled, never accepted from the desktop.
    input_price, output_price = gateway_prices()
    maximum = 512
    estimated = (
        (len(request.message.encode()) + len(request.system_text.encode()) + 256)
        * input_price
        + maximum * output_price
    ) / 1e6
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        active_device(connection, row, request.device_id)
        current = connection.execute(
            "SELECT credits FROM accounts WHERE id=?", (row["id"],)
        ).fetchone()[0]
        if connection.execute(
            "SELECT 1 FROM inference WHERE account=? AND id=?",
            (row["id"], request.request_id),
        ).fetchone():
            raise HTTPException(
                409, "Inference request already consumed; no automatic replay"
            )
        month = time.strftime("%Y-%m", time.gmtime())
        count = connection.execute(
            "SELECT COUNT(*) FROM inference WHERE account=? AND month=?",
            (row["id"], month),
        ).fetchone()[0]
        if count >= catalog()[row["plan"]]["monthly_tasks"]:
            raise HTTPException(403, "Monthly inference quota exceeded")
        recent = connection.execute(
            "SELECT COUNT(*) FROM inference WHERE account=? AND created>?",
            (row["id"], int(time.time()) - 60),
        ).fetchone()[0]
        if recent >= 30:
            raise HTTPException(429, "Inference rate limit exceeded")
        if estimated > current:
            raise HTTPException(402, "Included credit balance exceeded")
        connection.execute(
            "UPDATE accounts SET credits=credits-? WHERE id=?", (estimated, row["id"])
        )
        connection.execute(
            "INSERT INTO inference VALUES(?,?,?,?,?,?)",
            (
                row["id"],
                request.request_id,
                estimated,
                "reserved",
                month,
                int(time.time()),
            ),
        )
    messages = [
        {"role": "system", "content": request.system_text},
        {"role": "user", "content": request.message},
    ]
    try:
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            response = client.post(
                base + "/chat/completions",
                headers={"Authorization": "Bearer " + key},
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": maximum,
                    "stream": False,
                },
            )
            response.raise_for_status()
            data = response.json()
            answer = data["choices"][0]["message"]["content"]
            if not isinstance(answer, str) or not answer:
                raise ValueError()
        usage = data.get("usage", {})
        ins = usage.get("prompt_tokens")
        outs = usage.get("completion_tokens")
        cost = (
            (ins * input_price + outs * output_price) / 1e6
            if type(ins) is int and type(outs) is int and ins >= 0 and outs >= 0
            else estimated
        )
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "UPDATE accounts SET credits=MAX(0,credits+?) WHERE id=?",
                (estimated - cost, row["id"]),
            )
            connection.execute(
                "UPDATE inference SET charged=?,status=? WHERE account=? AND id=?",
                (cost, "completed", row["id"], request.request_id),
            )
        return {"answer": answer, "usage": usage, "cost_usd": cost, "model": model}
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        with db() as connection:
            connection.execute(
                "UPDATE inference SET status='unknown_billed' WHERE account=? AND id=?",
                (row["id"], request.request_id),
            )
        raise HTTPException(
            502,
            "Provider outcome unknown; reservation retained, do not automatically retry",
        ) from None


def gateway_prices():
    import math

    try:
        prices = [
            float(os.environ[name])
            for name in (
                "NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION",
                "NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION",
            )
        ]
        if any(
            not math.isfinite(price) or price < 0 or price > 10000 for price in prices
        ):
            raise ValueError()
        return prices
    except (KeyError, ValueError):
        raise HTTPException(503, "Configure valid gateway model prices") from None


@app.post("/inference/estimate")
def inference_estimate(request: Inference, row: Account):
    if not request.cloud_consent:
        raise HTTPException(403, "Cloud consent required")
    with db() as connection:
        active_device(connection, row, request.device_id)
    input_price, output_price = gateway_prices()
    amount = (
        (len(request.message.encode()) + len(request.system_text.encode()) + 256)
        * input_price
        + 512 * output_price
    ) / 1e6
    return {
        "estimated_cost_usd": amount,
        "model": os.getenv("NIGHTBREW_GATEWAY_MODEL", ""),
    }


@app.post("/portal")
def portal(row: Account):
    if mode() != "stripe":
        return {"environment": "mock", "url": None}
    if not row.get("customer"):
        raise HTTPException(409, "No payment customer exists yet")
    return_url = os.getenv("NIGHTBREW_CHECKOUT_SUCCESS_URL", "")
    if not return_url.startswith("https://"):
        raise HTTPException(503, "Configure portal return URL")
    return stripe_request(
        "POST",
        "/billing_portal/sessions",
        {"customer": row["customer"], "return_url": return_url},
    )


class AuthorityPlan(BaseModel):
    monthly_myr: int = Field(ge=0, le=1000000)
    employees: int = Field(ge=1, le=10000)
    devices: int = Field(ge=1, le=10000)
    monthly_tasks: int = Field(ge=0, le=1000000)
    included_credits_usd: float = Field(ge=0, le=10000, allow_inf_nan=False)
