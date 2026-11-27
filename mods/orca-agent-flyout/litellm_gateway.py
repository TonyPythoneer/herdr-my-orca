#!/usr/bin/env python3
"""Local-only LiteLLM lifecycle. Invoked by the managed Model Provider launch."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
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
    if value["mode"] not in ("local", "remote", "quickstart"):
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
        # The quickstart is local: never let a proxy from the environment or the system see the key.
        handlers = [urllib.request.ProxyHandler({})] if config.get("source") == "quickstart" else []
        opener = urllib.request.build_opener(NoRedirect(), *handlers)
        with opener.open(req, timeout=8) as response:
            payload = json.load(response)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            return {"healthy": False, "error": "LiteLLM returned an invalid model list."}
        models = sorted({item["id"] for item in payload.get("data", [])
                         if isinstance(item, dict) and isinstance(item.get("id"), str)})
        if any(key in model for model in models):  # a server must not echo the key back through its catalog
            return {"healthy": False, "error": "LiteLLM returned an invalid model list."}
        # Liveness is not readiness: an empty catalog still proves the server is alive.
        return {"healthy": True, "models": models}
    except urllib.error.HTTPError as error:
        return {"healthy": False, "error": f"LiteLLM returned HTTP {error.code}. Check the host and API key."}
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        return {"healthy": False, "error": "Could not connect to LiteLLM. Check the host and network."}

def local_quickstart_status():
    cli = shutil.which("litellm-gateway") or str(Path.home() / ".local/bin/litellm-gateway")
    if not Path(cli).is_file() or not os.access(cli, os.X_OK):
        return None
    try:
        result = subprocess.run([cli, "status"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError, ValueError):  # ValueError: output that is not UTF-8
        return {"cli": cli, "installed": True, "running": False, "usable": False}
    output = result.stdout or result.stderr
    running = result.returncode == 0 and "LiteLLM is running" in output
    version = next((line.split(":", 1)[1].strip() for line in output.splitlines()
                    if line.strip().startswith("Version:")), None)
    admin = re.search(r"Admin UI:?\s+https?://[^:\s/]+:(\d+)", output)  # the port the running server reports
    return {"cli": cli, "installed": True, "running": running, "version": version, "usable": running,
            "port": int(admin.group(1)) if admin else None}

def local_status(app):
    root = app / "litellm-gateway"
    binary = root / "venv/bin/litellm"
    python = root / "venv/bin/python"
    cli = str(binary) if binary.is_file() else shutil.which("litellm")
    state = read(root / "state.json") if (root / "state.json").exists() else {}
    running = bool(state and alive(state.get("pid")))
    routes = read(root / "routes.json") if (root / "routes.json").exists() else {}
    healthy = running and ready(state, routes)
    installed = binary.is_file() and python.is_file()
    usable = installed and (not running or healthy)
    return {"cli": cli,
            "installed": installed, "usable": usable, "running": running,
            "healthy": healthy,
            "quickstart": local_quickstart_status()}

def quickstart_settings(text):
    """Host and master key from the quickstart's .env text: the last line wins, the port defaults to 4000."""
    values = {}
    for line in text.splitlines():
        found = re.match(r"^(LITELLM_MASTER_KEY|LITELLM_PORT)=(.*)$", line.strip())
        if found:
            values[found.group(1)] = found.group(2).strip()  # the shell wrapper strips the same way
    key = values.get("LITELLM_MASTER_KEY", "")
    port = values.get("LITELLM_PORT") or "4000"
    if not key or not (port.isascii() and port.isdigit()):  # isdigit alone accepts other Unicode digits, which int() rejects
        return None
    return {"host": f"http://127.0.0.1:{port}", "apiKey": key}

def quickstart_remote():
    """The running quickstart gateway's host and key, read from its folder each time. Never saved."""
    status = local_quickstart_status()
    if not status or not status.get("running") or not status.get("cli"):
        return None
    try:
        # The CLI that reported "running" is the one whose folder we read; the .env must be a regular file.
        folder = re.search(r"^export LITELLM_DIR='([^']+)'", Path(status["cli"]).read_text(), re.M)
        env_path = Path(folder.group(1)) / ".env" if folder else None
        if env_path is None or not env_path.is_file():  # a FIFO or a directory would block or fail
            return None
        settings = quickstart_settings(env_path.read_text())
    except (OSError, ValueError):
        return None
    # The key goes only to the port the running server reports, so a different listener never gets it.
    if not settings or status.get("port") != int(settings["host"].rsplit(":", 1)[1]):
        return None
    return {**settings, "env": str(env_path)}  # the wrapper reads the key from this file at launch

