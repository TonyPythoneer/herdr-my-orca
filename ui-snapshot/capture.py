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
import uuid
from pathlib import Path

def run(args, **kw):
    return subprocess.run([str(a) for a in args], text=True, capture_output=True,
                          timeout=kw.pop("timeout", 20), check=True, **kw).stdout

def command_args(command_name, **args):
    return ["do", command_name, *[part for k, v in args.items() for part in ("--"+k, str(v))]]

def snapshot_env(root, path):
    home = root/"home"
    home.mkdir()
    return {"HOME":str(home), "PATH":path, "HERDR_APP_HOME":str(root/"config"),
            "HC_SESSION":"snap"+uuid.uuid4().hex[:8], "HERDR_TELEMETRY":"0",
            "HC_LAUNCHD_DIRECT":"1", "LANG":"en_US.UTF-8", "TMPDIR":str(root),
            "GIT_CONFIG_NOSYSTEM":"1", "GIT_CONFIG_GLOBAL":"/dev/null", "GIT_TERMINAL_PROMPT":"0"}

def viewport_points(pixels, bounds):
    width, height = bounds
    if width <= 0 or height <= 0 or min(pixels) <= 0:
        raise RuntimeError("Invalid native window bounds: "+str(bounds))
    if abs(pixels[1] - height * pixels[0]/width) > 2:
        raise RuntimeError(f"Screenshot and window bounds have different proportions: {pixels} vs {bounds}")
    return (round(width), round(height))

class ForegroundLost(RuntimeError):
    pass

class ObserverUnavailable(RuntimeError):
    pass

class UnsafeNativeInput(RuntimeError):
    pass

class RecoveryFailed(RuntimeError):
    pass

def cleanup_session(hc, env, cwd, execute=run):
    errors = []
    def addresses():
        world = json.loads(execute([hc,"ls","--json"],env=env,cwd=cwd,timeout=10))
        if not isinstance(world, dict) or not isinstance(world.get("terminals"), list):
            raise ValueError("invalid isolated terminal list")
        terminals = world["terminals"]
        if any(not isinstance(t, dict) or not isinstance(t.get("address"), str) or not t["address"] for t in terminals):
            raise ValueError("invalid isolated terminal address")
        return [t["address"] for t in terminals]
    try:
        terminals = addresses()
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        errors.append(str(e))
        terminals = []
    for address in terminals:
        try:
            execute([hc,"kill",address],env=env,cwd=cwd,timeout=10)
        except (OSError, subprocess.SubprocessError) as e:
            errors.append(str(e))
    try:
        if addresses():
            errors.append("isolated terminals are still running")
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        errors.append(str(e))
    try:
        stopped = json.loads(execute([hc,"server","stop","--json"],env=env,cwd=cwd,timeout=10))
        if not isinstance(stopped, dict) or not stopped.get("stopped"):
            errors.append("core did not report a successful stop")
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        errors.append(str(e))
    return errors

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
    if not records or not {"layouts/orca.json","keys.json","programs.json","settings.json"}.issubset({r["path"] for r in records}):
        raise RuntimeError("Incomplete Orca deployment")
    return records

def normalized(text):
    return " ".join(re.sub(r"[^a-z0-9]+"," ",text.lower()).split())

def visible_matches(rows, text, region=None):
    """Only accept confident, unambiguous visible text in the requested screen region."""
    needle=normalized(text)
    if not needle:
        return []
    return [r for r in rows if r["confidence"] >= .5 and needle in normalized(r["text"])
            and (region is None or region[0] <= r["x"] <= region[2] and region[1] <= r["y"] <= region[3])]

def merge_ocr_rows(rows, extra):
    for row in extra:
        label = normalized(row["text"])
        duplicate = next((i for i, old in enumerate(rows)
                          if label and abs(row["x"] - old["x"]) < .025 and abs(row["y"] - old["y"]) < .02
                          and (label in normalized(old["text"]) or normalized(old["text"]) in label)), None)
        if duplicate is None:
            rows.append(row)
        else:
            old = rows[duplicate]
            if row["confidence"] >= .5 and (old["confidence"] < .5 or len(label) > len(normalized(old["text"]))):
                rows[duplicate] = row
    return rows

def ocr_rows(read, required=(), region=None, absent=()):
    rows = read(None)
    def enough():
        return all(visible_matches(rows, label, region) for label in required) and (
            not absent or any(visible_matches(rows, label, region) for label in absent))
    if enough():
        return rows
    crops = [region] if region else [(0,0,.35,1),(.25,0,.75,1),(.6,0,1,1)]
    for crop in crops:
        merge_ocr_rows(rows, read(crop))
        if enough():
            break
    return rows

def select_visible(rows, label, region=None, occurrence=None):
    matches=visible_matches(rows,label,region)
    exact=[r for r in matches if normalized(r["text"])==normalized(label)]
    if exact:
        matches=exact
    if len(matches)>1 and occurrence in ("top","bottom"):
        ranked=sorted(matches,key=lambda r:r["y"])
        if ranked[-1]["y"]-ranked[0]["y"] >= .02:
            return ranked[0 if occurrence=="top" else -1]
    if len(matches)>1:
        raise RuntimeError("Ambiguous visible control: "+label)
    return matches[0] if matches else None

