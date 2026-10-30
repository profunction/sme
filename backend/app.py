"""Authenticated loopback API; all AI output is untrusted text, never executable instructions."""
import os
import secrets
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, SecretStr

from backend import ai, credentials, hardware, store

app = FastAPI(title='NightBrew AI Employee', version='0.2.0')
DB = Path(os.getenv('NIGHTBREW_DB', str(Path.home() / '.nightbrew' / 'chat.sqlite3')))
TOKEN = os.getenv('NIGHTBREW_SESSION_TOKEN') or secrets.token_urlsafe(32)


def connect():
    return store.open_db(DB)


def authorize(authorization: str | None = Header(default=None)):
    if not authorization or not secrets.compare_digest(authorization, f'Bearer {TOKEN}'):
        raise HTTPException(401, 'Session authentication required')


@app.get('/health')
def health():
    return {'status': 'ok', 'version': app.version}


@app.get('/messages', dependencies=[Depends(authorize)])
def messages():
    with connect() as db:
        rows = db.execute('SELECT id,role,content,provider FROM messages ORDER BY id DESC LIMIT 100').fetchall()
    return [dict(row) for row in reversed(rows)]


@app.get('/hardware', dependencies=[Depends(authorize)])
def hardware_info():
    info = hardware.inspect()
    with connect() as db:
        measured = store.get(db, 'benchmark')
    info['benchmark'] = measured
    info['local_plan_recommended'] = bool(measured and measured.get('local_plan_recommended') and measured.get('model') in info['models'])
    return info


@app.post('/hardware/benchmark', dependencies=[Depends(authorize)])
def benchmark():
    try:
        result = hardware.benchmark(os.getenv('NIGHTBREW_LOCAL_MODEL', 'llama3.2:3b'))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Local model benchmark unavailable; install/start Ollama and the selected model') from None
    from datetime import datetime, timezone
    result['measured_at'] = datetime.now(timezone.utc).isoformat()
    with connect() as db: store.put(db, 'benchmark', result)
    return result


@app.get('/settings/ai', dependencies=[Depends(authorize)])
def ai_settings():
    with connect() as db: return ai.Policy(**store.get(db, 'ai_policy', {}))


@app.put('/settings/ai', dependencies=[Depends(authorize)])
def update_ai_settings(policy: ai.Policy):
    with connect() as db:
        store.put(db, 'ai_policy', policy.model_dump())
        store.audit(db, 'ai_policy_updated', 'settings')
    return policy


class KeyRequest(BaseModel):
    key: SecretStr


@app.put('/settings/cloud-key', dependencies=[Depends(authorize)])
def cloud_key(request: KeyRequest):
    try: credentials.save_key(request.key.get_secret_value())
    except Exception: raise HTTPException(503, 'Windows Credential Manager unavailable; use the backend environment binding on Linux') from None
    return {'stored': bool(request.key.get_secret_value()), 'storage': 'Windows Credential Manager'}


@app.get('/usage', dependencies=[Depends(authorize)])
def usage():
    with connect() as db:
        rows = db.execute('SELECT * FROM usage ORDER BY created_at DESC LIMIT 100').fetchall()
        return {'currency': 'USD', 'entries': [dict(row) for row in rows], 'policy': ai.Policy(**store.get(db, 'ai_policy', {}))}


