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

def click_errors(log_path, offset):
    """Catch GPUI errors not reflected in native status(), including expired cx."""
    with log_path.open("rb") as stream:
        stream.seek(offset)
        text = stream.read().decode("utf-8", errors="replace")
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    return [line.strip() for line in text.splitlines()
            if re.search(r"\bERROR\b.*(?:error in .*handler|cx is no longer valid|render|quickjs)", line, re.I)]

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
                def mouse(x, y, action="--click"):
                    if ax_error:
                        raise PermissionError(ax_error)
                    run([ax,str(proc.pid),action,str(x),str(y),"1024","681"],timeout=10)
                def park():
                    mouse(150,530,"--move")
                    time.sleep(.2)
                def dismiss_toast():
                    # The upstream version notification close control is at this
                    # calibrated position, outside all fixture custom controls.
                    # No screenshot is exported during setup.
                    mouse(988,648)
                    park()
                def ensure_workspace():
                    if not status().get("space"):
                        command("space.new",name="Snapshot project",folder=str(fixture))
                        time.sleep(2)
                    if not status().get("space"):
                        raise RuntimeError("Synthetic workspace missing")
                def recover():
                    nonlocal proc
                    stop(proc)
                    seed_startup(config, info.get("herdr-appVersion",""))
                    proc=launch()
                    state=wait_ready(proc)
                    if state.get("layout") != "orca" or blocking_overlays(state):
                        raise RuntimeError("Relaunch did not restore clean Orca window")
                    ensure_workspace()
                    dismiss_toast()
                def clear():
                    if not blocking_overlays(status()):
                        return
                    # Actual outside click first; restart only for test isolation,
                    # never to claim a successful tested popup dismissal.
                    try:
                        mouse(150,530)
                        time.sleep(.4)
                        if not blocking_overlays(status()):
                            return
                    except (PermissionError,subprocess.SubprocessError):
                        pass
                    recover()
                    if blocking_overlays(status()):
                        raise RuntimeError("Overlay remained after isolated relaunch")
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
                    if case.get("group"):
                        command("orca-spaces."+case["group"]+"-all")
                    if case.get("files") == "contents":
                        command("orca-panel-head.search")
                    elif case.get("files") == "names":
                        mouse(765,86)
                        mouse(939,47)
                    if case.get("page"):
                        select("main",case["page"])
                    if case.get("panel"):
                        select("panel-body",case["panel"])
                    time.sleep(.7)
                    park()
                    state = status()
                    if state.get("layout") != layout or blocking_overlays(state) or state.get("errors"):
                        raise RuntimeError("Fixture is not an unobstructed custom layout")
                def interact(row, control):
                    if ax_error:
                        raise PermissionError(ax_error)
                    try:
                        if control.get("mouse_only"):
                            raise subprocess.CalledProcessError(1, "coordinate-scoped control", stderr="Use calibrated position to disambiguate")
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
                            mouse(x,y,"--right-click" if control.get("right") else "--click")
                        except subprocess.CalledProcessError as err:
                            raise PermissionError(err.stderr.strip() or str(err)) from err
                        row["mode"]="native-mouse"
                        row["clickPoint"]=[x,y]
                    park()
                ensure_workspace()
                dismiss_toast()
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
                        log_offset = (out/"app.log").stat().st_size
                        interact(row,case["control"])
                        time.sleep(case.get("wait",1.0))
                        after = status()
                        row["status"] = after
                        runtime_errors = click_errors(out/"app.log", log_offset)
                        if runtime_errors:
                            row["runtimeErrors"] = runtime_errors
                            raise RuntimeError("Native click/render handler error: "+runtime_errors[0])
                        if after.get("layout") != case.get("layout","orca") or after.get("errors"):
                            raise RuntimeError("Unexpected layout or native runtime error")
                        expected = case.get("overlay")
                        actual = blocking_overlays(after)
                        if expected and expected not in actual:
                            raise RuntimeError("Expected popup "+expected+"; got "+str(actual))
                        if not expected and actual and not case.get("popover"):
                            raise RuntimeError("Unexpected blocking popup "+str(actual))
                        shot(row,"after")
                        if row["images"]["before"]["sha256"] == row["images"]["after"]["sha256"]:
                            raise RuntimeError("No visible change after interaction")
                        row["verification"]="expected-popup" if expected else "visible-change; manual semantic review required"
                        if expected or case.get("popover"):
                            run([ax,str(proc.pid),"--escape"],timeout=10)
                            time.sleep(.5)
                            row["escapeClosed"]=not blocking_overlays(status()) if expected else None
                            # Some custom menus require an outside press instead
                            # of Escape (confirmed in run 45367963624).
                            if blocking_overlays(status()) or case.get("popover"):
                                mouse(150,530)
                                time.sleep(.5)
                                row["closeMode"]="native-outside-click"
                            else:
                                row["closeMode"]="native-keyboard-escape"
                            park()
                            if blocking_overlays(status()):
                                raise RuntimeError("Popup remained after Escape and outside click")
                            shot(row,"closed")
                            if row["images"]["after"]["sha256"] == row["images"]["closed"]["sha256"]:
                                raise RuntimeError("No visible change on popup dismissal")
                        runtime_errors = click_errors(out/"app.log", log_offset)
                        if runtime_errors:
                            row["runtimeErrors"] = runtime_errors
                            raise RuntimeError("Native click/render handler error: "+runtime_errors[0])
                        row["result"]="captured"
                    except Exception as e:
                        row["result"]="blocked" if isinstance(e,PermissionError) else "failed"
                        row["error"]=str(e)
                        if row.get("images") and row["mode"] != "not-attempted":
                            try:
                                if status().get("layout") in ("orca","orca-unified"):
                                    shot(row,"diagnostic")
                            except Exception:
                                pass
                    # A blocked interaction has no useful action evidence; do not
                    # keep its duplicate before-only screenshot in the artifact.
                    if row["result"] == "blocked":
                        for img in row.pop("images",{}).values():
                            (out/img["file"]).unlink(missing_ok=True)
                    if row["result"] != "captured":
                        # Do not let a failed interaction poison the following case.
                        # Recovery is never included as a successful closed screenshot.
                        try:
                            recover()
                            row["recovery"]="relaunch-succeeded"
                        except Exception as recovery_error:
                            row["recovery"]="relaunch-failed: "+str(recovery_error)
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
    # A missing control or failed interaction is incomplete, never a passing click.
    return 1 if info.get("fatal") or not info["steps"] or any(s["result"] != "captured" for s in info["steps"]) else 0

if __name__ == "__main__":
    raise SystemExit(main())
