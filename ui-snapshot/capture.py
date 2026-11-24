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
    shared = config/"shared.json"
    state = json.loads(shared.read_text()) if shared.exists() else {}
    state.update({"layout":"orca", "frame.welcomed":True})
    shared.write_text(json.dumps(state))
    match = re.search(r"\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b", version)
    if match:
        (config / "update-notes.json").write_text(json.dumps({"presented":[match.group(0)]}))

DELIVERY = ("layouts", "mods", "themes", "keys.json", "programs.json", "settings.json")

def verify_delivery(target, config):
    paths = run(["git", "-C", target, "ls-files", "-z", "--", *DELIVERY]).split("\0")
    records = []
    for path in filter(None, paths):
        src, dst = target/path, config/path
        if not src.is_file() or not dst.is_file():
            raise RuntimeError("Missing delivery file: "+path)
        expected = hashlib.sha256(src.read_bytes()).hexdigest()
        actual = hashlib.sha256(dst.read_bytes()).hexdigest()
        if expected != actual:
            raise RuntimeError("Installed file differs from main: "+path)
        records.append({"path":path,"sha256":actual})
    if not records or not {"layouts/orca.json","layouts/orca-unified.json","keys.json","programs.json","settings.json"}.issubset({r["path"] for r in records}):
        raise RuntimeError("Incomplete Orca deployment")
    return records

def blocking_overlays(status):
    return [o for o in status.get("overlays", []) if o != "toast"]

def seed_safe_tasks(config):
    # Fixture state only: keep the real Task UI; do not execute agent reset jobs.
    tasks = [{"id":provider+"-reset-ping","name":label+" reset ping","enabled":False,
              "agent":provider,"trigger":{"type":"reset","provider":provider,"window":"h5","delaySeconds":5},
              "argv":[provider, "ping"],"cwd":None} for provider,label in (("claude","Claude"),("codex","Codex"))]
    (config/"tasks.json").write_text(json.dumps({"version":1,"tasks":tasks}))

def sha(path):
    return run(["git", "-C", path, "rev-parse", "HEAD"]).strip()

