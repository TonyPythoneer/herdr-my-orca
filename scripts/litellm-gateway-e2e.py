#!/usr/bin/env python3
"""E2E: real local LiteLLM, deterministic HTTP provider, and real usage reader."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
MANAGER = ROOT / "mods/orca-agent-flyout/litellm_gateway.py"
READER = ROOT / "mods/orca-status-bar/gateway-usage.js"
SENTINEL = "fixture-private-content-never-persist"
API_KEY = "fixture-upstream-secret"
MODEL = "fixture/free"

class Upstream(BaseHTTPRequestHandler):
    calls = []
    status = 200
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        self.calls.append((self.path, body, self.headers.get("Authorization")))
        if self.status == 429:
            self.send_json(429, {"error": {"message": "limited " + SENTINEL, "type": "rate_limit_error"}})
            return
        if self.path.endswith("/responses"):
            self.send_json(200, {"id":"resp_fixture","object":"response","created_at":int(time.time()),
                "status":"completed","model":body["model"],"output":[{"id":"msg_fixture","type":"message",
                "role":"assistant","status":"completed","content":[{"type":"output_text","text":SENTINEL,"annotations":[]}]}],
                "usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}})
            return
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for delta, finish in [({"role":"assistant","content":SENTINEL},None),
                                  ({"tool_calls":[{"index":0,"id":"call_fixture","type":"function","function":{"name":"fixture_tool","arguments":"{}"}}]},None),
                                  ({}, "tool_calls")]:
                item = {"id":"chatcmpl_fixture","object":"chat.completion.chunk","created":1,"model":body["model"],
                        "choices":[{"index":0,"delta":delta,"finish_reason":finish}]}
                self.wfile.write(("data: " + json.dumps(item) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            return
        self.send_json(200, {"id":"chatcmpl_fixture","object":"chat.completion","created":1,"model":body["model"],
            "choices":[{"index":0,"message":{"role":"assistant","content":SENTINEL},"finish_reason":"stop"}],
            "usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}})

    def send_json(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

class GatewayE2E(unittest.TestCase):
    def test_local_flow(self):
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(upstream.server_close)
        self.addCleanup(upstream.shutdown)
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            host = "http://127.0.0.1:%s/v1" % upstream.server_port
            (app / "model-providers.json").write_text(json.dumps({
                "fixture": {"host":host,"apiKey":API_KEY,"models":[MODEL]},
                "other": {"host":host,"apiKey":API_KEY,"models":[MODEL]}}))
            local = app / "litellm-gateway"
            local.mkdir()
            (local / "venv").symlink_to(sys.prefix, target_is_directory=True)
            def manager(*args, check=True):
                proc = subprocess.run([sys.executable,str(MANAGER),str(app),*args], capture_output=True,
                                      text=True, timeout=180)
                result = json.loads(proc.stdout)
                if check:
                    self.assertEqual(proc.returncode, 0, result)
                return result
            self.assertEqual(manager("prepare","fixture",MODEL,host,"pi"), {"direct":True})
            manager("enable")
            try:
                route = manager("prepare","fixture",MODEL,host,"pi")
                second = manager("prepare","other",MODEL,host,"codex")
                claude = manager("prepare","fixture",MODEL,host,"claude")
                self.assertEqual(route["host"], second["host"])
                self.assertEqual(route["host"], claude["host"] + "/v1")
                self.assertNotEqual(route["model"], second["model"])
                key = json.loads(Path(route["configPath"]).read_text())["openai"]["apiKey"]
                self.assertNotEqual(key, API_KEY)
                def call(base, path, body, expected=200, credential=key, anthropic=False):
                    headers = {"Content-Type":"application/json","Authorization":"Bearer "+credential}
                    if anthropic:
                        headers["anthropic-version"] = "2023-06-01"
                    req = urllib.request.Request(base+path, data=json.dumps(body).encode(), headers=headers)
                    try:
                        with urllib.request.urlopen(req, timeout=30) as response:
                            self.assertEqual(response.status, expected)
                            return response.read().decode()
                    except urllib.error.HTTPError as error:
                        self.assertEqual(error.code, expected)
                        return error.read().decode()
                messages = [{"role":"user","content":SENTINEL}]
                # Unauthenticated traffic must not reach the upstream.
                call(route["host"], "/chat/completions", {"model":route["model"],"messages":messages},
                     expected=401, credential="wrong-key")
                self.assertEqual(len(Upstream.calls), 0)
                response = call(route["host"], "/chat/completions", {"model":route["model"],"messages":messages})
                self.assertIn(SENTINEL, response)
                response = call(route["host"], "/chat/completions", {"model":route["model"],"messages":messages,
                    "stream":True,"tools":[{"type":"function","function":{"name":"fixture_tool","parameters":{"type":"object"}}}]})
                self.assertIn("data:", response)
                self.assertIn("fixture_tool", response)
                # Codex and Claude wire protocols; these must route to the selected provider/model.
                response = call(second["host"], "/responses", {"model":second["model"],"input":SENTINEL})
                self.assertIn(SENTINEL, response)
                response = call(claude["host"], "/v1/messages", {"model":claude["model"],
                    "messages":messages,"max_tokens":32}, anthropic=True)
                self.assertIn(SENTINEL, response)
                Upstream.status = 429
                call(route["host"], "/chat/completions", {"model":route["model"],"messages":messages}, expected=429)
                self.assertEqual(len(Upstream.calls), 5, "no automatic retries or fallback")
                for _, body, auth in Upstream.calls:
                    self.assertEqual(body["model"], MODEL)
                    self.assertEqual(auth, "Bearer " + API_KEY)
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    text = (local / "events.jsonl").read_text() if (local / "events.jsonl").exists() else ""
                    events = [json.loads(line) for line in text.splitlines() if line]
                    if len([e for e in events if e["kind"] == "attempt"]) >= 5 and any(
                            e["kind"] == "failure" and e["status"] == 429 for e in events):
                        break
                    time.sleep(.25)
                else:
                    self.fail("missing deployment-attempt or 429 metadata")
                self.assertNotIn(SENTINEL,text)
                self.assertNotIn(API_KEY,text)
                self.assertNotIn(key,text)
                self.assertNotIn("fixture_tool",text)
                # Actual status-bar reader, using observed records, and separate Kilo policy boundary.
                node = """
