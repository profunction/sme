"""Loopback-only chat service. No tool execution or automatic cloud fallback."""
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field

app = FastAPI(title="NightBrew AI Employee", version="0.1.0")
DB = Path(os.getenv("NIGHTBREW_DB", str(Path.home() / ".nightbrew" / "chat.sqlite3")))
TOKEN = os.getenv("NIGHTBREW_SESSION_TOKEN") or secrets.token_urlsafe(32)


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB)
    connection.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    return connection


def authorize(authorization):
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "Session authentication required")


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=32000)
    mode: Literal["LOCAL_ONLY", "CLOUD_ONLY"] = "LOCAL_ONLY"
    cloud_consent: bool = False


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/messages")
def messages(authorization: str | None = Header(default=None)):
    authorize(authorization)
    with connect() as db:
        rows = db.execute("SELECT id, role, content, provider FROM messages ORDER BY id DESC LIMIT 100").fetchall()
    return [dict(zip(("id", "role", "content", "provider"), row)) for row in reversed(rows)]


@app.post("/chat")
def chat(request: Chat, authorization: str | None = Header(default=None)):
    authorize(authorization)
    cloud = request.mode == "CLOUD_ONLY"
    if cloud and not request.cloud_consent:
        raise HTTPException(403, "Explicit cloud data consent is required")
    model = os.getenv("NIGHTBREW_CLOUD_MODEL", "") if cloud else os.getenv("NIGHTBREW_LOCAL_MODEL", "llama3.2:3b")
    if cloud and (not os.getenv("NIGHTBREW_CLOUD_KEY") or not model):
        raise HTTPException(503, "Configure cloud API key and model in the backend environment")
    base = os.getenv("NIGHTBREW_CLOUD_URL", "https://api.openai.com/v1") if cloud else os.getenv("NIGHTBREW_OLLAMA_URL", "http://127.0.0.1:11434")
    if cloud and not base.startswith("https://"):
        raise HTTPException(503, "Cloud endpoint requires HTTPS")
    payload = {"model": model, "messages": [{"role": "user", "content": request.message}], "stream": False}
    headers = {"Authorization": f"Bearer {os.environ['NIGHTBREW_CLOUD_KEY']}"} if cloud else {}
    try:
        with httpx.Client(timeout=90, follow_redirects=False, trust_env=cloud) as client:
            response = client.post(base.rstrip("/") + ("/chat/completions" if cloud else "/api/chat"), json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            answer = data["choices"][0]["message"]["content"] if cloud else data["message"]["content"]
            if not isinstance(answer, str) or not answer.strip():
                raise ValueError("Empty answer")
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "AI provider unavailable or returned an invalid response") from None
    with connect() as db:
        db.executemany("INSERT INTO messages(role,content,provider) VALUES(?,?,?)", [("user", request.message, request.mode), ("assistant", answer, request.mode)])
    return {"answer": answer, "provider": request.mode}

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["null", "http://127.0.0.1:5173"], allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])