def assert_visible(rows, required=(), absent=(), region=None):
    for label in required:
        if not visible_matches(rows,label,region):
            raise RuntimeError("Expected visible text missing: "+label)
    for label in absent:
        if visible_matches(rows,label,region):
            raise RuntimeError("Unexpected visible text remains: "+label)
    if absent and not any(row.get("confidence",0) >= .5 and
                          (region is None or region[0] <= row["x"] <= region[2] and region[1] <= row["y"] <= region[3])
                          for row in rows):
        raise RuntimeError("No visible text available to verify absence")

def click_errors(log_path, offset):
    """Catch GPUI errors not reflected in native status(), including expired cx."""
    with log_path.open("rb") as stream:
        stream.seek(offset)
        data = stream.read()
        end_offset = offset + (data.rfind(b"\n") + 1 if b"\n" in data else 0)
        text = data[:end_offset-offset].decode("utf-8", errors="replace")
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    errors = [line.strip() for line in text.splitlines()
              if re.search(r"\bERROR\b.*(?:error in .*handler|cx is no longer valid|render|quickjs)", line, re.I)]
    return errors, end_offset

def settled_click_errors(log_path, offset):
    errors,end_offset=click_errors(log_path,offset)
    if not errors and log_path.stat().st_size>end_offset:
        time.sleep(.2)
        errors,end_offset=click_errors(log_path,end_offset)
        if not errors and log_path.stat().st_size>end_offset:
            errors=["Incomplete native log line at interaction boundary"]
    return errors,end_offset

def pane_ids(listing):
    if not isinstance(listing, dict) or not isinstance(listing.get("spaces"), list):
        raise ValueError("incomplete pane inventory: missing spaces")
    found = set()
    def visit(value):
        if isinstance(value, dict):
            if "terminal" in value:
                pane=value.get("pane")
                if not isinstance(pane,str) or not pane:
                    raise ValueError("incomplete pane inventory: terminal has no pane ID")
                found.add(pane)
            panes=value.get("panes")
            if isinstance(panes,list):
                for entry in panes:
                    if isinstance(entry,dict):
                        for key in ("id", "pane", "pane_id", "paneId"):
                            pane=entry.get(key)
                            if isinstance(pane,str) and pane:
                                found.add(pane)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(listing)
    return found

def ax_control_not_dispatched(error):
    message=error.stderr or str(error)
    return "Expected exactly one actionable AX element" in message or "Use calibrated position to disambiguate" in message

def error_text(error):
    if isinstance(error,subprocess.CalledProcessError) and error.stderr:
        return error.stderr.strip()
    return str(error)

def pane_missing_response(returncode, output):
    try:
        result=json.loads(output)
    except ValueError as e:
        raise RuntimeError("Cannot verify pane existence: invalid response") from e
    if result.get("error")=="no such pane":
        return True
    if returncode or result.get("error"):
        raise RuntimeError("Cannot verify pane existence: "+str(result.get("error") or output))
    return False

def blocking_overlays(status):
    return [o for o in status.get("overlays", []) if o != "toast"]

def seed_safe_tasks(config):
    # Fixture state only: keep the real Task UI; do not execute agent reset jobs.
    tasks = [{"id":provider+"-reset-ping","name":label+" reset ping","enabled":False,
              "agent":provider,"trigger":{"type":"reset","provider":provider,"window":"h5","delaySeconds":5},
              "argv":[provider, "ping"],"cwd":None} for provider,label in (("claude","Claude"),("codex","Codex"))]
    (config/"tasks.json").write_text(json.dumps({"version":1,"tasks":tasks},indent=2))

