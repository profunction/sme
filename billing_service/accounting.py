"""Exact USD cost ledger, separate from future customer-facing Credit units.

Legacy REAL columns are compatibility projections only. Existing balances require
an explicit reviewed opening entry; they are never silently converted on reads.
All mutations must share the authority's serialized write transaction.
"""

import json
import os
import time
from decimal import Decimal, InvalidOperation, localcontext

from fastapi import HTTPException

SCHEMA = """
CREATE TABLE IF NOT EXISTS money_accounts(account TEXT PRIMARY KEY, available_usd TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS money_entries(account TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, delta_usd TEXT NOT NULL, balance_usd TEXT NOT NULL, metadata TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(account,id));
CREATE TABLE IF NOT EXISTS inference_costs(account TEXT NOT NULL, id TEXT NOT NULL, snapshot TEXT NOT NULL, reported_usage TEXT, reported_cost_usd TEXT, outcome TEXT NOT NULL, PRIMARY KEY(account,id));
"""
ZERO = Decimal("0")


def decimal(value, *, maximum=Decimal("1000000000")):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or abs(result) > maximum or result.as_tuple().exponent < -18:
            raise ValueError()
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid decimal amount") from None


def text(value):
    formatted = format(value, "f")
    if value == ZERO:
        return "0"
    return formatted.rstrip("0").rstrip(".") if "." in formatted else formatted


def balance(connection, account, *, require_active=True):
    row = connection.execute("SELECT * FROM money_accounts WHERE account=?", (account,)).fetchone()
    if row is None:
        raise HTTPException(503, "Legacy balance needs an administrator-reviewed opening ledger entry")
    if require_active and row["state"] != "active":
        raise HTTPException(409, "Cloud accounting is on hold; administrator reconciliation required")
    return decimal(row["available_usd"])


def open_account(connection, account, amount=ZERO, *, metadata=None):
    value = decimal(amount)
    if value < ZERO:
        raise ValueError("Opening balance cannot be negative")
    connection.execute("INSERT INTO money_accounts VALUES(?,?,?)", (account, text(value), "active"))
    connection.execute("INSERT INTO money_entries VALUES(?,?,?,?,?,?,?)",
                       (account, "opening", "opening", text(value), text(value),
                        json.dumps(metadata or {}, sort_keys=True), int(time.time())))
    connection.execute("UPDATE accounts SET credits=? WHERE id=?", (float(value), account))


def change(connection, account, identifier, amount, kind, *, metadata=None, allow_held=False):
    if connection.execute("SELECT 1 FROM money_entries WHERE account=? AND id=?", (account, identifier)).fetchone():
        return False
    current = balance(connection, account, require_active=not allow_held)
    delta = decimal(amount)
    with localcontext() as ctx:
        ctx.prec = 50
        updated = current + delta
    if updated < ZERO:
        raise HTTPException(402, "Exact cloud balance exceeded")
    if updated > Decimal("1000000000"):
        raise HTTPException(409, "Account balance exceeds ledger limit")
    connection.execute("UPDATE money_accounts SET available_usd=? WHERE account=?", (text(updated), account))
    connection.execute("INSERT INTO money_entries VALUES(?,?,?,?,?,?,?)",
                       (account, identifier, kind, text(delta), text(updated),
                        json.dumps(metadata or {}, sort_keys=True), int(time.time())))
    # The REAL value is never read to authorize or settle inference.
    connection.execute("UPDATE accounts SET credits=? WHERE id=?", (float(updated), account))
    return True


def prices():
    try:
        values = tuple(decimal(os.environ[name], maximum=Decimal("10000")) for name in (
            "NIGHTBREW_GATEWAY_INPUT_USD_PER_MILLION", "NIGHTBREW_GATEWAY_OUTPUT_USD_PER_MILLION"))
        if any(value < ZERO or value.as_tuple().exponent < -9 for value in values):
            raise ValueError()
        return values
    except (KeyError, ValueError):
        raise HTTPException(503, "Configure valid gateway model prices (up to nine decimal places)") from None


def cost(input_tokens, output_tokens, rates):
    with localcontext() as ctx:
        ctx.prec = 50
        return (input_tokens * rates[0] + output_tokens * rates[1]) / Decimal("1000000")


def snapshot(model, base, input_bound, maximum, rates):
    return {"currency": "USD", "model": model, "provider_api": base,
            "input_bound": input_bound, "output_bound": maximum,
            "input_usd_per_million": text(rates[0]), "output_usd_per_million": text(rates[1]),
            "pricing_verification": "administrator_reviewed" if os.getenv("NIGHTBREW_GATEWAY_PRICING_VERIFIED") == "YES" else "administrator_configured_unverified",
            "price_source": os.getenv("NIGHTBREW_GATEWAY_PRICING_SOURCE", "administrator configuration"),
            "created": int(time.time()), "reserved_usd": text(cost(input_bound, maximum, rates))}


def reported(usage, pricing):
    if not isinstance(usage, dict):
        raise ValueError("Provider usage must be an object")
    ins, outs = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if type(ins) is not int or type(outs) is not int or ins < 0 or outs < 0 or max(ins, outs) > 1_000_000_000:
        raise ValueError("Provider token usage is missing or invalid")
    actual = cost(ins, outs, (decimal(pricing["input_usd_per_million"]), decimal(pricing["output_usd_per_million"])))
    bounded = ins <= pricing["input_bound"] and outs <= pricing["output_bound"] and actual <= decimal(pricing["reserved_usd"])
    # Preserve supported usage dimensions without storing arbitrary provider content.
    details = {"prompt_tokens": ins, "completion_tokens": outs}
    for name in ("prompt_tokens_details", "completion_tokens_details"):
        if isinstance(usage.get(name), dict):
            details[name] = {key: value for key, value in usage[name].items()
                             if type(value) is int and 0 <= value <= 1_000_000_000}
    return details, actual, bounded
