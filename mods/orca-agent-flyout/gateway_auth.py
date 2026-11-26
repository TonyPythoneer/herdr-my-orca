"""Inference-only authentication for the loopback LiteLLM proxy."""
import hmac
import json
import os
from pathlib import Path
from litellm.proxy._types import UserAPIKeyAuth

ROOT = Path(os.environ["HERDR_GATEWAY_DIR"])
KEY = os.environ["HERDR_GATEWAY_KEY"]
MODELS = list(json.loads((ROOT / "routes.json").read_text()))

async def user_api_key_auth(_request, api_key):
    if not isinstance(api_key, str) or not hmac.compare_digest(api_key, KEY):
        raise Exception("Invalid API key")
    return UserAPIKeyAuth(api_key=api_key, models=MODELS)
