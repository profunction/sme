"""Transactional admission using authority reservations, shared across API processes.

Call inside the same serialized transaction that creates the reservation. A crash
leaves its slot reserved until an operator reconciles the unknown provider outcome;
never expire a slot blindly while a provider request may still be running.
"""

import os

from fastapi import HTTPException


def limits():
    try:
        values = tuple(
            int(os.getenv(name, default))
            for name, default in (
                ("NIGHTBREW_GATEWAY_MAX_CONCURRENT", "2"),
                ("NIGHTBREW_GATEWAY_ACCOUNT_MAX_CONCURRENT", "1"),
            )
        )
        if any(value < 1 or value > 128 for value in values):
            raise ValueError()
        return values
    except ValueError:
        raise HTTPException(503, "Configure gateway concurrency limits from 1 to 128") from None


def check(connection, account_id, configured_limits):
    global_limit, account_limit = configured_limits
    total = connection.execute(
        "SELECT COUNT(*) FROM inference WHERE status='reserved'"
    ).fetchone()[0]
    own = connection.execute(
        "SELECT COUNT(*) FROM inference WHERE account=? AND status='reserved'",
        (account_id,),
    ).fetchone()[0]
    if total >= global_limit or own >= account_limit:
        raise HTTPException(
            429,
            "Cloud inference capacity is busy; no credits reserved or provider request sent",
        )