import { gatewayReadings } from %s;
import fs from 'node:fs';
const text = fs.readFileSync(process.argv[1], 'utf8');
const actual = gatewayReadings([text]);
if (!actual.some(r => r.provider === 'fixture' && r.text === '4 req 1h')) throw Error(JSON.stringify(actual));
if (!actual.some(r => r.provider === 'other' && r.text === '1 req 1h')) throw Error(JSON.stringify(actual));
const now = 10000000;
const rows = [{version:1,kind:'attempt',id:'a',provider:'kilo',model:'x:free',kilo:true,timestamp:now},
              {version:1,kind:'attempt',id:'b',provider:'kilo',model:'x:free',kilo:true,timestamp:now-3600000},
              {version:1,kind:'attempt',id:'c',provider:'kilo',model:'paid',kilo:true,timestamp:now}];
const kilo = gatewayReadings([rows.map(JSON.stringify).join('\\n'),JSON.stringify(rows[0])],now);
if (kilo[0]?.text !== '~1/200 1h') throw Error(JSON.stringify(kilo));
""" % json.dumps(READER.as_uri())
                subprocess.run(["node","--input-type=module","-e",node,str(local/"events.jsonl")],check=True)
                manager("disable")
                self.assertEqual(manager("prepare","fixture",MODEL,host,"pi"), {"direct":True})
                # Active route remains valid after toggling off; do not interrupt running agents.
                Upstream.status = 200
                call(route["host"], "/chat/completions", {"model":route["model"],"messages":messages})
                self.assertTrue((local/"events.jsonl").exists())
            finally:
                if (local/"state.json").exists():
                    manager("stop",check=False)

if __name__ == "__main__":
    unittest.main()
