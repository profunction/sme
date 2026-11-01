"""User-selected model identifiers and public provider URL; never stores API keys."""
import ipaddress
import os
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from backend import store


class Models(BaseModel):
    local_model: str = Field(default="llama3.2:3b", min_length=1, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
    cloud_model: str = Field(default="deepseek-chat", max_length=200)
    cloud_url: str = Field(default="https://api.deepseek.com/v1", max_length=2000)

    @field_validator("cloud_model")
    @classmethod
    def model_name(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError("Model identifier cannot contain control characters")
        return value.strip()

    @field_validator("cloud_url")
    @classmethod
    def endpoint(cls, value):
        if any(ord(c) < 33 for c in value):
            raise ValueError("Provider URL cannot contain whitespace or control characters")
        parsed = urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme != "https" or not host or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.port not in (None, 443)
                or host == "localhost" or host.endswith((".local", ".internal", ".localhost"))):
            raise ValueError("Provider URL must be public HTTPS on port 443 without credentials, query or fragment")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address and not address.is_global:
            raise ValueError("Private provider addresses are not allowed")
        return value.rstrip("/")


def read(db):
    saved = store.get(db, "model_settings")
    return Models(**(saved if saved is not None else {
        "local_model": os.getenv("NIGHTBREW_LOCAL_MODEL", "llama3.2:3b"),
        "cloud_model": os.getenv("NIGHTBREW_CLOUD_MODEL", "deepseek-chat"),
        "cloud_url": os.getenv("NIGHTBREW_CLOUD_URL", "https://api.deepseek.com/v1"),
    }))


def load(connect):
    with connect() as db:
        return read(db)
