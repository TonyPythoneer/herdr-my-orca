#!/usr/bin/env python3
"""Self-check for the quickstart mode in litellm_gateway.py. No network, no real CLI, temp dirs only."""
import importlib.util
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest.mock as mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "mods/orca-agent-flyout/litellm_gateway.py"
spec = importlib.util.spec_from_file_location("lg", GATEWAY)
lg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lg)

KEY = "sk-test-0000000000000000"
QUICK = {"host": "http://127.0.0.1:4000", "apiKey": KEY}


def quickstart_dir(env_text=None, port=4000):
    """A fake quickstart folder: a CLI that names the folder, and a .env (or none)."""
    folder = pathlib.Path(tempfile.mkdtemp())
    cli = folder / "litellm-gateway"
    cli.write_text(f"#!/bin/sh\nexport LITELLM_DIR='{folder}'\n")
    cli.chmod(0o755)
    if env_text is not None:
        (folder / ".env").write_text(env_text)
    return folder, cli


def run_gateway(app, *args):
    """Run the real script in a subprocess, as the mod does, and return (exit code, parsed stdout)."""
    # A clean HOME and PATH, so the real quickstart on this Mac is never seen: the test must not depend on it.
    home = tempfile.mkdtemp()
    done = subprocess.run([sys.executable, "-I", str(GATEWAY), str(app), *args], capture_output=True, text=True, timeout=30,
                          env={"PATH": "/usr/bin:/bin", "HOME": home})
    return done.returncode, json.loads(done.stdout)


# .env parsing: the last key line wins, the port comes from the file, and a missing port means 4000.
ENV = f"LITELLM_MASTER_KEY=sk-old\nLITELLM_PORT=4010\nLITELLM_MASTER_KEY={KEY}\n"
assert lg.quickstart_settings(ENV) == {"host": "http://127.0.0.1:4010", "apiKey": KEY}
assert lg.quickstart_settings("LITELLM_MASTER_KEY=" + KEY)["host"] == "http://127.0.0.1:4000"
assert lg.quickstart_settings("LITELLM_PORT=4000\n") is None
assert lg.quickstart_settings("LITELLM_MASTER_KEY=" + KEY + "\nLITELLM_PORT=40x0") is None
assert lg.quickstart_settings("LITELLM_MASTER_KEY=" + KEY + "\nLITELLM_PORT=²") is None  # other Unicode digits must not crash int()

# Quickstart resolution: the .env is read only when the running CLI reports the same port; anything odd is refused.
folder, cli = quickstart_dir(f"LITELLM_MASTER_KEY={KEY}\nLITELLM_PORT=4000\n")
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": True, "cli": str(cli), "port": 4000}):
    got = lg.quickstart_remote()
    assert {k: v for k, v in got.items() if k != "env"} == QUICK
    assert got["env"].endswith("/.env"), got  # the wrapper reads the key from this file at launch
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": True, "cli": str(cli), "port": 4999}):
    assert lg.quickstart_remote() is None, "a different listener port must not receive the key"
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": False, "cli": str(cli), "port": 4000}):
    assert lg.quickstart_remote() is None
folder, cli = quickstart_dir()
(folder / ".env").mkdir()  # a directory where the .env should be
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": True, "cli": str(cli), "port": 4000}):
    assert lg.quickstart_remote() is None
folder, cli = quickstart_dir()
(folder / ".env").write_bytes(b"\xff\xfe LITELLM_MASTER_KEY=x")  # not UTF-8: unavailable, not a crash
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": True, "cli": str(cli), "port": 4000}):
    assert lg.quickstart_remote() is None

# The real status box says "Admin UI:" with a colon; the port parsed from it must be 4000.
fake_dir = pathlib.Path(tempfile.mkdtemp())
fake = fake_dir / "litellm-gateway"
fake.write_text("#!/bin/sh\necho 'LiteLLM is running'\necho '  Admin UI:   http://localhost:4000/ui'\n")
fake.chmod(0o755)
with mock.patch.object(lg.shutil, "which", return_value=str(fake)):
    assert lg.local_quickstart_status()["port"] == 4000

# remote_settings: Existing is used as saved; quickstart is resolved, or refused with a clear message.
saved = {"mode": "remote", "host": "https://gw.example.com", "apiKey": "sk-saved"}
assert lg.remote_settings(saved) is saved
with mock.patch.object(lg, "quickstart_remote", return_value=QUICK):
    resolved = lg.remote_settings({"mode": "quickstart"})
    assert {k: v for k, v in resolved.items() if k != "env"} == {"host": QUICK["host"], "apiKey": KEY, "mode": "quickstart", "source": "quickstart"}
with mock.patch.object(lg, "quickstart_remote", return_value=None):
    try:
        lg.remote_settings({"mode": "quickstart"})
        raise AssertionError("quickstart without a running gateway must refuse")
    except RuntimeError as error:
        assert "quickstart" in str(error)

# Health: a server that echoes the key is unhealthy; quickstart never goes through a proxy; models are listed.
class FakeResponse:
    def __init__(self, body): self.body = io.BytesIO(json.dumps(body).encode())
    def __enter__(self): return self.body
    def __exit__(self, *exc): return False
class FakeOpener:
    def __init__(self, body): self.body = body
    def open(self, req, timeout): return FakeResponse(self.body)
