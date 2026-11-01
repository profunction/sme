"""Single authority process: license, subscription, gateway and readiness endpoints."""
from fastapi import HTTPException
from billing_service.app import app
from billing_service.postgres import pool

@app.get('/health/live')
def live(): return {'status':'ok'}

@app.get('/health/ready')
def ready():
    try:
        with pool().connection() as conn:
            conn.execute('SELECT version FROM schema_migrations LIMIT 1').fetchone()
    except Exception:
        raise HTTPException(503,'Database or migrations unavailable') from None
    return {'status':'ready'}
