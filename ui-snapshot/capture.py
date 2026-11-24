"""Observe an unmodified main checkout through the real Herdr window."""
import argparse
import hashlib
import html
import json
import os
import platform
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

def run(args, **kw):
    return subprocess.run([str(a) for a in args], text=True, capture_output=True,
                          timeout=kw.pop("timeout", 20), check=True, **kw).stdout

def command_args(command_name, **args):
    return ["do", command_name, *[part for k, v in args.items() for part in ("--"+k, str(v))]]

def seed_startup(config, version):
    """Use Herdr's own persisted onboarding state; never patch product JS."""
    # Proven by the isolated native runs recorded in main:
    # artifacts/orca-bundler/20261123T160823Z-window/observations.md
    (config / "shared.json").write_text(json.dumps({"layout":"orca", "frame.welcomed":True}))
    match = re.search(r"\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b", version)
    if match:
        (config / "update-notes.json").write_text(json.dumps({"presented":[match.group(0)]}))

def sha(path):
    return run(["git", "-C", path, "rev-parse", "HEAD"]).strip()

def report(out, info):
    (out / "manifest.json").write_text(json.dumps(info, indent=2))
    rows = info["steps"]
    h = html.escape
    cards = []
    for row in rows:
        images = "".join(f'<figure><figcaption>{h(k)}</figcaption><a href="{h(v["file"])}"><img loading="lazy" src="{h(v["file"])}"></a></figure>' for k, v in row.get("images", {}).items())
        cards.append(f'<section><h2>{h(row["id"])} · {h(row["title"])}</h2><p>{h(row["mode"])} · {h(row["result"])}</p><p>{h(row["action"])}</p><p>{h(row.get("error", ""))}</p><div class="pair">{images}</div></section>')
    (out / "index.html").write_text('<!doctype html><meta charset="utf-8"><title>Main UI snapshot</title><style>body{font:16px system-ui;background:#15171a;color:#eee;margin:24px}section{border-top:1px solid #555;padding:16px 0}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0}img{width:100%;height:auto}a{color:#a9cfff}p{overflow-wrap:anywhere}</style><h1>Real Herdr App · main</h1><p>Commit: '+h(info["mainSha"])+'</p><p>'+h(info.get("fatal",""))+'</p><p>Native command = state navigation, not a mouse click. AX press = native accessibility interaction.</p><p><a href="manifest.json">Machine-readable manifest</a></p>'+''.join(cards))
    counts = {k: sum(r["result"] == k for r in rows) for k in ("captured", "failed", "blocked", "not-run")}
    (out / "summary.md").write_text(f'Main: `{info["mainSha"]}`\n\nCaptured: {counts["captured"]} / {len(rows)}; failed: {counts["failed"]}; blocked: {counts["blocked"]}; not run: {counts["not-run"]}.\n\nDownload the artifact and open index.html. Native command captures do not prove click behavior. Blocked accessibility observations are explicitly incomplete, not successful clicks.\n\n{info.get("fatal", "")}\n')

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--target", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    target, out = a.target.resolve(), a.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / "screens").mkdir(exist_ok=True)
    info = {"schemaVersion": 1, "mainSha": sha(target), "platform": platform.platform(),
            "steps": [], "coverageLimitations": ["No authenticated agents or remote pushes; no real user data.",
             "Native command captures do not exercise mouse handlers.", "AX press requires accessible, uniquely labeled controls and macOS permission.",
             "No pixel-level correctness assertion; screenshots are evidence for review."]}
    info["observerSha"] = sha(Path(__file__).resolve().parent)
    proc = None
    log = None
    try:
        if os.environ.get("GITHUB_ACTIONS") != "true" or platform.system() != "Darwin":
            raise RuntimeError("Run only in a disposable macOS GitHub Actions runner.")
        app = shutil.which("herdr-app")
        if not app:
            raise RuntimeError("herdr-app is missing after installation")
        info["appPath"] = app
        for name in ("herdr-app", "herdr-core"):
            try:
                info[name+"Version"] = run([name,"--version"]).strip()
            except Exception as e:
                info[name+"Version"] = str(e)
        with tempfile.TemporaryDirectory(prefix="herdr-snapshot-") as temp:
            root = Path(temp)
            config, fixture = root / "config", root / "sample-project"
            config.mkdir()
            fixture.mkdir()
            env = {"HOME": os.environ["HOME"], "PATH": os.environ["PATH"],
                   "HERDR_APP_HOME": str(config), "HC_SESSION": "ui-snapshot",
                   "HERDR_TELEMETRY": "0", "HC_LAUNCHD_DIRECT": "1",
                   "LANG": "en_US.UTF-8", "TMPDIR": str(root)}
            def cli(*args, timeout=20):
                return run([app, *args], env=env, cwd=fixture, timeout=timeout)
            def command(command_name, **args):
                return cli(*command_args(command_name, **args))
            def status():
                return json.loads(cli("status", timeout=8))
            def shot(row, phase):
                rel = f'screens/{row["id"]}-{phase}.png'
                dest = out / rel
                cli("shot", dest)
                data = dest.read_bytes()
                if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data)<100:
                    raise RuntimeError("Invalid PNG")
                row.setdefault("images", {})[phase] = {"file": rel, "sha256": hashlib.sha256(data).hexdigest(),
                   "width": int.from_bytes(data[16:20], "big"), "height": int.from_bytes(data[20:24], "big")}
            (fixture / "README.md").write_text("# Snapshot sample\nReal local git project.\n")
            (fixture / "src").mkdir()
            (fixture / "src" / "example.js").write_text("export const sample = 1;\n")
            for args in (["init","-b","main"], ["add","."], ["-c","user.name=Snapshot","-c","user.email=snapshot@example.invalid","commit","-m","fixture"]):
                run(["git","-C",fixture,*args])
            (fixture / "src" / "example.js").write_text("export const sample = 2;\n")
            (fixture / "notes.txt").write_text("Untracked local fixture\n")
            # Overlay only the tracked delivery files; the app supplies built-ins.
            for name in ("layouts", "mods", "themes", "keys.json", "programs.json", "settings.json"):
                src = target / name
                if src.is_dir():
                    shutil.copytree(src, config/name, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, config/name)
            seed_startup(config, info.get("herdr-appVersion", ""))
            (out / "startup-fixture.json").write_text((config / "shared.json").read_text())
            log = (out / "app.log").open("w")
            def launch():
                return subprocess.Popen([app], env=env, cwd=fixture, stdout=log, stderr=subprocess.STDOUT)
            def stop(process):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            def wait_ready(process):
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError(f"Herdr exited: {process.returncode}")
                    try:
                        return status()
                    except (OSError, ValueError, subprocess.SubprocessError):
                        time.sleep(2)
                raise RuntimeError("Native window did not answer within readiness timeout")
            proc = launch()
            try:
                ready = wait_ready(proc)
                (out/"initial-status.json").write_text(json.dumps(ready, indent=2))
                # A new upstream release may still show release notes. The prior
                # native retest proved relaunch clears an already-presented note.
                if ready.get("overlays"):
                    print("Startup overlay(s):", ready["overlays"], flush=True)
                    startup = {"id":"00", "title":"Startup overlay before recovery", "mode":"initial-state",
                               "action":"Capture startup diagnostic before relaunch", "result":"captured"}
                    shot(startup, "after")
                    info["startupDiagnostic"] = startup
                    stop(proc)
                    seed_startup(config, info.get("herdr-appVersion", ""))
                    proc = launch()
                    ready = wait_ready(proc)
                    (out/"relaunch-status.json").write_text(json.dumps(ready, indent=2))
                print("READY "+json.dumps(ready), flush=True)
                ax = root/"ax-press"
                ax_error = ""
                try:
                    run(["swiftc", Path(__file__).with_name("ax-press.swift"), "-o", ax], timeout=90)
                except Exception as e:
                    ax_error = str(e)
                    if isinstance(e, subprocess.CalledProcessError):
                        ax_error += " " + (e.stderr or "")
                    print("AX helper unavailable:", ax_error, flush=True)
                scenarios = []
                def add(title, name=None, args=None, label=None, check=None, wait=0.8):
                    mode = "accessibility-press" if label else ("native-command" if name else "initial-state")
                    scenarios.append((title, name, args or {}, label, check, wait, mode))
                add("First configured launch", check=lambda s:not s.get("overlays"))
                add("Confirm startup overlay absent", check=lambda s:not s.get("overlays"))
                add("Switch to Orca layout", "layout.switch", {"name":"orca"}, check=lambda s:s.get("layout")=="orca")
                add("Welcome / landing page", "layout.select", {"stack":"main","child":"main-landing"})
                add("Create fixture workspace", "space.new", {"name":"Snapshot project","folder":str(fixture)}, check=lambda s:bool(s.get("space")),wait=2)
                add("Show terminal", "layout.select", {"stack":"main","child":"main-terminals"})
                add("Create second tab", "tab.new", {"name":"Second terminal"})
                add("Rename selected tab", "tab.rename", {"name":"Renamed terminal"})
                add("Switch to first tab", "tab.select", {"index":1})
                add("Split right", "pane.split", {"direction":"right"})
                add("Split down", "pane.split", {"direction":"down"})
                add("Zoom focused pane", "pane.zoom")
                add("Restore split panes", "pane.zoom")
                add("Close focused pane", "pane.close")
                add("Collapse left sidebar", "layout.hide", {"id":"sidebar"})
                add("Expand left sidebar", "layout.show", {"id":"sidebar"})
                add("Collapse right sidebar", "layout.hide", {"id":"panel"})
                add("Expand right sidebar", "layout.show", {"id":"panel"})
                for child in ("files","changes","ports","vault","workspaces","pr-checks","checks"):
                    add("Right panel: "+child, "layout.select", {"stack":"panel-body","child":child})
                add("Search files", "orca-panel-head.search")
                add("Open new-tab menu", "orca-tabs.new-tab")
                add("Dismiss new-tab menu", "overlay.close")
                add("Open split menu", "mod.open", {"name":"orca-split-menu"})
                add("Dismiss split menu", "overlay.close")
                add("Agent manager", "layout.select", {"stack":"main","child":"main-agents"},wait=2)
                add("Model providers", "layout.select", {"stack":"main","child":"main-providers"})
                add("Tasks", "layout.select", {"stack":"main","child":"main-tasks"})
                add("Return to terminals", "layout.select", {"stack":"main","child":"main-terminals"})
                add("Workspace search (actual AX press)", label="Search worktrees")
                add("Dismiss search", "overlay.close")
                add("Workspace options (actual AX press)", label="Workspace options")
                add("Dismiss options", "overlay.close")
                add("Agents footer (actual AX press)", label="Agents")
                add("Providers footer (actual AX press)", label="Model providers")
                add("Tasks footer (actual AX press)", label="Tasks")
                add("Switch unified layout", "layout.switch", {"name":"orca-unified"}, check=lambda s:s.get("layout")=="orca-unified")
                add("Unified layout sidebar animation settled", "orca-tabs.toggle-sidebar")
                add("Unified layout sidebar restored", "orca-tabs.toggle-sidebar")
                add("Unified layout right panel animation settled", "orca-tabs.toggle-panel")
                add("Unified layout right panel restored", "orca-tabs.toggle-panel")
                for i,(title,name,args,label,check,wait,mode) in enumerate(scenarios,1):
                    row = {"id":f"{i:02d}","title":title,"mode":mode,
                           "action":label or (name+" "+json.dumps(args) if name else "Launch app"),"result":"not-run"}
                    info["steps"].append(row)
                    if i > 3 and info["steps"][2]["result"] != "captured":
                        row["result"] = "not-run"
                        row["error"] = "Orca layout prerequisite failed"
                        continue
                    if i > 2 and any(s["result"] != "captured" for s in info["steps"][:2]):
                        row["result"] = "not-run"
                        row["error"] = "Startup overlay prerequisite failed"
                        continue
                    if i > 42 and info["steps"][41]["result"] != "captured":
                        row["error"] = "Unified layout prerequisite failed"
                        continue
                    print(f'UI_STEP {row["id"]} {title}', flush=True)
                    try:
                        if name or label:
                            shot(row, "before")
                        if label:
                            if ax_error:
                                raise PermissionError(ax_error)
                            try:
                                run([ax,str(proc.pid),label],timeout=10)
                            except subprocess.CalledProcessError as e:
                                raise PermissionError(e.stderr.strip() or str(e)) from e
                        elif name == "overlay.close":
                            overlays = status().get("overlays") or []
                            if not overlays:
                                row["action"] += " (no overlay present; no-op)"
                            else:
                                command("overlay.close", id=overlays[-1])
                                time.sleep(0.5)
                                if overlays[-1] in (status().get("overlays") or []):
                                    raise RuntimeError("Overlay did not close: "+overlays[-1])
                        elif name:
                            command(name,**args)
                        time.sleep(wait)
                        shot(row,"after")
                        s = status()
                        row["status"] = s
                        if i >= 3 and s.get("layout") != ("orca-unified" if i >= 42 else "orca"):
                            raise RuntimeError("Unexpected layout: "+str(s.get("layout")))
                        if s.get("errors"):
                            raise RuntimeError("Herdr reported runtime errors")
                        if check and not check(s):
                            raise RuntimeError("Expected native status was not observed")
                        row["result"]="captured"
                    except Exception as e:
                        row["result"]="blocked" if isinstance(e,PermissionError) else "failed"
                        row["error"]=str(e)
                        if isinstance(e,subprocess.CalledProcessError):
                            row["error"] += " "+(e.stderr or "")+" "+(e.stdout or "")
                        try:
                            shot(row,"diagnostic")
                        except Exception:
                            pass
                    print("UI_RESULT "+json.dumps({k:v for k,v in row.items() if k != "status"}), flush=True)
                    report(out,info)
            finally:
                stop(proc)
                log.close()
    except Exception as e:
        info["fatal"]=str(e)
        if isinstance(e,subprocess.CalledProcessError):
            info["fatal"] += " "+(e.stderr or "")
    finally:
        report(out,info)
        print((out/"summary.md").read_text(), flush=True)
    # AX coverage is reported independently from the required native state capture.
    # A missing AX element is an incomplete observation, never a successful click.
    return 1 if info.get("fatal") or not info["steps"] or any(s["result"] in ("failed","not-run") for s in info["steps"]) else 0

if __name__ == "__main__":
    raise SystemExit(main())