@app.post('/chat', dependencies=[Depends(authorize)])
def chat(request: ai.Chat):
    local_model = os.getenv('NIGHTBREW_LOCAL_MODEL', 'llama3.2:3b')
    with connect() as db:
        if store.get(db, 'emergency_stop', False): raise HTTPException(409, 'Emergency stop is active')
        policy = ai.Policy(**store.get(db, 'ai_policy', {}))
        measured = store.get(db, 'benchmark')
    try: selected = ai.select(request, policy, measured, local_model)
    except ValueError as exc: raise HTTPException(403, str(exc)) from None
    cloud = selected == 'CLOUD_ONLY'
    model = os.getenv('NIGHTBREW_CLOUD_MODEL', '') if cloud else local_model
    try: key = credentials.cloud_key() if cloud else None
    except Exception: raise HTTPException(503, 'Credential store unavailable') from None
    if cloud and (not key or not model): raise HTTPException(503, 'Configure cloud API key and model in the backend environment')
    try: base = ai.cloud_base() if cloud else hardware.ollama_base()
    except ValueError as exc: raise HTTPException(503, str(exc)) from None
    reservation = None
    if cloud:
        try: reservation, _ = ai.reserve(connect, model, request, policy)
        except ValueError as exc: raise HTTPException(402, str(exc)) from None
    payload = {'model': model, 'messages': [{'role': 'user', 'content': request.message}], 'stream': False}
    if cloud: payload['max_tokens'] = policy.max_output_tokens
    else: payload['options'] = {'num_predict': policy.max_output_tokens}
    headers = {'Authorization': f'Bearer {key}'} if cloud else {}
    try:
        with httpx.Client(timeout=90, follow_redirects=False, trust_env=cloud) as client:
            response = client.post(base + ('/chat/completions' if cloud else '/api/chat'), json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            answer = data['choices'][0]['message']['content'] if cloud else data['message']['content']
            if not isinstance(answer, str) or not answer.strip(): raise ValueError('Empty answer')
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        if reservation: ai.settle(connect, reservation, None, policy, False)
        raise HTTPException(502, 'AI provider unavailable or returned an invalid response; no automatic fallback was attempted') from None
    if reservation: ai.settle(connect, reservation, data.get('usage'), policy, True)
    with connect() as db:
        db.executemany('INSERT INTO messages(role,content,provider) VALUES(?,?,?)', [('user', request.message, selected), ('assistant', answer, selected)])
        store.audit(db, 'chat_completed', selected)
    return {'answer': answer, 'provider': selected, 'usage_id': reservation}


app.add_middleware(CORSMiddleware, allow_origins=['null', 'http://127.0.0.1:5173'], allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['Authorization', 'Content-Type'])

@app.post('/ai/estimate', dependencies=[Depends(authorize)])
def estimate_chat(request: ai.Chat):
    with connect() as db:
        policy = ai.Policy(**store.get(db, 'ai_policy', {}))
        measured = store.get(db, 'benchmark')
    try: selected = ai.select(request, policy, measured, os.getenv('NIGHTBREW_LOCAL_MODEL', 'llama3.2:3b'))
    except ValueError as exc: raise HTTPException(403, str(exc)) from None
    return {'provider': selected, 'estimated_max_cost_usd': ai.estimate(request, policy) if selected == 'CLOUD_ONLY' else 0, 'pricing_confirmed': policy.pricing_confirmed, 'note': 'Conservative reservation, not a provider invoice. Failed cloud calls retain the reservation when billing is unknown.'}

# Business tasks and restricted files are explicitly invoked, never parsed from model output.
import json
from contextlib import asynccontextmanager
from fastapi import Request
from fastapi.responses import FileResponse
from pydantic import Field, ValidationError
from backend import documents, files, tasks


@asynccontextmanager
async def lifespan(_app):
    tasks.recover(connect)
    yield


app.router.lifespan_context = lifespan
app.version = '0.3.0'


class TaskRequest(BaseModel):
    tool: str = Field(max_length=60)
    payload: dict


@app.post('/tasks', dependencies=[Depends(authorize)], status_code=201)
def create_task(request: TaskRequest):
    if request.tool == 'connector.write': raise HTTPException(403, 'Create writes through the connector permissions endpoint')
    try: identifier, status = tasks.create(connect, request.tool, request.payload)
    except (ValueError, ValidationError) as exc: raise HTTPException(422, 'Invalid task, input or queue state') from None
    if status == 'queued':
        path = DB
        tasks.schedule(lambda: store.open_db(path), path, identifier)
    return {'id': identifier, 'status': status}


@app.get('/tasks', dependencies=[Depends(authorize)])
def task_history():
    with connect() as db:
        rows = db.execute('SELECT * FROM tasks ORDER BY rowid DESC LIMIT 100').fetchall()
    return [{**dict(row), 'payload': json.loads(row['payload']), 'result': json.loads(row['result']) if row['result'] else None} for row in rows]


@app.post('/tasks/{identifier}/approve', dependencies=[Depends(authorize)])
def approve_task(identifier: str):
    try: tasks.approve(connect, identifier)
    except ValueError as exc: raise HTTPException(409, str(exc)) from None
    path = DB
    tasks.schedule(lambda: store.open_db(path), path, identifier)
    return {'id': identifier, 'status': 'queued'}


@app.post('/tasks/{identifier}/cancel', dependencies=[Depends(authorize)])
def cancel_task(identifier: str):
    try: tasks.cancel(connect, identifier)
    except ValueError as exc: raise HTTPException(409, str(exc)) from None
    return {'id': identifier, 'cancel_requested': True}


@app.post('/control/stop', dependencies=[Depends(authorize)])
def emergency_stop():
    tasks.stop(connect)
    return {'stopped': True, 'note': 'New work blocked; cancellation is cooperative. Already dispatched provider calls or external writes cannot be recalled.'}


@app.post('/control/resume', dependencies=[Depends(authorize)])
def resume():
    with connect() as db:
        store.put(db, 'emergency_stop', False)
        store.audit(db, 'emergency_resume', 'all_tasks')
    return {'stopped': False}


@app.get('/control', dependencies=[Depends(authorize)])
def control():
    with connect() as db: return {'stopped': store.get(db, 'emergency_stop', False)}


@app.get('/audit', dependencies=[Depends(authorize)])
def audit_log():
    with connect() as db: return [dict(row) for row in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 200')]


@app.get('/files', dependencies=[Depends(authorize)])
def list_files():
    with connect() as db: return [dict(row) for row in db.execute('SELECT * FROM files ORDER BY rowid DESC LIMIT 100')]


@app.post('/files', dependencies=[Depends(authorize)], status_code=201)
async def upload_file(request: Request, filename: str):
    with connect() as db:
        if store.get(db, 'emergency_stop', False): raise HTTPException(409, 'Emergency stop is active')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > files.MAX_BYTES: raise HTTPException(413, 'Maximum upload size is 10 MiB')
    try: return files.save(connect, DB, filename, bytes(data))
    except ValueError as exc: raise HTTPException(422, str(exc)) from None


@app.get('/files/{identifier}', dependencies=[Depends(authorize)])
def download_file(identifier: str):
    try: path, metadata = files.locate(connect, DB, identifier)
    except ValueError as exc: raise HTTPException(404, str(exc)) from None
    return FileResponse(path, filename=metadata['name'], media_type='application/octet-stream', headers={'X-Content-Type-Options':'nosniff'})
