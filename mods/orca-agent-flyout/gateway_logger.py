"""LiteLLM callback: allowlisted metadata only; no payloads or raw exceptions."""
import fcntl
import json
import os
from pathlib import Path
import time
import uuid
from litellm.integrations.custom_logger import CustomLogger

ROOT = Path(os.environ["HERDR_GATEWAY_DIR"])
ROUTES = json.loads((ROOT / "routes.json").read_text())
MAX_BYTES = 4 * 1024 * 1024

def mapping(value):
    return value if isinstance(value, dict) else {}

def route_for(data):
    params = mapping(data.get("litellm_params"))
    meta = mapping(data.get("metadata")) or mapping(params.get("metadata"))
    info = mapping(data.get("model_info")) or mapping(params.get("model_info")) or mapping(meta.get("model_info"))
    for alias in (info.get("id"), meta.get("model_group"), data.get("model"), params.get("model")):
        if isinstance(alias, str) and alias in ROUTES:
            return ROUTES[alias]
    return None

def event(data, kind, status=None, response=None):
    route = route_for(data)
    if route is None:
        return
    params = mapping(data.get("litellm_params"))
    meta = mapping(data.get("metadata")) or mapping(params.get("metadata"))
    request_id = data.get("litellm_call_id") or meta.get("litellm_call_id") or str(uuid.uuid4())
    usage = getattr(response, "usage", None)
    def number(*names):
        for name in names:
            v = getattr(usage, name, None) if usage is not None else None
            if isinstance(v, int) and not isinstance(v, bool) and v >= 0:
                return v
        return None
    obj = {"version": 1, "kind": kind, "id": str(request_id)[:128], "timestamp": int(time.time()*1000),
           "provider": route["provider"], "model": route["model"], "kilo": route["kilo"],
           "status": status if isinstance(status, int) else None,
           "input_tokens": number("prompt_tokens", "input_tokens"),
           "output_tokens": number("completion_tokens", "output_tokens")}
    line = json.dumps(obj, ensure_ascii=True, separators=(",", ":")) + "\n"
    path = ROOT / "events.jsonl"
    with open(ROOT / "events.lock", "a") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.exists() and path.stat().st_size >= MAX_BYTES:
            os.replace(path, ROOT / "events.jsonl.1")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a") as out:
            out.write(line)

class MetadataLogger(CustomLogger):
    def __init__(self):
        super().__init__(turn_off_message_logging=True)

    async def async_pre_call_deployment_hook(self, kwargs, call_type):
        event(kwargs, "attempt")
        return None

    async def async_post_call_failure_deployment_hook(self, request_data, exception, call_type, fallback_depth=None):
        event(request_data, "failure", getattr(exception, "status_code", None))

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        event(kwargs, "success", 200, response_obj)

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        # Deployment hook owns failure/attempt counting; request-level errors may be local.
        return None

logger = MetadataLogger()