def seed_permission(config, choice):
    path = config/"agent-manager.json"
    state = json.loads(path.read_text()) if path.exists() else {}
    state.setdefault("permissions", {})["default"] = choice
    path.write_text(json.dumps(state, indent=2))

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
    p.add_argument("--case", help="Capture only the named scenario (the CI feature smoke case).")
    p.add_argument("--local", action="store_true", help="Run in an isolated local HOME; controls the foreground desktop and clipboard")
    a = p.parse_args()
    target, out = a.target.resolve(), a.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / "screens").mkdir(exist_ok=True)
    info = {"schemaVersion": 1, "mainSha": sha(target), "platform": platform.platform(),
            "local": a.local,
            "steps": [], "coverageLimitations": ["No authenticated agents or remote pushes; no real user data.",
             "Native command captures do not exercise mouse handlers.", "AX press requires accessible, uniquely labeled controls and macOS permission.",
             "No pixel-level correctness assertion; screenshots are evidence for review."]}
    info["observerSha"] = sha(Path(__file__).resolve().parent)
    proc = None
    log = None
    try:
        if platform.system() != "Darwin" or (os.environ.get("GITHUB_ACTIONS") != "true" and not a.local):
            raise RuntimeError("Run in a disposable macOS GitHub Actions runner or explicitly pass --local.")
        app = shutil.which("herdr-app")
        if not app:
            raise RuntimeError("herdr-app is missing after installation")
        hc = shutil.which("hc")
        if not hc:
            raise RuntimeError("hc is required to clean up the isolated test session")
        info["appPath"] = app
        for name in ("herdr-app", "herdr-core"):
            try:
                info[name+"Version"] = run([name,"--version"]).strip()
            except Exception as e:
                info[name+"Version"] = str(e)
        with tempfile.TemporaryDirectory(prefix="hs-", dir="/var/tmp") as temp:
            root = Path(temp)
            config, fixture = root / "config", root / "sample-project"
            config.mkdir()
            fixture.mkdir()
            env = snapshot_env(root, os.environ["PATH"])
            env["HERDR_SNAPSHOT_GUARD_INPUT"] = "1"
            if a.local:
                env["HERDR_SNAPSHOT_LOCAL"] = "1"
            def cli(*args, timeout=20):
                return run([app, *args], env=env, cwd=fixture, timeout=timeout)
            def command(command_name, **args):
                return cli(*command_args(command_name, **args))
            def status():
                return json.loads(cli("status", timeout=8))
            def current_pane_ids():
                return pane_ids(json.loads(cli("ls", timeout=8)))
            def pane_is_missing(pane):
                result=subprocess.run([app,*command_args("pane.focus",pane=pane)],text=True,capture_output=True,
                                      timeout=8,env=env,cwd=fixture)
                return pane_missing_response(result.returncode,result.stdout or result.stderr)
            try:
                status()
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
            else:
                raise RuntimeError("Isolated configuration unexpectedly connects to an existing app")
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
                run(["git","-C",fixture,*args], env=env)
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
            log_offset=0
            try:
                ready = wait_ready(proc)
                (out/"initial-status.json").write_text(json.dumps(ready, indent=2))
                # A new upstream release may still show release notes. The prior
                # native retest proved relaunch clears an already-presented note.
                if blocking_overlays(ready) or ready.get("layout") != "orca":
                    print("Initial native layout/overlays:", ready.get("layout"), ready.get("overlays"), flush=True)
                    time.sleep(.5)
                    log.flush()
                    outgoing_errors,log_offset=click_errors(out/"app.log",log_offset)
                    stop(proc)
                    log.flush()
                    shutdown_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                    if outgoing_errors or shutdown_errors:
                        raise RuntimeError("Native startup relaunch log check failed: "+(outgoing_errors+shutdown_errors)[0])
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
                vision = root/"screen-text"
                run(["swiftc",Path(__file__).with_name("screen-text.swift"),"-o",vision],timeout=90)
                from scenarios import CASES, MOD_SCOPE, RIGHT
                cases = [case for case in CASES if not a.case or case["title"] == a.case]
                if a.case and len(cases) != 1:
                    raise RuntimeError("Unknown or ambiguous UI snapshot case: "+a.case)
                viewport=(1024,681)
                def dimensions(path):
                    data=path.read_bytes()
                    return (int.from_bytes(data[16:20],"big"),int.from_bytes(data[20:24],"big"))
                def probe():
                    path=root/"probe.png"
                    cli("shot",path)
                    return path
                def measured_viewport(path):
                    if ax_error:
                        raise RuntimeError("Cannot measure native window: "+ax_error)
                    return viewport_points(dimensions(path), json.loads(native("--bounds")))
                vision_started = False
                def words(path=None, required=(), region=None, absent=()):
                    path = path or probe()
                    def read(crop):
                        nonlocal vision_started
                        timeout = 20 if vision_started else 120
                        vision_started = True
                        try:
                            return json.loads(run([vision,path,*crop] if crop else [vision,path], env=env, timeout=timeout))
                        except (OSError, ValueError, subprocess.SubprocessError) as e:
                            raise ObserverUnavailable("Native OCR failed: "+str(e)) from e
                    return ocr_rows(read,required,region,absent)
                def native(*args, extra_env=None):
                    try:
                        helper_env = {**env, **extra_env} if extra_env else env
                        return run([ax,str(proc.pid),*args],env=helper_env,timeout=10)
                    except subprocess.CalledProcessError as e:
                        if a.local and any(message in (e.stderr or "") for message in ("Herdr is not the foreground app", "Herdr window is not the input target")):
                            raise ForegroundLost("Local test stopped during "+" ".join(args)+": "+e.stderr.strip()) from e
                        if a.local and any(message in (e.stderr or "") for message in ("Clipboard changed during backup", "Cannot preserve clipboard", "Cannot restore clipboard", "Cannot stage fixture text")):
                            raise ObserverUnavailable("Local test stopped because clipboard contents could not be preserved") from e
                        raise
                def focus():
                    if a.local:
                        native("--focus")
                def mouse(x, y, action="--click", extra=()):
                    if ax_error:
                        raise PermissionError(ax_error)
                    native(action,str(x),str(y),str(viewport[0]),str(viewport[1]),*extra)
                def park():
                    mouse(min(300,viewport[0]-20),5,"--move")
                    time.sleep(1.0)
                def dismiss_toast():
                    # The upstream version notification close control is at this
                    # calibrated position, outside all fixture custom controls.
                    # No screenshot is exported during setup.
                    mouse(round(viewport[0]*.965),round(viewport[1]*.951))
                    park()
                def resize(size):
                    nonlocal viewport
                    if viewport==size:
                        return
                    requested=size
                    last_error=""
                    for _ in range(3):
                        previous=viewport
                        try:
                            resize_env = {"HERDR_SNAPSHOT_RESIZE":"1"} if os.environ.get("GITHUB_ACTIONS") == "true" else None
                            native("--resize",str(requested[0]),str(requested[1]),extra_env=resize_env)
                            last_error=""
                        except subprocess.CalledProcessError as error:
                            last_error=(error.stderr or str(error)).strip()
                            if any(reason in last_error for reason in ("Unsafe native resize", "Herdr is not the foreground app", "corner is not owned", "Window moved", "lost foreground during resize")):
                                raise UnsafeNativeInput("Unsafe native resize stopped: "+last_error) from error
                        time.sleep(.7)
                        viewport=measured_viewport(probe())
                        if viewport==size:
                            return
                        if viewport==previous and last_error:
                            raise UnsafeNativeInput("Native resize made no progress: "+last_error)
                        requested=tuple(requested[i]+size[i]-viewport[i] for i in range(2))
                    raise RuntimeError("Native viewport did not resize: "+str(viewport)+("; "+last_error if last_error else ""))
                def visible_click(label, region=None, scroll=False, right=False, occurrence=None):
                    # Search the current rendered window; scroll only inside the intended pane.
                    for attempt in range(8):  # shortcut: fixed retry count, not a render-ready signal; raise if menus still render late
                        rows=words(required=[label],region=region)
                        p=select_visible(rows,label,region,occurrence)
                        if p:
                            x,y=round(p["x"]*viewport[0]),round(p["y"]*viewport[1])
                            mouse(x,y,"--right-click" if right else "--click")
                            park()
                            return [x,y]
                        if scroll:
                            x=round(viewport[0]*((region[0]+region[2])/2 if region else .5))
                            y=round(viewport[1]*((region[1]+region[3])/2 if region else .65))
                            mouse(x,y,"--scroll",extra=("-420",))
                            time.sleep(.5)
                        else:
                            time.sleep(.5)
                    raise RuntimeError("Visible control not found: "+label)
                def wait_visible(required=(), absent=(), region=None, timeout=12):
                    deadline=time.monotonic()+timeout
                    while True:
                        rows=words(required=required,region=region,absent=absent)
                        try:
                            assert_visible(rows,required,absent,region)
                            return rows
                        except RuntimeError:
                            if time.monotonic()>=deadline:
                                raise
                            time.sleep(.4)
                def ensure_workspace():
                    if not status().get("space"):
                        command("space.new",name="Snapshot project",folder=str(fixture))
                        time.sleep(2)
                    if not status().get("space"):
                        raise RuntimeError("Synthetic workspace missing")
                def recover(before_launch=None, target_viewport=(1024,681)):
                    nonlocal proc, viewport, log_offset, main_page
                    try:
                        if a.local:
                            native("--check-focus")
                        time.sleep(.5)
                        log.flush()
                        live_errors,log_offset=click_errors(out/"app.log",log_offset)
                        stop(proc)
                        log.flush()
                        exit_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                        pending_errors=live_errors+exit_errors
                        if pending_errors:
                            raise RuntimeError("Native error appeared at recovery boundary: "+pending_errors[0])
                        if (out/"app.log").stat().st_size>log_offset:
                            raise RuntimeError("Incomplete native log line at recovery boundary")
                        if before_launch:
                            before_launch()
                        seed_startup(config, info.get("herdr-appVersion",""))
                        proc=launch()
                        state=wait_ready(proc)
                        select("main","main-terminals")
                        time.sleep(.5)
                        main_page="main-terminals"
                        if state.get("layout") != "orca" or blocking_overlays(state):
                            raise RuntimeError("Relaunch did not restore clean Orca window")
                        viewport=measured_viewport(probe())
                        focus()
                        resize(target_viewport)
                        ensure_workspace()
                        focus()
                        dismiss_toast()
                        time.sleep(1.0)
                        log.flush()
                        recovery_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                        if recovery_errors:
                            raise RuntimeError("Native error during recovery: "+recovery_errors[0])
                    except (ForegroundLost, ObserverUnavailable, UnsafeNativeInput):
                        raise
                    except Exception as e:
                        raise RecoveryFailed("Isolated UI recovery failed: "+str(e)) from e
                def clear(target_viewport=(1024,681)):
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
                    recover(target_viewport=target_viewport)
                    if blocking_overlays(status()):
                        raise RuntimeError("Overlay remained after isolated relaunch")
                def select(stack, child):
                    command("layout.select", stack=stack, child=child)
                main_page="main-terminals"
                def setup(case):
                    nonlocal main_page, log_offset
                    desired_viewport=tuple(case.get("viewport",(1024,681)))
                    if case.get("permissionFixture"):
                        recover(lambda: seed_permission(config, case["permissionFixture"]),desired_viewport)
                    elif case.get("fresh"):
                        recover(target_viewport=desired_viewport)
                    clear(desired_viewport)
                    resize(desired_viewport)
                    layout = case.get("layout","orca")
                    if status().get("layout") != layout:
                        command("layout.switch", name=layout)
                        time.sleep(.7)
                    command("layout.show", id="left-sidebar")
                    command("layout.show", id="panel")
                    select("panel-body","files")
                    if case.get("group"):
                        # Wait for the real local Git group and primary checkout before toggling.
                        command("orca-sidebar-projects.expand-all")
                        wait_visible(["sample-project","primary"],region=(0,0,.28,1))
                        if case["group"]=="collapse":
                            command("orca-sidebar-projects.collapse-all")
                            wait_visible(["sample-project"],["primary"],region=(0,0,.28,1))
                    if case.get("files") == "contents":
                        command("orca-right-sidebar-header.search")
                        wait_visible(["Search"],region=RIGHT)
                        if visible_matches(words(region=RIGHT,absent=["Files to include"]),"Files to include",RIGHT):
                            perform({"kind":"press","label":"Toggle search details","xy":(1007,191)})
                        wait_visible([], ["Files to include"], region=RIGHT)
                        wait_visible([], ["Find files"], region=RIGHT)
                    elif case.get("files") == "names":
                        rows=words(region=RIGHT,absent=["Snapshot sample","Real local git project"])
                        if visible_matches(rows,"Snapshot sample",RIGHT) or visible_matches(rows,"Real local git project",RIGHT):
                            perform({"kind":"mouse","xy":(690,76)})
                            wait_visible(["Find files"],region=RIGHT)
                        visible_click("Names",RIGHT)
                        wait_visible(["Find files"],region=RIGHT)
                    desired_page=case.get("page","main-terminals")
                    if main_page!=desired_page:
                        select("main",desired_page)
                        main_page=desired_page
                    if case.get("panel"):
                        select("panel-body",case["panel"])
                    time.sleep(.7)
                    for action in case.get("prepare",[]):
                        perform(action)
                    time.sleep(.7)
                    park()
                    log.flush()
                    setup_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                    if setup_errors:
                        allowed=case.get("allowSetupRuntimeErrors",[])
                        if not allowed or any(not any(expected in error for expected in allowed) for error in setup_errors):
                            raise RuntimeError("Native error during fixture setup: "+setup_errors[0])
                        time.sleep(1.0)
                        settled_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                        if settled_errors:
                            raise RuntimeError("Native setup errors continued after transition: "+settled_errors[0])
                    state = status()
                    if case.get("setupOverlay") and case["setupOverlay"] not in blocking_overlays(state):
                        raise RuntimeError("Expected fixture overlay missing: "+case["setupOverlay"])
                    if state.get("layout") != layout or (blocking_overlays(state) and not case.get("setupOverlay")) or state.get("errors"):
                        raise RuntimeError("Fixture is not an unobstructed custom layout")
                    return setup_errors
                def perform(action):
                    kind=action["kind"]
                    if kind=="text":
                        return visible_click(action["label"],action.get("region"),action.get("scroll",False),action.get("right",False),action.get("occurrence"))
                    if kind=="press":
                        try:
                            native(action["label"])
                            return None
                        except subprocess.CalledProcessError as error:
                            if not ax_control_not_dispatched(error):
                                raise
                            if "xy" not in action:
                                raise PermissionError(error_text(error)) from error
                            screenshot = probe()
                            if measured_viewport(screenshot) != viewport:
                                raise PermissionError("Coordinate fallback requires a measured current viewport") from error
                            try:
                                mouse(*action["xy"])
                            except subprocess.CalledProcessError as fallback_error:
                                raise PermissionError(fallback_error.stderr.strip() or str(fallback_error)) from fallback_error
                            return list(action["xy"])
                    if kind=="mouse":
                        mouse(*action["xy"],"--right-click" if action.get("right") else "--click")
                        park()
                        return list(action["xy"])
                    if kind=="scroll":
                        mouse(*action["xy"],"--scroll",extra=(str(action.get("amount",-420)),))
                        park()
                        return list(action["xy"])
                    if kind=="command":
                        command(action["name"],**action.get("args",{}))
                        time.sleep(.7)
                        return None
                    if kind=="escape":
                        native("--escape")
                        park()
                        return None
                    if kind=="paste":
                        if action.get("label"):
                            visible_click(action["label"],action.get("region"),scroll=True,occurrence=action.get("occurrence"))
                        native("--paste",action["value"])
                        park()
                        return None
                    raise RuntimeError("Unknown action: "+kind)
                def interact(row, control):
                    if control.get("keyboard"):
                        row["mode"]="native-keyboard-escape"
                        perform({"kind":"escape"})
                        return
                    if control.get("visible"):
                        row["mode"]="native-mouse-visible-text"
                        try:
                            row["clickPoint"]=visible_click(control["label"],control.get("region"),control.get("scroll",False),control.get("right",False),control.get("occurrence"))
                        except RuntimeError as error:
                            if "Visible control not found:" not in str(error) or "xy" not in control:
                                raise
                            if viewport != (1024,681):
                                raise PermissionError("Calibrated visible-text fallback requires a 1024x681 window") from error
                            x,y=control["xy"]
                            mouse(x,y,"--right-click" if control.get("right") else "--click")
                            row["mode"]="native-mouse-calibrated-fallback"
                            row["clickPoint"]=[x,y]
                            park()
                        return
                    if ax_error:
                        raise PermissionError(ax_error)
                    try:
                        if control.get("mouse_only"):
                            raise subprocess.CalledProcessError(1, "coordinate-scoped control", stderr="Use calibrated position to disambiguate")
                        native(control["label"])
                        row["mode"]="accessibility-press"
                    except subprocess.CalledProcessError as e:
                        if not ax_control_not_dispatched(e):
                            raise
                        if "xy" not in control:
                            raise PermissionError(error_text(e)) from e
                        img = row["images"]["before"]
                        if viewport != (1024,681) or viewport_points((img["width"],img["height"]),viewport) != viewport:
                            raise PermissionError("Coordinate fallback requires calibrated 1024x681 window") from e
                        x,y=control["xy"]
                        try:
                            mouse(x,y,"--right-click" if control.get("right") else "--click")
                        except subprocess.CalledProcessError as err:
                            raise PermissionError(err.stderr.strip() or str(err)) from err
                        row["mode"]="native-mouse"
                        row["clickPoint"]=[x,y]
                    park()
                viewport=measured_viewport(probe())
                focus()
                resize((1024,681))
                ensure_workspace()
                focus()
                dismiss_toast()
                time.sleep(1.0)
                log.flush()
                startup_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                if startup_errors:
                    raise RuntimeError("Native startup/setup log check failed: "+startup_errors[0])
                info["coverage"] = {"repositoryMods":sorted(p.parent.name for p in (target/"mods").glob("*/mod.json")),
                                    "plannedMods":sorted({m for c in cases for m in c["mods"]}),
                                    "scope":"Only the selected real mod interaction; no stock UI or native command screenshots." if a.case else "Only real interactions with repository mods; no stock UI or native command screenshots.",
                                    "modScope":MOD_SCOPE}
                for i,case in enumerate(cases,1):
                    row = {"id":f"{i:02d}","title":case["title"],"mod":" / ".join(case["mods"]),
                           "mods":case["mods"],"action":case["control"]["label"],"mode":"not-attempted","result":"not-run"}
                    before_panes=set()
                    pane_baseline_ready=False
                    info["steps"].append(row)
                    print("UI_STEP "+json.dumps(row),flush=True)
                    try:
                        setup_errors=setup(case)
                        if setup_errors:
                            row["setupRuntimeErrors"]=setup_errors
                        if case.get("beforeText"):
                            wait_visible(case["beforeText"],region=case.get("evidenceRegion"))
                        shot(row,"before")
                        row["viewport"]=list(viewport)
                        before_state=status()
                        if case.get("paneChange"):
                            row["originalPaneId"]=before_state.get("focused_pane")
                            if not isinstance(row["originalPaneId"],str) or not row["originalPaneId"]:
                                raise RuntimeError("Pane scenario has no original focused pane")
                            before_panes=current_pane_ids()
                            if row["originalPaneId"] not in before_panes:
                                raise RuntimeError("Original focused pane is missing from the pane list")
                            pane_baseline_ready=True
                        before_words=words(out/row["images"]["before"]["file"],case.get("beforeText",[]),case.get("evidenceRegion")) if case.get("beforeText") else []
                        assert_visible(before_words,case.get("beforeText",[]),region=case.get("evidenceRegion"))
                        prior_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                        if prior_errors:
                            raise RuntimeError("Native error before interaction: "+prior_errors[0])
                        interact(row,case["control"])
                        time.sleep(case.get("wait",1.0))
                        after = status()
                        row["status"] = after
                        if case.get("paneChange"):
                            added_panes=current_pane_ids()-before_panes
                            focused=after.get("focused_pane")
                            if len(added_panes)>1:
                                raise RuntimeError("Expected one newly created pane; found "+str(sorted(added_panes)))
                            if len(added_panes)==1:
                                row["createdPaneId"]=next(iter(added_panes))
                            elif isinstance(focused,str) and focused!=row["originalPaneId"] and focused not in before_panes:
                                # ls lists terminal panes; a focused mod pane can be absent there.
                                row["createdPaneId"]=focused
                            else:
                                raise RuntimeError("Expected one new focused pane; found "+str(sorted(added_panes))+" and focus "+str(focused))
                            row["createdPaneIds"]=[row["createdPaneId"]]
                            if focused!=row["createdPaneId"]:
                                raise RuntimeError("New pane was not focused after the split action")
                        runtime_errors, checked_offset = click_errors(out/"app.log", log_offset)
                        log_offset=checked_offset
                        if runtime_errors:
                            allowed = case.get("allowTransientRuntimeErrors", [])
                            if not allowed or any(not any(expected in error for expected in allowed) for error in runtime_errors):
                                row["runtimeErrors"] = runtime_errors
                                raise RuntimeError("Native click/render handler error: "+runtime_errors[0])
                            settled_offset = checked_offset
                            time.sleep(1.0)
                            settled_errors, settled_offset = click_errors(out/"app.log", settled_offset)
                            log_offset=settled_offset
                            if settled_errors:
                                row["runtimeErrors"] = runtime_errors + settled_errors
                                raise RuntimeError("Native render errors continued after transition: "+settled_errors[0])
                            row["transientRuntimeErrors"] = runtime_errors
                            log_offset = settled_offset
                            after = status()
                            row["status"] = after
                        if after.get("layout") != case.get("layout","orca") or after.get("errors"):
                            raise RuntimeError("Unexpected layout or native runtime error")
                        expected = case.get("overlay")
                        actual = blocking_overlays(after)
                        if expected and expected not in actual:
                            raise RuntimeError("Expected popup "+expected+"; got "+str(actual))
                        if actual and (case.get("noOverlay") or (not expected and not case.get("popover"))):
                            raise RuntimeError("Unexpected blocking popup "+str(actual))
                        if case.get("afterText") or case.get("absentText"):
                            wait_visible(case.get("afterText",[]),case.get("absentText",[]),case.get("evidenceRegion"))
                        shot(row,"after")
                        if row["images"]["before"]["sha256"] == row["images"]["after"]["sha256"]:
                            raise RuntimeError("No visible change after interaction")
                        after_words=words(out/row["images"]["after"]["file"],case.get("afterText",[]),case.get("evidenceRegion"),case.get("absentText",[])) if case.get("afterText") or case.get("absentText") else []
                        assert_visible(after_words,case.get("afterText",[]),case.get("absentText",[]),case.get("evidenceRegion"))
                        if case.get("paneChange") and after.get("focused_pane")==before_state.get("focused_pane"):
                            raise RuntimeError("Expected a new focused pane")
                        if case.get("paneChange"):
                            current_focus=status().get("focused_pane")
                            if current_focus!=row["createdPaneId"]:
                                raise RuntimeError("New pane was not focused after the split action")
                        row["verification"]="expected-popup" if expected else ("visible-content" if case.get("afterText") or case.get("absentText") else "visible-change; manual semantic review required")
                        if case.get("follow"):
                            row["actions"]=[]
                            for n,action in enumerate(case["follow"],1):
                                point=perform(action)
                                time.sleep(.6)
                                phase=f'action{n:02d}'
                                evidence_region=action.get("evidenceRegion",action.get("region"))
                                absent_region=action.get("absentRegion",evidence_region)
                                if action.get("afterText"):
                                    wait_visible(action.get("afterText",[]),region=evidence_region)
                                if action.get("absentText"):
                                    wait_visible(absent=action.get("absentText",[]),region=absent_region)
                                shot(row,phase)
                                step={"action":action.get("label",action["kind"]),"phase":phase}
                                if point:
                                    step["clickPoint"]=point
                                evidence_region=action.get("evidenceRegion",action.get("region"))
                                if action.get("afterText"):
                                    assert_visible(words(out/row["images"][phase]["file"],action.get("afterText",[]),evidence_region),action.get("afterText",[]),region=evidence_region)
                                if action.get("absentText"):
                                    assert_visible(words(out/row["images"][phase]["file"],region=absent_region,absent=action.get("absentText",[])),absent=action.get("absentText",[]),region=absent_region)
                                if action.get("noOverlay") and blocking_overlays(status()):
                                    raise RuntimeError("Expected closed dialog after "+step["action"])
                                row["actions"].append(step)
                            row["verification"]="semantic-multi-step"
                        elif expected or case.get("popover"):
                            native("--escape")
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
                            if case.get("closedText") or case.get("closedAbsent"):
                                closed_text = case.get("closedText",[])
                                closed_absent = case.get("closedAbsent",[])
                                assert_visible(words(out/row["images"]["closed"]["file"],closed_text,absent=closed_absent),required=closed_text,absent=closed_absent)
                            if row["images"]["after"]["sha256"] == row["images"]["closed"]["sha256"]:
                                raise RuntimeError("No visible change on popup dismissal")
                        if case.get("fileAssert"):
                            check=case["fileAssert"]
                            value=json.loads((config/check["file"]).read_text())
                            for key in check["path"]:
                                value=value[key]
                            if value!=check["equals"]:
                                raise RuntimeError("Fixture persistence did not match expected value")
                            row["persistenceVerified"]=True
                        if case.get("fixtureExists") and not (fixture/case["fixtureExists"]).is_file():
                            raise RuntimeError("Cancel unexpectedly removed fixture file")
                        if case.get("closePane"):
                            remaining_panes=current_pane_ids()
                            if row["createdPaneId"] in remaining_panes:
                                raise RuntimeError("Diff pane still exists after explicit Close diff")
                            if remaining_panes!=before_panes:
                                raise RuntimeError("Pane list did not return to its original state after closing diff")
                            if not pane_is_missing(row["createdPaneId"]):
                                raise RuntimeError("Diff pane still exists after explicit Close diff")
                            if status().get("focused_pane")!=row["originalPaneId"]:
                                raise RuntimeError("Focus did not return to the original pane after closing diff")
                            row["closeMode"]="explicit-native-close-button"
                        if case.get("paneChange") and not case.get("closePane"):
                            # Explicitly dispose only the pane this case created, outside evidence.
                            command("pane.close",pane=row["createdPaneId"])
                            time.sleep(.4)
                            remaining_panes=current_pane_ids()
                            if row["createdPaneId"] in remaining_panes:
                                raise RuntimeError("Fixture pane remained after cleanup")
                            if remaining_panes!=before_panes:
                                raise RuntimeError("Pane list did not return to its original state after fixture cleanup")
                            if not pane_is_missing(row["createdPaneId"]):
                                raise RuntimeError("Fixture pane remained after cleanup")
                            if status().get("focused_pane")!=row["originalPaneId"]:
                                command("pane.focus",pane=row["originalPaneId"])
                            if status().get("focused_pane")!=row["originalPaneId"]:
                                raise RuntimeError("Focus did not return to the original pane after fixture cleanup")
                        runtime_errors, log_offset = settled_click_errors(out/"app.log", log_offset)
                        if runtime_errors:
                            row["runtimeErrors"] = runtime_errors
                            raise RuntimeError("Native click/render handler error: "+runtime_errors[0])
                        row["result"]="captured"
                        if case.get("pageAfter"):
                            main_page=case["pageAfter"]
                        elif case.get("page"):
                            main_page=case["page"]
                    except Exception as e:
                        if pane_baseline_ready and case.get("paneChange") and not isinstance(e,(ForegroundLost,ObserverUnavailable,UnsafeNativeInput,RecoveryFailed)):
                            try:
                                time.sleep(.5)
                                after_failure=current_pane_ids()
                                created=set(row.get("createdPaneIds",[])) | (after_failure-before_panes)
                                focused=status().get("focused_pane")
                                if isinstance(focused,str) and focused!=row.get("originalPaneId") and focused not in before_panes:
                                    created.add(focused)
                                for pane in sorted(created):
                                    if not pane_is_missing(pane):
                                        command("pane.close",pane=pane)
                                        time.sleep(.4)
                                    if not pane_is_missing(pane):
                                        raise RuntimeError("Fixture pane remained after failed-case cleanup: "+pane)
                                original=row.get("originalPaneId")
                                if current_pane_ids()!=before_panes:
                                    raise RuntimeError("Pane list did not return to its original state after failed-case cleanup")
                                if not original or original not in before_panes:
                                    raise RuntimeError("Original pane ID is unavailable during failed-case cleanup")
                                if status().get("focused_pane")!=original:
                                    command("pane.focus",pane=original)
                                if status().get("focused_pane")!=original:
                                    raise RuntimeError("Focus did not return to the original pane after failed-case cleanup")
                            except Exception as cleanup_error:
                                info["fatal"]="Failed to remove pane after case failure: "+str(cleanup_error)
                        if isinstance(e, (ForegroundLost, ObserverUnavailable, UnsafeNativeInput, RecoveryFailed)):
                            row["result"] = "blocked" if isinstance(e, ForegroundLost) else "failed"
                            row["error"] = str(e)
                            info["fatal"] = str(e)
                            if isinstance(e, ObserverUnavailable):
                                try:
                                    shot(row,"diagnostic")
                                except Exception:
                                    pass
                            print("UI_RESULT "+json.dumps(row),flush=True)
                            report(out,info)
                            break
                        row["result"]="blocked" if isinstance(e,PermissionError) else "failed"
                        row["error"]=error_text(e)
                        if row["result"] == "failed":
                            try:
                                if status().get("layout") == "orca":
                                    shot(row,"diagnostic")
                                    row["diagnosticVisibleText"]=[r["text"] for r in words(out/row["images"]["diagnostic"]["file"]) if r["confidence"]>=.5]
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
                        if info.get("fatal"):
                            pass
                        else:
                            try:
                                next_viewport = tuple(cases[i].get("viewport",(1024,681))) if i < len(cases) else (1024,681)
                                recover(target_viewport=next_viewport)
                                row["recovery"]="relaunch-succeeded"
                            except ForegroundLost as recovery_error:
                                row["recovery"] = str(recovery_error)
                                info["fatal"] = str(recovery_error)
                                print("UI_RESULT "+json.dumps(row),flush=True)
                                report(out,info)
                                break
                            except Exception as recovery_error:
                                row["recovery"]="relaunch-failed: "+str(recovery_error)
                                info["fatal"]="Case recovery failed: "+str(recovery_error)
                    print("UI_RESULT "+json.dumps({k:v for k,v in row.items() if k != "status"}),flush=True)
                    report(out,info)
                    if info.get("fatal"):
                        break
                if info.get("fatal"):
                    for i, case in enumerate(cases[len(info["steps"]):], len(info["steps"])+1):
                        info["steps"].append({"id":f"{i:02d}","title":case["title"],"mod":" / ".join(case["mods"]),
                                              "mods":case["mods"],"action":case["control"]["label"],
                                              "mode":"not-attempted","result":"not-run"})
                info["coverage"]["observedMods"]=sorted({m for r in info["steps"] if r["result"]=="captured" for m in r["mods"]})
                info["coverage"]["unobservedMods"]=sorted(set(info["coverage"]["repositoryMods"])-set(info["coverage"]["observedMods"]))
            finally:
                try:
                    time.sleep(.5)
                    log.flush()
                    live_errors,log_offset=click_errors(out/"app.log",log_offset)
                    if live_errors:
                        info["fatal"]=(info.get("fatal","")+" Final live log check failed: "+live_errors[0]).strip()
                except Exception as e:
                    info["fatal"]=(info.get("fatal","")+" Final live log read failed: "+str(e)).strip()
                try:
                    stop(proc)
                except Exception as e:
                    info["fatal"]=(info.get("fatal","")+" Isolated App stop failed: "+str(e)).strip()
                try:
                    log.flush()
                    exit_errors,log_offset=settled_click_errors(out/"app.log",log_offset)
                    if exit_errors:
                        info["fatal"]=(info.get("fatal","")+" Final shutdown log check failed: "+exit_errors[0]).strip()
                except Exception as e:
                    info["fatal"]=(info.get("fatal","")+" Final shutdown log read failed: "+str(e)).strip()
                try:
                    log.close()
                finally:
                    cleanup_errors = cleanup_session(hc, env, fixture)
                    if cleanup_errors:
                        info["fatal"] = (info.get("fatal", "")+" Isolated core cleanup failed: "+"; ".join(cleanup_errors)).strip()
    except Exception as e:
        prior_fatal = info.get("fatal", "")
        info["fatal"] = (str(e)+("; "+prior_fatal if prior_fatal else "")).strip()
        if isinstance(e,subprocess.CalledProcessError):
            info["fatal"] += " "+(e.stderr or "")
    finally:
        report(out,info)
        print((out/"summary.md").read_text(), flush=True)
    # A missing control or failed interaction is incomplete, never a passing click.
    return 1 if info.get("fatal") or not info["steps"] or any(s["result"] != "captured" for s in info["steps"]) else 0

if __name__ == "__main__":
    raise SystemExit(main())
