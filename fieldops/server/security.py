import hashlib
import hmac
import secrets
import time
from collections import OrderedDict
from threading import Lock

from fastapi import Header, HTTPException, Request
from .db import connect


def hash_password(password):
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return f'scrypt${salt.hex()}${derived.hex()}'


def verify_password(password, stored):
    try:
        _, salt, expected = stored.split('$')
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith('Bearer ') or len(authorization) > 256:
        raise HTTPException(401, 'Sign in to your company workspace')
    digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
    with connect() as conn:
        row = conn.execute('SELECT u.id,u.company_id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.expires_at>? AND u.active=1', (digest,int(time.time()))).fetchone()
    if not row:
        raise HTTPException(401, 'Session expired or invalid; sign in again')
    return dict(row)


class RateLimiter:
    def __init__(self):
        self.entries = OrderedDict()
        self.lock = Lock()

    def check(self, key, limit, seconds=60):
        now = time.monotonic()
        with self.lock:
            entries = [t for t in self.entries.pop(key, []) if now-t < seconds]
            if len(entries) >= limit:
                self.entries[key] = entries
                raise HTTPException(429, 'Too many requests; try again shortly')
            entries.append(now)
            self.entries[key] = entries
            while len(self.entries) > 10000:
                self.entries.popitem(last=False)


limiter = RateLimiter()


def management(user):
    if user['role'] not in ('owner','administrator','supervisor'):
        raise HTTPException(403, 'A supervisor or administrator is required')


def admin(user):
    if user['role'] not in ('owner','administrator'):
        raise HTTPException(403, 'Company administration permission is required')


def editable(user):
    if user['role'] == 'viewer':
        raise HTTPException(403, 'Viewer accounts cannot change service records')
