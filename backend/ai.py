import os
import uuid
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from backend import hardware, store, workforce


class Policy(BaseModel):
    billing_source: Literal["BYOK", "INCLUDED"] = "BYOK"
    cloud_allowed: bool = False
    monthly_limit_usd: float = Field(default=5, ge=0, le=10000, allow_inf_nan=False)
    credit_balance_usd: float = Field(default=0, ge=0, le=10000, allow_inf_nan=False)
    input_usd_per_million: float = Field(default=0, ge=0, le=10000, allow_inf_nan=False)
    output_usd_per_million: float = Field(
        default=0, ge=0, le=10000, allow_inf_nan=False
    )
    pricing_confirmed: bool = False
    local_complex_capable: bool = False
    max_output_tokens: int = Field(default=512, ge=16, le=4096)


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=32000)
    mode: Literal["LOCAL_ONLY", "CLOUD_ONLY", "HYBRID"] = "LOCAL_ONLY"
    cloud_consent: bool = False
    privacy: Literal["private", "standard"] = "standard"
    employee_id: str | None = Field(default=None, max_length=80)
    complexity: Literal["simple", "complex"] = "simple"


def select(request, policy, measured, model):
    if request.mode == "LOCAL_ONLY":
        return "LOCAL_ONLY"
    if request.privacy == "private":
        if request.mode == "CLOUD_ONLY":
            raise ValueError("Private tasks cannot use cloud AI")
        if not eligible(measured, model, request, policy):
            raise ValueError(
                "No benchmarked local model is available for this private task"
            )
        return "LOCAL_ONLY"
    if request.mode == "HYBRID" and eligible(measured, model, request, policy):
        return "LOCAL_ONLY"
    if not request.cloud_consent:
        raise ValueError("Explicit cloud data consent is required")
    if not policy.cloud_allowed:
        raise ValueError("Cloud AI is disabled in privacy settings")
    return "CLOUD_ONLY"


def eligible(measured, model, request, policy):
    return bool(
        measured
        and measured.get("model") == model
        and measured.get("hardware_fingerprint") == hardware.fingerprint()
        and measured.get("local_plan_recommended")
        and (request.complexity == "simple" or policy.local_complex_capable)
    )


def cloud_base(value=None):
    base = (value if value is not None else os.getenv("NIGHTBREW_CLOUD_URL", "https://api.deepseek.com/v1")).rstrip("/")
    p = urlsplit(base)
    if (
        p.scheme != "https"
        or not p.hostname
        or p.username
        or p.password
        or p.query
        or p.fragment
    ):
        raise ValueError(
            "Cloud endpoint requires HTTPS without embedded credentials, query or fragment"
        )
    return base


def estimate(request, policy, system_text=""):
    # UTF-8 bytes are a conservative token bound for normal text tokenizers, plus request framing.
    input_bound = (
        len(request.message.encode("utf-8")) + len(system_text.encode("utf-8")) + 256
    )
    return (
        input_bound * policy.input_usd_per_million
        + policy.max_output_tokens * policy.output_usd_per_million
    ) / 1_000_000


def reserve(connect, model, request, policy, system_text="", override_amount=None):
    if override_amount is None and not policy.pricing_confirmed:
        raise ValueError("Confirm provider pricing before cloud inference")
    amount = (
        estimate(request, policy, system_text)
        if override_amount is None
        else override_amount
    )
    import math

    if not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount < 0:
        raise ValueError("Invalid cost reservation")
    month = datetime.now(UTC).strftime("%Y-%m")
    identifier = uuid.uuid4().hex
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        # Re-read inside the transaction: concurrent settings changes cannot create extra credits.
        current = Policy(**store.get(db, "ai_policy", {}))
        if request.employee_id:
            workforce.spending_check(db, request.employee_id, amount)
        used = db.execute(
            "SELECT COALESCE(SUM(cost),0) FROM usage WHERE month=?", (month,)
        ).fetchone()[0]
        if (
            used + amount > current.monthly_limit_usd
            or amount > current.credit_balance_usd
        ):
            raise ValueError("Monthly limit or available cloud credit balance exceeded")
        current.credit_balance_usd -= amount
        store.put(db, "ai_policy", current.model_dump())
        db.execute(
            "INSERT INTO usage(id,month,model,reserved,cost,status) VALUES(?,?,?,?,?,?)",
            (identifier, month, model, amount, amount, "reserved"),
        )
        if request.employee_id:
            db.execute(
                "INSERT INTO usage_owners VALUES(?,?)",
                (identifier, request.employee_id),
            )
    return identifier, amount


def settle(connect, identifier, usage, policy, success, actual_cost=None):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM usage WHERE id=?", (identifier,)).fetchone()
        actual, tokens_in, tokens_out = row["reserved"], 0, 0
        status = "estimated" if success else "failed_estimated"
        if success and isinstance(usage, dict):
            tokens_in, tokens_out = (
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
            )
            if (
                type(tokens_in) is int
                and type(tokens_out) is int
                and tokens_in >= 0
                and tokens_out >= 0
            ):
                actual = (
                    tokens_in * policy.input_usd_per_million
                    + tokens_out * policy.output_usd_per_million
                ) / 1_000_000
                status = "reported"
            else:
                tokens_in, tokens_out = 0, 0
        if actual_cost is not None:
            actual = actual_cost
            status = "authority_reported"
        current = Policy(**store.get(db, "ai_policy", {}))
        current.credit_balance_usd = max(
            0, current.credit_balance_usd + row["reserved"] - actual
        )
        store.put(db, "ai_policy", current.model_dump())
        db.execute(
            "UPDATE usage SET cost=?,input_tokens=?,output_tokens=?,status=? WHERE id=?",
            (actual, tokens_in, tokens_out, status, identifier),
        )
