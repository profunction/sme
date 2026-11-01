"""Administrator-configured model limits, not inferred provider capabilities.

The compatibility fallback describes only existing application text limits. It
is not a claim about a provider's actual context window or live availability.
Production requires an explicitly reviewed registry entry.
"""

import json
import os
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

Capability = Literal["TEXT", "VISION", "STRUCTURED_OUTPUT", "TOOL_CALLING", "LONG_CONTEXT", "REASONING"]


class ModelPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capabilities: set[Capability] = Field(default_factory=lambda: {"TEXT"}, min_length=1)
    max_input_bytes: int = Field(default=160000, ge=1, le=2000000, strict=True)
    max_output_tokens: int = Field(default=512, ge=1, le=100000, strict=True)
    context_window_tokens: int | None = Field(default=None, ge=1, le=2000000, strict=True)
    verification_status: Literal["UNVERIFIED", "VERIFIED"] = "UNVERIFIED"
    source: str = Field(default="", max_length=1000)


def resolve(model):
    raw = os.getenv("NIGHTBREW_GATEWAY_MODELS_JSON")
    production = (os.getenv("NIGHTBREW_ENV") == "production"
                  or os.getenv("NIGHTBREW_SERVER_ENV") in ("staging", "production"))
    try:
        if not raw:
            if production:
                raise ValueError()
            return ModelPolicy()
        entries = json.loads(raw)
        if not isinstance(entries, dict) or model not in entries:
            raise ValueError()
        policy = ModelPolicy.model_validate(entries[model])
        if production and (policy.verification_status != "VERIFIED"
                           or policy.context_window_tokens is None or not policy.source.startswith("https://")):
            raise ValueError()
        return policy
    except (ValueError, TypeError):
        raise HTTPException(503, "Configure a reviewed model registry entry and its limits before inference") from None


def require_capabilities(model, required):
    policy = resolve(model)
    if not set(required) <= policy.capabilities:
        raise HTTPException(422, "Configured model does not support the required task capabilities")
    return policy


def validate_text_request(model, message, system_text, max_output_tokens):
    policy = require_capabilities(model, {"TEXT"})
    size = len(message.encode("utf-8")) + len(system_text.encode("utf-8"))
    if size > policy.max_input_bytes or max_output_tokens > policy.max_output_tokens:
        raise HTTPException(422, "Task exceeds configured model input or output limits")
    if policy.context_window_tokens is not None and size + 256 + max_output_tokens > policy.context_window_tokens:
        # Match the existing conservative reservation bound, not a guessed tokenizer.
        raise HTTPException(422, "Task exceeds the configured conservative context bound")
    return policy
