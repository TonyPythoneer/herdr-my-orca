#!/usr/bin/env python3
"""Local-only LiteLLM lifecycle. Invoked by the managed Model Provider launch."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.parse

VERSION = "1.111.0"

def read(path):
    return json.loads(path.read_text())

def private_write(path, value):
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as out:
        os.fchmod(out.fileno(), 0o600)
        json.dump(value, out)
        out.write("\n")
    os.replace(tmp, path)

def alias_for(provider, model):
    return "herdr-" + hashlib.sha256(json.dumps([provider, model], ensure_ascii=False).encode()).hexdigest()[:32]

def routes_for(records):
    routes = {}
    for provider, record in records.items():
        host = record.get("host", "")
        parsed = urllib.parse.urlsplit(host)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            continue
        for model in record.get("models", []):
            if not isinstance(model, str) or not model:
                continue
            alias = alias_for(provider, model)
            routes[alias] = dict(provider=provider, model=model, host=host.rstrip("/"),
                                 api_key=record.get("apiKey") or "")
    return routes

def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False

def ready(state, aliases):
    try:
        req = urllib.request.Request(state["url"] + "/v1/models",
                                     headers={"Authorization": "Bearer " + state["key"]})
        with urllib.request.urlopen(req, timeout=1) as response:
            models = json.load(response)
        return set(aliases).issubset({x["id"] for x in models["data"]})
    except (OSError, ValueError, KeyError, TypeError):
        return False

def settings(app):
    path = app / "model-gateway.json"
    return read(path).get("enabled") is True if path.exists() else False

def config_for(routes, key):
    entries = []
    for alias, route in routes.items():
        # Saved providers expose OpenAI-compatible /models. Keep the exact upstream model.
        # LiteLLM requires an API key for this adapter; anonymous support is verified separately.
        params = {"model": "openai/" + route["model"], "api_base": route["host"],
                  "api_key": route["api_key"] or "herdr-anonymous", "num_retries": 0,
                  "max_retries": 0}
        entries.append({"model_name": alias, "litellm_params": params,
                        "model_info": {"id": alias}})
    return {"model_list": entries,
            "router_settings": {"num_retries": 0, "fallbacks": [], "context_window_fallbacks": [],
                                "content_policy_fallbacks": [], "disable_cooldowns": True},
            "litellm_settings": {"callbacks": ["gateway_logger.logger"], "telemetry": False,
                                 "turn_off_message_logging": True, "num_retries": 0},
            "general_settings": {"master_key": key, "disable_spend_logs": True}}

def prepare(app, provider, model, expected_host, kind):
    if not settings(app):
        return {"direct": True}
    records = read(app / "model-providers.json")
    record = records.get(provider, {})
    if record.get("host") != expected_host:
        raise RuntimeError("Model provider changed. Reopen the agent picker.")
    routes = routes_for(records)
    alias = alias_for(provider, model)
    if alias not in routes:
        raise RuntimeError("Selected model is not in the saved provider catalog.")
    if not routes[alias]["api_key"]:
        raise RuntimeError("This LiteLLM integration requires a provider API key; anonymous authentication is not yet verified.")
    root = app / "litellm-gateway"
    root.mkdir(mode=0o700, exist_ok=True)
    root.chmod(0o700)
    fingerprint = hashlib.sha256(json.dumps(routes, sort_keys=True).encode()).hexdigest()
    with open(root / "lock", "a") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        state_file = root / "state.json"
        state = read(state_file) if state_file.exists() else {}
        if state and alive(state.get("pid")):
            if state.get("fingerprint") != fingerprint:
                raise RuntimeError("Gateway configuration changed. Close managed sessions and stop the local gateway before relaunching.")
            if not ready(state, routes):
                raise RuntimeError("Local gateway is not ready. Stop it after closing managed sessions, then retry.")
        else:
            binary = root / "venv/bin/litellm"
            if not binary.is_file():
                raise RuntimeError("Install the local LiteLLM environment: python3 -m venv <appHome>/litellm-gateway/venv; <appHome>/litellm-gateway/venv/bin/pip install 'litellm[proxy]==" + VERSION + "'.")
            version = subprocess.run([str(root / "venv/bin/python"), "-c",
                                      "import importlib.metadata as m; print(m.version('litellm'))"],
                                     capture_output=True, text=True, timeout=10)
            if version.returncode or version.stdout.strip() != VERSION:
                raise RuntimeError("Install the pinned LiteLLM version " + VERSION + " in the gateway venv.")
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            key = "sk-" + secrets.token_hex(32)
            state = {"url": "http://127.0.0.1:" + str(port), "key": key, "fingerprint": fingerprint}
            private_write(root / "config.json", config_for(routes, key))
            private_write(root / "routes.json", {a: {"provider": r["provider"], "model": r["model"],
                                                    "kilo": urllib.parse.urlsplit(r["host"]).hostname == "ai-gateway.kilo.ai"}
                                                  for a, r in routes.items()})
            env = dict(os.environ, HERDR_GATEWAY_DIR=str(root), LITELLM_TELEMETRY="False",
                       PYTHONPATH=str(Path(__file__).resolve().parent))
            process = subprocess.Popen([str(binary), "--config", str(root / "config.json"),
                                        "--host", "127.0.0.1", "--port", str(port), "--num_workers", "1"],
                                       cwd=root, env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            state["pid"] = process.pid
            private_write(state_file, state)
            for _ in range(120):
                if process.poll() is not None:
                    break
                if ready(state, routes):
                    break
                time.sleep(.25)
            else:
                process.terminate()
                raise RuntimeError("LiteLLM did not become ready.")
            if not ready(state, routes):
                if process.poll() is None:
                    process.terminate()
                raise RuntimeError("LiteLLM failed to start or authenticate.")
        # Existing launcher reads the local credential from a private file; never place it in argv.
        credentials = root / "credentials.json"
        private_write(credentials, {"openai": {"host": state["url"] + "/v1", "apiKey": state["key"]},
                                    "claude": {"host": state["url"], "apiKey": state["key"]}})
        selected = {r["model"]: a for a, r in routes.items() if r["provider"] == provider and r["api_key"]}
        credential_id = "claude" if kind == "claude" else "openai"
        return {"host": state["url"] + ("" if kind == "claude" else "/v1"),
                "configPath": str(credentials), "id": credential_id, "aliases": selected, "model": alias}

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("action", choices=["prepare", "enable", "disable"])
    parser.add_argument("args", nargs="*")
    ns = parser.parse_args()
    try:
        if ns.action == "prepare":
            result = prepare(ns.app, *ns.args)
        else:
            private_write(ns.app / "model-gateway.json", {"enabled": ns.action == "enable"})
            result = {"enabled": ns.action == "enable"}
        print(json.dumps(result))
    except RuntimeError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
    except Exception:
        # Do not print raw provider config, exception bodies or credentials.
        print(json.dumps({"error": "Could not prepare local LiteLLM gateway. Check local installation and configuration."}))
        sys.exit(1)

if __name__ == "__main__":
    main()
