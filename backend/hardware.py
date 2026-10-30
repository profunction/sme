import json
import platform
import shutil
import subprocess
from pathlib import Path

import httpx
import psutil


def ollama_base():
    import os
    from urllib.parse import urlsplit

    base = os.getenv("NIGHTBREW_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    parsed = urlsplit(base)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Ollama must use an HTTP loopback endpoint")
    return base


def fingerprint():
    import hashlib

    value = f"{platform.system()}|{platform.machine()}|{platform.processor()}|{psutil.cpu_count()}|{psutil.virtual_memory().total}"
    return hashlib.sha256(value.encode()).hexdigest()


def inspect():
    gpus = []
    if platform.system() == "Windows":
        # Static query only; AdapterRAM is not reliable dedicated VRAM, so do not label it as such.
        try:
            result = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            entries = json.loads(result.stdout)
            if isinstance(entries, dict):
                entries = [entries]
            gpus = [
                {
                    "name": e["Name"],
                    "reported_adapter_bytes": e.get("AdapterRAM"),
                    "dedicated_vram_bytes": None,
                }
                for e in entries
            ]
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            pass
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        gpus = [
            {
                "name": line.rsplit(",", 1)[0].strip(),
                "dedicated_vram_bytes": int(line.rsplit(",", 1)[1].strip()) * 1024**2,
            }
            for line in result.stdout.splitlines()
        ]
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    models, available = [], False
    try:
        with httpx.Client(timeout=3, trust_env=False) as client:
            result = client.get(ollama_base() + "/api/tags")
            result.raise_for_status()
            models = [item["name"] for item in result.json()["models"]]
            available = True
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        pass
    return {
        "platform": platform.system(),
        "cpu": platform.processor() or platform.machine(),
        "logical_cpus": psutil.cpu_count(),
        "ram_bytes": psutil.virtual_memory().total,
        "available_ram_bytes": psutil.virtual_memory().available,
        "available_storage_bytes": shutil.disk_usage(Path.cwd()).free,
        "gpus": gpus,
        "gpu_detection": "detected" if gpus else "unknown",
        "ollama_binary_found": shutil.which("ollama") is not None,
        "ollama_available": available,
        "models": models,
        "local_plan_recommended": False,
        "note": "GPU compatibility and local plan suitability require a successful model benchmark; unknown VRAM stays unknown.",
    }


def benchmark(model):
    with httpx.Client(timeout=120, trust_env=False) as client:
        response = client.post(
            ollama_base() + "/api/generate",
            json={
                "model": model,
                "prompt": "Explain in two sentences why accurate stock counts help a business.",
                "stream": False,
                "options": {"num_predict": 64},
            },
        )
        response.raise_for_status()
        data = response.json()
    count, duration = data.get("eval_count", 0), data.get("eval_duration", 0)
    if (
        not data.get("response")
        or not isinstance(count, int)
        or count <= 0
        or not isinstance(duration, (int, float))
        or duration <= 0
    ):
        raise ValueError("Provider did not return benchmark measurements")
    rate = count / (duration / 1e9)
    return {
        "model": model,
        "hardware_fingerprint": fingerprint(),
        "tokens_per_second": round(rate, 2),
        "sample_tokens": count,
        "local_plan_recommended": rate >= 5,
        "note": "One text sample; not certification for complex, vision or tool tasks.",
    }
