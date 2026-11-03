"""Single-owner, same-origin website AI service. Never expose the desktop API."""
from dataclasses import dataclass
import hashlib
import hmac
import json
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend import ai, provider_errors, store

COOKIE = "nightbrew_web_session"
DEEPSEEK = "https://api.deepseek.com/v1"


def password_hash(password):
    if not 12 <= len(password) <= 256:
        raise ValueError("Choose a website password of 12–256 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return "scrypt$" + salt.hex() + "$" + digest.hex()


def password_matches(password, encoded):
    try:
        kind, salt, expected = encoded.split("$")
        if kind != "scrypt" or len(salt) != 32 or len(expected) != 64 or len(password) > 256:
            return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


@dataclass(frozen=True)
class WebConfig:
    database: Path
    password_hash: str
    master_key: str
    origin: str = "http://127.0.0.1:8787"
    frontend: Path | None = None
    session_seconds: int = 28800

    def validate(self):
        p = urlsplit(self.origin)
        if (p.scheme not in ("http", "https") or not p.hostname or p.username or p.password
                or p.query or p.fragment or p.path not in ("", "/")
                or (p.scheme != "https" and p.hostname not in ("127.0.0.1", "localhost", "::1"))):
            raise ValueError("Website origin must be HTTPS, or loopback HTTP for local use")
        Fernet(self.master_key.encode())
        if not re.fullmatch(r"scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}", self.password_hash):
            raise ValueError("A configured owner password hash is required")
        if not 60 <= self.session_seconds <= 86400:
            raise ValueError("Invalid session lifetime")


class Login(BaseModel):
    password: SecretStr


class Key(BaseModel):
    key: SecretStr


class Settings(BaseModel):
    model: str = Field(default="deepseek-chat", pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")
    policy: ai.Policy


class Check(BaseModel):
    consent: bool = False


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=16000)
    consent: bool = False
    private: bool = False
    language: str = Field(default="zh", pattern="^(zh|en)$")


def create_web_app(config: WebConfig, *, client_factory=None):
    config.validate()
    origin = config.origin.rstrip("/")
    secure = origin.startswith("https://")
    vault = Fernet(config.master_key.encode())
    csrf_secret = hashlib.sha256(config.master_key.encode()).digest()
    slots = threading.BoundedSemaphore(2)
    app = FastAPI(title="NightBrew personal web workspace", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[urlsplit(origin).hostname])

    def connect():
        db = store.open_db(config.database)
        db.execute("CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY, expires REAL NOT NULL)")
        return db

    def csrf(token):
        return hmac.new(csrf_secret, token.encode(), hashlib.sha256).hexdigest()

    def session(request):
        token = request.cookies.get(COOKIE, "")
        if len(token) > 200 or not token:
            return None
        with connect() as db:
            row = db.execute("SELECT expires FROM web_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        return token if row and row[0] > time.time() else None

    def owner(request: Request):
        token = session(request)
        if not token:
            raise HTTPException(401, "Website login required")
        if request.method not in ("GET", "HEAD"):
            if not hmac.compare_digest(request.headers.get("X-CSRF-Token", "").encode(), csrf(token).encode()):
                raise HTTPException(403, "Website request verification failed; sign in again")
        return token

    @app.middleware("http")
    async def boundary(request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("origin") != origin:
            return JSONResponse({"detail": "Website origin rejected"}, status_code=403)
        if request.url.path.startswith("/web-api/") and request.method not in ("GET", "HEAD"):
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 65536:
                    return JSONResponse({"detail": "Website request exceeds 64 KiB"}, status_code=413)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        # FastAPI's normal validation detail can echo submitted secrets.
        return JSONResponse({"detail": "Website request validation failed"}, status_code=422)

    def read_settings():
        with connect() as db:
            return {"model": store.get(db, "web_model", "deepseek-chat"),
                    "policy": ai.Policy(**store.get(db, "ai_policy", {})).model_dump(),
                    "key_present": bool(store.get(db, "web_key_ciphertext"))}

    def key():
        with connect() as db:
            encrypted = store.get(db, "web_key_ciphertext")
        if not encrypted:
            raise HTTPException(422, "Save your DeepSeek API key first")
        try:
            return vault.decrypt(encrypted.encode()).decode()
        except Exception:
            raise HTTPException(503, "Website credential storage unavailable") from None

    def provider_call(method, path, *, body=None, credential=None):
        credential = credential or key()
        factory = client_factory or httpx.Client
        with factory(timeout=90 if body else 15, follow_redirects=False, trust_env=True) as provider:
            with provider.stream(method, DEEPSEEK + path, headers={"Authorization": "Bearer " + credential}, json=body) as response:
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > 2 * 1024**2:
                        raise ValueError("Provider response too large")
                return json.loads(data)

    @app.get("/web-api/status")
    def status(request: Request):
        token = session(request)
        result = {"website_backend": True, "authenticated": bool(token), "workspace_type": "single_owner_personal"}
        if token:
            result.update({"csrf_token": csrf(token), "settings": read_settings()})
        return result

    @app.post("/web-api/login")
    def login(request: Request, value: Login, response: Response):
        # One owner, bounded attempts shared across replicas using this SQLite file.
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            limiter = store.get(db, "web_login_attempts", {"at": time.time(), "count": 0})
            if time.time() - limiter["at"] > 300:
                limiter = {"at": time.time(), "count": 0}
            if limiter["count"] >= 8:
                raise HTTPException(429, "Too many login attempts; wait five minutes")
            limiter["count"] += 1
            store.put(db, "web_login_attempts", limiter)
        if not password_matches(value.password.get_secret_value(), config.password_hash):
            raise HTTPException(401, "Website password rejected")
        token = secrets.token_urlsafe(32)
        with connect() as db:
            db.execute("DELETE FROM web_sessions WHERE expires <= ?", (time.time(),))
            db.execute("INSERT INTO web_sessions VALUES (?,?)", (hashlib.sha256(token.encode()).hexdigest(), time.time() + config.session_seconds))
            store.audit(db, "web_login", "owner")
        response.set_cookie(COOKIE, token, max_age=config.session_seconds, httponly=True, secure=secure, samesite="strict", path="/")
        return {"website_backend": True, "authenticated": True, "csrf_token": csrf(token), "settings": read_settings()}

    @app.post("/web-api/logout")
    def logout(response: Response, token=Depends(owner)):
        with connect() as db:
            db.execute("DELETE FROM web_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        response.delete_cookie(COOKIE, path="/", secure=secure, httponly=True, samesite="strict")
        return {"logged_out": True}

    @app.put("/web-api/key", dependencies=[Depends(owner)])
    def save_key(value: Key):
        raw = value.key.get_secret_value().strip()
        if raw and (not 10 <= len(raw) <= 512 or not raw.isascii() or any(char.isspace() for char in raw)):
            raise HTTPException(422, "API key format invalid; paste the key only, without Bearer or whitespace")
        with connect() as db:
            store.put(db, "web_key_ciphertext", vault.encrypt(raw.encode()).decode() if raw else None)
            store.audit(db, "web_key_changed", "deepseek", "stored" if raw else "removed")
        return {"stored": bool(raw), "storage": "encrypted_server_storage"}

    @app.put("/web-api/settings", dependencies=[Depends(owner)])
    def save_settings(value: Settings):
        if value.policy.billing_source != "BYOK":
            raise HTTPException(422, "Personal website supports customer-owned API keys only")
        if value.policy.cloud_allowed and not value.policy.pricing_confirmed:
            raise HTTPException(422, "Verify provider prices before enabling cloud use")
        with connect() as db:
            store.put(db, "web_model", value.model)
            store.put(db, "ai_policy", value.policy.model_dump())
            store.audit(db, "web_ai_settings_changed", value.model)
        return read_settings()

    @app.post("/web-api/test", dependencies=[Depends(owner)])
    def test(value: Check):
        if not value.consent:
            raise HTTPException(403, "Explicit consent is required for this provider check")
        settings = read_settings()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = store.get(db, "web_model_check_at", 0)
            if time.time() - previous < 10:
                raise HTTPException(429, "Wait ten seconds before testing again")
            store.put(db, "web_model_check_at", time.time())
        try:
            data = provider_call("GET", "/models")
            listed = any(isinstance(model, dict) and model.get("id") == settings["model"] for model in data["data"])
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            raise HTTPException(502, provider_errors.describe(error, cloud=True, model=settings["model"], operation="connection_check")) from None
        return {"endpoint_reachable": True, "model_listed": listed, "inference_tested": False}

    @app.post("/web-api/chat", dependencies=[Depends(owner)])
    def chat(value: Chat):
        if value.private:
            raise HTTPException(403, "Private data cannot use this cloud-only website service")
        settings = read_settings()
        policy = ai.Policy(**settings["policy"])
        request = ai.Chat(message=value.message, mode="CLOUD_ONLY", cloud_consent=value.consent, response_language=value.language)
        try:
            ai.select(request, policy, None, "")
        except ValueError as error:
            raise HTTPException(403, str(error)) from None
        active_key = key()  # Capture the approved credential before reserving budget.
        if not slots.acquire(blocking=False):
            raise HTTPException(429, "Two website AI requests are already active; wait before retrying")
        reservation = None
        try:
            try:
                reservation, _ = ai.reserve(connect, settings["model"], request, policy, ai.instructions(request))
            except ValueError as error:
                raise HTTPException(402, str(error)) from None
            try:
                data = provider_call("POST", "/chat/completions", credential=active_key, body={"model": settings["model"], "stream": False, "max_tokens": policy.max_output_tokens, "messages": [{"role": "system", "content": ai.instructions(request)}, {"role": "user", "content": request.message}]})
                answer = data["choices"][0]["message"]["content"]
                if not isinstance(answer, str) or not answer.strip():
                    raise ValueError("No text answer")
            except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as error:
                ai.settle(connect, reservation, None, policy, False)
                raise HTTPException(502, provider_errors.describe(error, cloud=True, model=settings["model"])) from None
            try:
                ai.settle(connect, reservation, data.get("usage"), policy, True)
            except ValueError as error:
                raise HTTPException(402, str(error)) from None
            with connect() as db:
                db.executemany("INSERT INTO messages(role,content,provider) VALUES (?,?,?)", [("user", request.message, settings["model"]), ("assistant", answer, settings["model"])])
                store.audit(db, "web_chat_completed", settings["model"])
            return {"answer": answer, "model": settings["model"], "usage_id": reservation}
        finally:
            slots.release()

    @app.get("/web-api/messages", dependencies=[Depends(owner)])
    def messages():
        with connect() as db:
            rows = db.execute("SELECT role,content,provider FROM messages ORDER BY id DESC LIMIT 100").fetchall()
        return [dict(row) for row in reversed(rows)]

    @app.get("/web-api/usage", dependencies=[Depends(owner)])
    def usage():
        with connect() as db:
            rows = [dict(row) for row in db.execute("SELECT * FROM usage ORDER BY created_at DESC LIMIT 100")]
        return {"currency": "USD", "estimated_costs_not_provider_balance": True, "entries": rows}

    @app.api_route("/web-api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    def unknown_api(path: str):
        raise HTTPException(404, "Unknown website API route")

    if config.frontend and config.frontend.is_dir():
        app.mount("/", StaticFiles(directory=config.frontend, html=True), name="website")
    return app