seen = []
def fake_build(body):
    def build(*handlers):
        seen.append(handlers)
        return FakeOpener(body)
    return build
with mock.patch.object(lg.urllib.request, "build_opener", fake_build({"data": [{"id": "echo-" + KEY}]})):
    assert lg.remote_health({**QUICK, "source": "quickstart"})["healthy"] is False
with mock.patch.object(lg.urllib.request, "build_opener", fake_build({"data": [{"id": "m1"}]})):
    assert lg.remote_health({**QUICK, "source": "quickstart"})["models"] == ["m1"]
    assert any(isinstance(h, lg.urllib.request.ProxyHandler) and h.proxies == {} for h in seen[-1])
    assert lg.remote_health({"host": "https://gw.example.com", "apiKey": KEY})["models"] == ["m1"]
    assert not any(isinstance(h, lg.urllib.request.ProxyHandler) and h.proxies == {} for h in seen[-1])

# Existing saves: a saved key is never sent to a newly typed host, and localhost gets no special case.
app = pathlib.Path(tempfile.mkdtemp())
(app / "model-gateway.json").write_text(json.dumps({"enabled": False, "mode": "remote",
                                                    "host": "https://a.example.com", "apiKey": "sk-saved"}))
calls = []
def health(config):
    calls.append(config)
    return {"healthy": True, "models": ["m1"]}
(app / "staged.json").write_text(json.dumps({"host": "https://b.example.com", "apiKey": ""}))
with mock.patch.object(lg, "remote_health", side_effect=health):
    try:
        lg.save_remote(app, app / "staged.json")
        raise AssertionError("saved key was offered to a new host")
    except RuntimeError as error:
        assert "Enter a LiteLLM API key" in str(error) and not calls, error
(app / "staged.json").write_text(json.dumps({"host": "http://localhost:4000", "apiKey": ""}))
with mock.patch.object(lg, "remote_health", side_effect=health):
    try:
        lg.save_remote(app, app / "staged.json")
        raise AssertionError("localhost without a key must not borrow the quickstart")
    except RuntimeError as error:
        assert "Enter a LiteLLM API key" in str(error) and not calls, error

# Quickstart stores only its mode: switching clears any saved host and key, and the key never reaches the file.
app = pathlib.Path(tempfile.mkdtemp())
(app / "model-gateway.json").write_text(json.dumps({"enabled": False, "mode": "remote",
                                                    "host": "https://a.example.com", "apiKey": "sk-saved"}))
code, result = run_gateway(app, "quickstart")
stored = (app / "model-gateway.json").read_text()
assert code == 0 and json.loads(stored) == {"enabled": False, "mode": "quickstart"}, (code, stored)
assert "sk-saved" not in stored and result == {"enabled": False, "mode": "quickstart"}

# Enabling quickstart without a running gateway is refused with a clear message, and nothing is changed.
code, result = run_gateway(app, "enable")
assert code == 1 and "quickstart" in result["error"], (code, result)
assert json.loads((app / "model-gateway.json").read_text()) == {"enabled": False, "mode": "quickstart"}

# Status in quickstart mode never includes the key, with or without a running gateway.
with mock.patch.object(lg, "quickstart_remote", return_value=None):
    body = lg.status(app)
    assert body["mode"] == "quickstart" and body["remote"]["healthy"] is False and body["hasApiKey"] is False
with mock.patch.object(lg, "quickstart_remote", return_value=QUICK), \
     mock.patch.object(lg, "remote_health", return_value={"healthy": True, "models": ["m1"]}):
    body = lg.status(app)
    assert body["host"] == QUICK["host"] and body["hasApiKey"] is True and KEY not in json.dumps(body)

# An indented or repeated .env line: the last one wins, as in the launch wrapper.
folder2, cli2 = quickstart_dir(f"LITELLM_MASTER_KEY=sk-old\n  LITELLM_MASTER_KEY={KEY}\n  LITELLM_PORT=4000  \n")
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": True, "cli": str(cli2), "port": 4000}):
    assert lg.quickstart_remote()["apiKey"] == KEY

# prepare() in quickstart mode points the launch at the quickstart's own .env and writes nothing of ours.
qapp = pathlib.Path(tempfile.mkdtemp())
(qapp / "model-gateway.json").write_text(json.dumps({"enabled": True, "mode": "quickstart"}))
(qapp / "model-providers.json").write_text(json.dumps({"p1": {"host": "http://127.0.0.1:4000", "models": ["m1"]}}))
folder, cli = quickstart_dir(f"LITELLM_MASTER_KEY={KEY}\nLITELLM_PORT=4000\n")
with mock.patch.object(lg, "local_quickstart_status", return_value={"running": True, "cli": str(cli), "port": 4000}), \
     mock.patch.object(lg, "remote_health", return_value={"healthy": True, "models": ["m1"]}):
    result = lg.prepare(qapp, "p1", "m1", "http://127.0.0.1:4000", "codex")
assert result["configPath"] == str(folder / ".env"), result
assert result["host"] == "http://127.0.0.1:4000/v1", result
assert not (qapp / "litellm-gateway" / "credentials.json").exists(), "quickstart must not copy the key"
assert KEY not in json.dumps(result)

print("litellm quickstart self-check: ok")