def report(out, info):
    (out / "manifest.json").write_text(json.dumps(info, indent=2))
    rows = info["steps"]
    display_rows = rows
    h = html.escape
    cards = []
    for row in display_rows:
        images = "".join(f'<figure><figcaption>{h(k)}</figcaption><a href="{h(v["file"])}"><img loading="lazy" src="{h(v["file"])}"></a></figure>' for k, v in row.get("images", {}).items())
        cards.append(f'<section><h2>{h(row["mod"])} · {h(row["title"])}</h2><p>{h(row["mode"])} · {h(row["result"])}</p><p>{h(row["action"])}</p><p>{h(row.get("error", ""))}</p><div class="pair">{images}</div></section>')
    (out / "index.html").write_text('<!doctype html><meta charset="utf-8"><title>Main UI snapshot</title><style>body{font:16px system-ui;background:#15171a;color:#eee;margin:24px}section{border-top:1px solid #555;padding:16px 0}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0}img{width:100%;height:auto}a{color:#a9cfff}p{overflow-wrap:anywhere}</style><h1>Real Herdr App · main</h1><p>Commit: '+h(info["mainSha"])+'</p><p>'+h(info.get("fatal",""))+'</p><p>Custom mod controls only. AX press or native mouse click. Setup commands are not observations.</p><p><a href="manifest.json">Machine-readable manifest</a></p>'+''.join(cards))
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
            for name in DELIVERY:
                src = target / name
                if src.is_dir():
                    shutil.copytree(src, config/name, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, config/name)
            deployment = verify_delivery(target, config)
            (out/"deployment.json").write_text(json.dumps({"mainSha":info["mainSha"],"files":deployment},indent=2))
            info["deployment"] = {"verifiedFiles":len(deployment),"manifest":"deployment.json"}
            seed_safe_tasks(config)
            # Complete onboarding before capturing; never export stock UI.
            seed_startup(config, info.get("herdr-appVersion", ""))
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
                if blocking_overlays(ready) or ready.get("layout") != "orca":
                    print("Initial native layout/overlays:", ready.get("layout"), ready.get("overlays"), flush=True)
                    stop(proc)
                    # Reinstall exact tracked files after the first launch seeds built-ins.
                    for name in DELIVERY:
                        src = target/name
                        if src.is_dir():
                            shutil.copytree(src, config/name, dirs_exist_ok=True)
                        else:
                            shutil.copy2(src, config/name)
                    seed_startup(config, info.get("herdr-appVersion", ""))
                    seed_safe_tasks(config)
                    (out/"startup-fixture.json").write_text((config/"shared.json").read_text())
                    proc = launch()
                    ready = wait_ready(proc)
                    (out/"relaunch-status.json").write_text(json.dumps(ready, indent=2))
                if ready.get("layout") != "orca" or blocking_overlays(ready):
                    raise RuntimeError("Expected clear configured Orca window: "+json.dumps(ready))
                # Compare files after native boot, not just after copy.
                after = verify_delivery(target, config)
                info["deployment"]["verifiedAfterLaunch"] = len(after)
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
                from scenarios import CASES
                def clear():
                    for _ in range(4):
                        overlays = blocking_overlays(status())
                        if not overlays:
                            return
                        command("mod.open", name=overlays[-1])
                        time.sleep(.3)
                    raise RuntimeError("Could not reset overlay: "+str(blocking_overlays(status())))
                def select(stack, child):
                    command("layout.select", stack=stack, child=child)
                def setup(case):
                    clear()
                    layout = case.get("layout","orca")
                    if status().get("layout") != layout:
                        command("layout.switch", name=layout)
                        time.sleep(.7)
                    select("main","main-terminals")
                    command("layout.show", id="sidebar")
                    command("layout.show", id="panel")
                    select("panel-body","files")
                    if case.get("page"):
                        select("main",case["page"])
                    if case.get("panel"):
                        select("panel-body",case["panel"])
                    time.sleep(.7)
                    state = status()
                    if state.get("layout") != layout or blocking_overlays(state) or state.get("errors"):
                        raise RuntimeError("Fixture is not an unobstructed custom layout")
                def interact(row, control):
                    if ax_error:
                        raise PermissionError(ax_error)
                    try:
                        run([ax,str(proc.pid),control["label"]],timeout=10)
                        row["mode"]="accessibility-press"
                    except subprocess.CalledProcessError as e:
                        if "xy" not in control:
                            raise PermissionError(e.stderr.strip() or str(e)) from e
                        img = row["images"]["before"]
                        if (img["width"],img["height"]) != (1024,681):
                            raise PermissionError("Coordinate fallback requires calibrated 1024x681 window") from e
                        x,y=control["xy"]
                        try:
                            run([ax,str(proc.pid),"--click",str(x),str(y),"1024","681"],timeout=10)
                        except subprocess.CalledProcessError as err:
                            raise PermissionError(err.stderr.strip() or str(err)) from err
                        row["mode"]="native-mouse"
                command("space.new", name="Snapshot project", folder=str(fixture))
                time.sleep(2)
                if not status().get("space"):
                    raise RuntimeError("Local synthetic workspace was not created")
                info["coverage"] = {"repositoryMods":sorted(p.parent.name for p in (target/"mods").glob("*/mod.json")),
                                    "plannedMods":sorted({m for c in CASES for m in c["mods"]}),
                                    "scope":"Only real interactions with repository mods; no stock UI or native command screenshots."}
                for i,case in enumerate(CASES,1):
                    row = {"id":f"{i:02d}","title":case["title"],"mod":" / ".join(case["mods"]),
                           "mods":case["mods"],"action":case["control"]["label"],"mode":"not-attempted","result":"not-run"}
                    info["steps"].append(row)
                    print("UI_STEP "+json.dumps(row),flush=True)
                    try:
                        setup(case)
                        shot(row,"before")
                        interact(row,case["control"])
                        time.sleep(case.get("wait",1.0))
                        after = status()
                        row["status"] = after
                        if after.get("layout") != case.get("layout","orca") or after.get("errors"):
                            raise RuntimeError("Unexpected layout or native runtime error")
                        expected = case.get("overlay")
                        actual = blocking_overlays(after)
                        if expected and expected not in actual:
                            raise RuntimeError("Expected popup "+expected+"; got "+str(actual))
                        if not expected and actual:
                            raise RuntimeError("Unexpected blocking popup "+str(actual))
                        shot(row,"after")
                        if row["images"]["before"]["sha256"] == row["images"]["after"]["sha256"]:
                            raise RuntimeError("No visible change after interaction")
                        row["verification"]="expected-popup" if expected else "visible-change; manual semantic review required"
                        if expected:
                            clear()
                            time.sleep(.4)
                            if blocking_overlays(status()):
                                raise RuntimeError("Popup remained after fixture reset")
                            shot(row,"closed")
                        row["result"]="captured"
                    except Exception as e:
                        row["result"]="blocked" if isinstance(e,PermissionError) else "failed"
                        row["error"]=str(e)
                        if row.get("images"):
                            try:
                                if status().get("layout") in ("orca","orca-unified"):
                                    shot(row,"diagnostic")
                            except Exception:
                                pass
                    print("UI_RESULT "+json.dumps({k:v for k,v in row.items() if k != "status"}),flush=True)
                    report(out,info)
                info["coverage"]["observedMods"]=sorted({m for r in info["steps"] if r["result"]=="captured" for m in r["mods"]})
                info["coverage"]["unobservedMods"]=sorted(set(info["coverage"]["repositoryMods"])-set(info["coverage"]["observedMods"]))
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
    return 1 if info.get("fatal") or not info["steps"] or any(s["result"] != "captured" for s in info["steps"]) else 0

if __name__ == "__main__":
    raise SystemExit(main())
