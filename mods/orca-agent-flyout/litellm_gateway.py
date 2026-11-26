#!/usr/bin/env python3
"""Local-only LiteLLM lifecycle. Invoked by the managed Model Provider launch."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse
import urllib.error

VERSION = "1.111.0"

def read(path):
    return json.loads(path.read_text())

def private_write(path, value):
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as out:
            os.fchmod(out.fileno(), 0o600)
            json.dump(value, out)
            out.write("\n")
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)

def alias_for(provider, model):
    return "herdr-" + hashlib.sha256(json.dumps([provider, model], ensure_ascii=False).encode()).hexdigest()[:32]

def routes_for(records):
    routes = {}
    for provider, record in records.items():
        if not isinstance(provider, str) or not isinstance(record, dict):
            continue
        host = record.get("host", "")
        if not isinstance(host, str):
            continue
        try:
            parsed = urllib.parse.urlsplit(host)
            hostname = parsed.hostname
        except ValueError:
            continue
        if parsed.scheme not in ("http", "https") or not hostname or parsed.username or parsed.password:
            continue
        models = record.get("models", [])
        if not isinstance(models, list):
            continue
        for model in models:
            if not isinstance(model, str) or not model:
                continue
            alias = alias_for(provider, model)
            routes[alias] = dict(provider=provider, model=model, host=host.rstrip("/"),
                                 api_key=record.get("apiKey") if isinstance(record.get("apiKey"), str) else "")
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
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=1) as response:
            models = json.load(response)
        return set(aliases).issubset({x["id"] for x in models["data"]})
    except (OSError, ValueError, KeyError, TypeError):
        return False

def settings(app):
    path = app / "model-gateway.json"
    if not path.exists():
        return {"enabled": False, "mode": "local"}
    value = read(path)
    if not isinstance(value, dict):
        raise RuntimeError("LiteLLM settings are invalid.")
    value.setdefault("mode", "local")
    if value["mode"] not in ("local", "remote"):
        raise RuntimeError("LiteLLM connection mode is invalid.")
    return value

def remote_root(host):
    if not isinstance(host, str):
        raise RuntimeError("Enter a valid LiteLLM API host.")
    try:
        parsed = urllib.parse.urlsplit(host.strip().rstrip("/"))
        hostname = parsed.hostname
    except ValueError as error:
        raise RuntimeError("Enter a valid LiteLLM API host.") from error
    if (parsed.scheme not in ("http", "https") or not hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise RuntimeError("Enter a valid LiteLLM API host, such as https://litellm.example.com.")
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Existing LiteLLM hosts must use HTTPS.")
    path = parsed.path.rstrip("/")
    if path.endswith("/v1"):
        path = path[:-3]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", "")).rstrip("/")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        return None

def remote_health(config):
    host = config.get("host", "")
    key = config.get("apiKey", "")
    if not isinstance(key, str) or not key:
        return {"healthy": False, "error": "Enter a LiteLLM API key."}
    try:
        root = remote_root(host)
        req = urllib.request.Request(root + "/v1/models", headers={"Authorization": "Bearer " + key})
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(req, timeout=8) as response:
            payload = json.load(response)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            return {"healthy": False, "error": "LiteLLM returned an invalid model list."}
        models = sorted({item["id"] for item in payload.get("data", [])
                         if isinstance(item, dict) and isinstance(item.get("id"), str)})
        # Liveness is not readiness: an empty catalog still proves the server is alive.
        return {"healthy": True, "models": models}
    except urllib.error.HTTPError as error:
        return {"healthy": False, "error": f"LiteLLM returned HTTP {error.code}. Check the host and API key."}
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        return {"healthy": False, "error": "Could not connect to LiteLLM. Check the host and network."}

def local_status(app):
    root = app / "litellm-gateway"
    binary = root / "venv/bin/litellm"
    python = root / "venv/bin/python"
    inherited = ("PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SSL_CERT_FILE", "SSL_CERT_DIR",
                 "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE")
    cli_env = {name: os.environ[name] for name in inherited if name in os.environ}
    version = None
    if binary.is_file() and python.is_file():
        try:
            result = subprocess.run([str(python), "-c", "import importlib.metadata as m; print(m.version('litellm'))"],
                                    capture_output=True, text=True, timeout=10, env=cli_env)
            if result.returncode == 0:
                version = result.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    cli = str(binary) if binary.is_file() else shutil.which("litellm")
    cli_version = None
    if cli:
        try:
            result = subprocess.run([cli, "--version"], capture_output=True, text=True, timeout=5, env=cli_env)
            lines = (result.stdout or result.stderr).strip().splitlines()
            cli_version = lines[0] if result.returncode == 0 and lines else None
        except (OSError, subprocess.SubprocessError):
            pass
    if version is None:
        version = cli_version
    state = read(root / "state.json") if (root / "state.json").exists() else {}
    running = bool(state and alive(state.get("pid")))
    routes = read(root / "routes.json") if (root / "routes.json").exists() else {}
    return {"cli": cli, "version": version, "cliVersion": cli_version,
            "requiredVersion": VERSION,
            "installed": version == VERSION and binary.is_file(), "running": running,
            "healthy": running and ready(state, routes)}

def status(app):
    config = settings(app)
    if config.get("mode") == "remote":
        remote = remote_health(config)
        return {"enabled": config.get("enabled") is True, "mode": "remote", "host": config.get("host", ""),
                "hasApiKey": bool(config.get("apiKey")), "remote": remote}
    return {"enabled": config.get("enabled") is True, "mode": "local", "local": local_status(app)}

def save_remote(app, staged):
    incoming = read(staged)
    if not isinstance(incoming, dict):
        raise RuntimeError("Existing LiteLLM settings are invalid.")
    host = remote_root(incoming.get("host", ""))
    key = incoming.get("apiKey")
    previous = settings(app)
    if not key and previous.get("apiKey"):
        key = previous["apiKey"]
    if not isinstance(key, str) or not key:
        raise RuntimeError("Enter a LiteLLM API key.")
    if any(char in key for char in "\r\n"):
        raise RuntimeError("The LiteLLM API key contains an invalid line break.")
    candidate = {"enabled": previous.get("enabled") is True, "mode": "remote", "host": host, "apiKey": key}
    remote = remote_health(candidate)
    if not remote.get("healthy"):
        raise RuntimeError(remote.get("error", "Could not connect to the existing LiteLLM server."))
    private_write(app / "model-gateway.json", candidate)
    return {"enabled": candidate["enabled"], "mode": "remote", "host": host,
            "hasApiKey": True, "remote": remote}

def config_for(routes):
    entries = []
    for alias, route in routes.items():
        # Keep the exact upstream model; custom_openai bridges agent APIs to chat completions.
        # LiteLLM requires an API key for this adapter; anonymous support is verified separately.
        params = {"model": "custom_openai/" + route["model"], "api_base": route["host"],
                  "api_key": route["api_key"] or "herdr-anonymous", "num_retries": 0,
                  "max_retries": 0}
        entries.append({"model_name": alias, "litellm_params": params,
                        "model_info": {"id": alias}})
    return {"model_list": entries,
            "router_settings": {"num_retries": 0, "fallbacks": [], "context_window_fallbacks": [],
                                "content_policy_fallbacks": [], "disable_cooldowns": True},
            "litellm_settings": {"callbacks": ["gateway_logger.logger"], "telemetry": False,
                                 "turn_off_message_logging": True, "num_retries": 0,
                                 "enable_post_custom_auth_checks": True},
            "general_settings": {"custom_auth": "gateway_auth.user_api_key_auth",
                                 "custom_auth_settings": {"mode": "on"},
                                 "custom_auth_run_common_checks": True,
                                 "disable_spend_logs": True}}

def prepare(app, provider, model, expected_host, kind):
    config = settings(app)
    if config.get("enabled") is not True:
        return {"direct": True}
    records = read(app / "model-providers.json")
    if not isinstance(records, dict):
        raise RuntimeError("Saved model providers are invalid.")
    record = records.get(provider, {})
    if not isinstance(record, dict):
        raise RuntimeError("Selected model provider is invalid. Reopen the agent picker.")
    if record.get("host") != expected_host:
        raise RuntimeError("Model provider changed. Reopen the agent picker.")
    routes = routes_for(records)
    alias = alias_for(provider, model)
    if alias not in routes:
        raise RuntimeError("Selected model is not in the saved provider catalog.")
    if config.get("mode") == "remote":
        remote = remote_health(config)
        if not remote.get("healthy"):
            raise RuntimeError(remote.get("error", "The existing LiteLLM server is unavailable."))
        if model not in remote["models"]:
            raise RuntimeError("Selected model is not available on the existing LiteLLM server.")
        root = remote_root(config["host"])
        credentials = app / "litellm-gateway/credentials.json"
        credentials.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        credentials.parent.chmod(0o700)
        private_write(credentials, {"openai": {"host": root + "/v1", "apiKey": config["apiKey"]},
                                    "claude": {"host": root, "apiKey": config["apiKey"]}})
        selected = {r["model"]: r["model"] for r in routes.values()
                    if r["provider"] == provider and r["model"] in remote["models"]}
        return {"host": root + ("" if kind == "claude" else "/v1"),
                "configPath": str(credentials), "id": "claude" if kind == "claude" else "openai",
                "aliases": selected, "model": model}
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
                raise RuntimeError("Local LiteLLM is not installed. See the local gateway setup in docs/designs/litellm-local-provider-observability.md.")
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
            private_write(root / "config.yaml", config_for(routes))
            private_write(root / "routes.json", {a: {"provider": r["provider"], "model": r["model"],
                                                    "kilo": urllib.parse.urlsplit(r["host"]).hostname == "ai-gateway.kilo.ai"}
                                                  for a, r in routes.items()})
            inherited = ("PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SSL_CERT_FILE", "SSL_CERT_DIR",
                         "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                         "http_proxy", "https_proxy", "all_proxy")
            env = {name: os.environ[name] for name in inherited if name in os.environ}
            env.update(HERDR_GATEWAY_DIR=str(root), LITELLM_TELEMETRY="False",
                       HERDR_GATEWAY_KEY=key,
                       PYTHONPATH=str(Path(__file__).resolve().parent),
                       LITELLM_RUST_FIRST="false", LITELLM_RUST="false",
                       NO_PROXY="127.0.0.1,localhost,::1", no_proxy="127.0.0.1,localhost,::1")
            process = subprocess.Popen([str(binary), "--config", str(root / "config.yaml"),
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

def stop(app):
    """Explicit operator action only, after managed agents have been closed."""
    root = app / "litellm-gateway"
    if not root.exists():
        return {"stopped": True}
    with open(root / "lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state_file = root / "state.json"
        if not state_file.exists():
            for name in ("config.yaml", "credentials.json"):
                (root / name).unlink(missing_ok=True)
            return {"stopped": True}
        state = read(state_file)
        pid = state.get("pid")
        if alive(pid):
            if not ready(state, read(root / "routes.json")) or os.getpgid(pid) != pid:
                raise RuntimeError("Cannot verify gateway ownership; inspect the saved process manually.")
            os.kill(pid, signal.SIGTERM)
            for _ in range(50):
                if not alive(pid):
                    break
                time.sleep(.2)
            else:
                raise RuntimeError("Gateway did not stop.")
        state_file.unlink(missing_ok=True)
        for name in ("config.yaml", "credentials.json"):
            (root / name).unlink(missing_ok=True)
        return {"stopped": True}

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("action", choices=["prepare", "enable", "disable", "local", "remote", "status", "save-remote", "stop"])
    parser.add_argument("args", nargs="*")
    ns = parser.parse_args()
    try:
        if ns.action == "prepare":
            result = prepare(ns.app, *ns.args)
        elif ns.action == "stop":
            result = stop(ns.app)
        elif ns.action == "status":
            result = status(ns.app)
        elif ns.action == "save-remote":
            result = save_remote(ns.app, Path(ns.args[0]))
        else:
            config = settings(ns.app)
            if ns.action in ("enable", "disable"):
                if ns.action == "enable" and config.get("mode") == "remote":
                    remote = remote_health(config)
                    if not remote.get("healthy"):
                        raise RuntimeError(remote.get("error", "The existing LiteLLM server is unavailable."))
                    if not remote.get("models"):
                        raise RuntimeError("The existing LiteLLM server advertises no models; add one before enabling it.")
                if ns.action == "enable" and config.get("mode") != "remote":
                    if not local_status(ns.app).get("installed"):
                        raise RuntimeError("Install the pinned local LiteLLM version before enabling it.")
                config["enabled"] = ns.action == "enable"
            else:
                if config.get("enabled") is True and config.get("mode") != ns.action:
                    raise RuntimeError("Turn LiteLLM off before changing its connection mode.")
                config["mode"] = ns.action
            private_write(ns.app / "model-gateway.json", config)
            result = {"enabled": config.get("enabled") is True, "mode": config.get("mode", "local")}
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
