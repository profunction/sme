"""Single authority process with startup validation and complete migration readiness."""

from contextlib import asynccontextmanager

from fastapi import HTTPException
from billing_service.app import app
from billing_service.postgres import pool
from deploy.migrate import expected_migrations
from deploy.validation import validate_configuration

_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    validate_configuration()
    try:
        async with _original_lifespan(application):
            yield
    finally:
        if pool.cache_info().currsize:
            pool().close()
            pool.cache_clear()


app.router.lifespan_context = lifespan


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    try:
        with pool().connection() as conn:
            rows = conn.execute("SELECT version,sha256 FROM schema_migrations").fetchall()
            applied = {row["version"]: row["sha256"] for row in rows}
            if applied != expected_migrations():
                raise ValueError("Incomplete or mismatched schema")
            conn.execute("SELECT id FROM accounts LIMIT 1").fetchone()
    except Exception:
        raise HTTPException(503, "Database or required migrations unavailable") from None
    return {"status": "ready"}
