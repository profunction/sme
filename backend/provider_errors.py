"""Classify provider failures without exposing response bodies, URLs or credentials."""
import httpx


def describe(error, *, cloud, model, operation="chat"):
    mode = "CLOUD_ONLY" if cloud else "LOCAL_ONLY"
    if isinstance(error, httpx.TimeoutException):
        code = ("AI_CLOUD_CHECK_TIMEOUT" if operation == "connection_check" else "AI_CLOUD_TIMEOUT") if cloud else "AI_LOCAL_TIMEOUT"
        message = "AI provider timed out. No retry or provider change was attempted."
    elif isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if cloud:
            code = {401: "AI_CLOUD_AUTH", 403: "AI_CLOUD_AUTH", 402: "AI_CLOUD_BALANCE", 404: "AI_CLOUD_NOT_FOUND", 429: "AI_CLOUD_RATE_LIMIT"}.get(
                status, "AI_CLOUD_SERVER" if status >= 500 else "AI_CLOUD_REQUEST")
        else:
            code = "AI_LOCAL_MODEL_MISSING" if status == 404 else "AI_LOCAL_SERVER"
        message = "AI provider rejected this request. No retry or provider change was attempted."
        return {"code": code, "message": message, "mode": mode, "model": model, "provider_status": status}
    elif isinstance(error, httpx.HTTPError):
        code = "AI_CLOUD_NETWORK" if cloud else "AI_LOCAL_OFFLINE"
        message = "Could not communicate with the AI provider. No retry or provider change was attempted."
    else:
        code = ("AI_CLOUD_CHECK_RESPONSE" if operation == "connection_check" else "AI_CLOUD_RESPONSE") if cloud else "AI_LOCAL_RESPONSE"
        message = "AI provider returned no usable text answer. No retry or provider change was attempted."
    return {"code": code, "message": message, "mode": mode, "model": model}