def remote_settings(config):
    """What a remote-type mode talks to. Existing uses its saved host and key; quickstart reads them each time, never saved."""
    if config.get("mode") != "quickstart":
        return config
    source = quickstart_remote()
    if source is None:
        raise RuntimeError("Start the LiteLLM quickstart on this Mac first.")
    return {**source, "mode": "quickstart", "source": "quickstart"}

def status(app):
    config = settings(app)
    if config.get("mode") in ("remote", "quickstart"):
        try:
            resolved = remote_settings(config)
            remote = remote_health(resolved)
        except RuntimeError as error:
            resolved, remote = {}, {"healthy": False, "error": str(error)}
        return {"enabled": config.get("enabled") is True, "mode": config["mode"], "host": resolved.get("host", config.get("host", "")),
                "hasApiKey": bool(resolved.get("apiKey")), "remote": remote}
    return {"enabled": config.get("enabled") is True, "mode": "local", "local": local_status(app)}

def save_remote(app, staged):
    incoming = read(staged)
    if not isinstance(incoming, dict):
        raise RuntimeError("Existing LiteLLM settings are invalid.")
    previous = settings(app)
    host = remote_root(incoming.get("host", ""))
    key = incoming.get("apiKey")
    # A saved key is reused only for the host it was saved with, never sent to a newly typed one.
    if not key and previous.get("apiKey") and previous.get("host") == host:
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
    if config.get("mode") in ("remote", "quickstart"):
        config = remote_settings(config)
        remote = remote_health(config)
        if not remote.get("healthy"):
            raise RuntimeError(remote.get("error", "The existing LiteLLM server is unavailable."))
        if model not in remote["models"]:
            raise RuntimeError("Selected model is not available on the existing LiteLLM server.")
        root = remote_root(config["host"])
        if config.get("mode") == "quickstart":
            # The quickstart's own .env already holds the master key; reading it there copies nothing.
            configured = config["env"]
        else:
            credentials = app / "litellm-gateway/credentials.json"
            credentials.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            credentials.parent.chmod(0o700)
            private_write(credentials, {"openai": {"host": root + "/v1", "apiKey": config["apiKey"]},
                                        "claude": {"host": root, "apiKey": config["apiKey"]}})
            configured = str(credentials)
        selected = {r["model"]: r["model"] for r in routes.values()
                    if r["provider"] == provider and r["model"] in remote["models"]}
        return {"host": root + ("" if kind == "claude" else "/v1"),
                "configPath": configured, "id": "claude" if kind == "claude" else "openai",
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
            local = local_status(app)
            if not local.get("installed"):
                raise RuntimeError("The pinned local LiteLLM install is missing or cannot start. Install or repair version " + VERSION + " in the gateway venv before launching.")
            binary = root / "venv/bin/litellm"
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
                       LITELLM_LOCAL_MODEL_COST_MAP="True", LITELLM_MASTER_KEY=key,
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
    parser.add_argument("action", choices=["prepare", "enable", "disable", "local", "remote", "quickstart", "status", "save-remote", "stop"])
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
                if ns.action == "enable" and config.get("mode") in ("remote", "quickstart"):
                    remote = remote_health(remote_settings(config))
                    if not remote.get("healthy"):
                        raise RuntimeError(remote.get("error", "The existing LiteLLM server is unavailable."))
                    if not remote.get("models"):
                        raise RuntimeError("The LiteLLM server advertises no models; add one before enabling it.")
                if ns.action == "enable" and config.get("mode") == "local":
                    local = local_status(ns.app)
                    if not local.get("installed"):
                        raise RuntimeError("The pinned local LiteLLM install is missing or cannot start. Install or repair version " + VERSION + " in the gateway venv before enabling it.")
                config["enabled"] = ns.action == "enable"
            else:
                if config.get("enabled") is True and config.get("mode") != ns.action:
                    raise RuntimeError("Turn LiteLLM off before changing its connection mode.")
                config["mode"] = ns.action
                if ns.action == "quickstart":  # stores only the mode; host and key are read from the quickstart each time
                    config = {"enabled": config.get("enabled") is True, "mode": "quickstart"}
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
