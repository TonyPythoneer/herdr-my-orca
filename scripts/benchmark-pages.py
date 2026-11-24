#!/usr/bin/env python3
"""Page benchmark for Herdr's native desktop. No production mod instrumentation.

--plan works without Herdr. --capture creates a disposable app/core and reference
screenshots. --references measures against screenshots explicitly approved by the
operator. Screenshots measure observation upper bounds, NOT exact GPU presentation.
"""
import argparse
import csv
import hashlib
import runpy
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
LAYOUTS = ("orca", "orca-unified")
BUDGETS = {"feedback_ms": 100, "warm_match_ms": 200, "local_ready_ms": 500}
# The right panel deliberately hides routes which are not relevant to the workspace.
FIXTURES = {"workspaces": "folder", "pr-checks": "folder", "ports": "ssh"}


def origin_page(row):
    # Sparse Providers needs a visually distinct origin, not a blank terminal.
    if row["stack"] == "main":
        return "main-agents" if row["page"] in ("main-terminals", "main-providers") else "main-terminals"
    return "vault" if row["page"] == "files" else "files"


def stable_reference(driver, row, roi, settle, tolerance):
    time.sleep(max(settle, 2.0))
    driver.check(row["layout"])
    previous = driver.shot()
    deadline = time.monotonic() + 30
    stable = 0
    while time.monotonic() < deadline:
        time.sleep(.5)
        driver.check(row["layout"])
        current = driver.shot()
        stable = stable + 1 if driver.distance(previous, current, roi) <= tolerance else 0
        if stable >= 3:
            return current
        previous = current
    raise RuntimeError("Reference did not stabilize within 30 seconds")


def plan(root=ROOT):
    result = []
    for name in LAYOUTS:
        tree = json.loads((root / "layouts" / (name + ".json")).read_text())
        def walk(node):
            if node.get("type") == "stack":
                for child in node.get("children", []):
                    page = child["id"]
                    result.append({"layout": name, "stack": node["id"], "page": page,
                                   "fixture": FIXTURES.get(page, "git"),
                                   "mod": child.get("content", {}).get("mod", "native-terminal")})
            for child in node.get("children", []):
                walk(child)
        walk(tree)
    return result


def quantile(samples, p):
    """Nearest-rank percentile; failed/missing samples are not zero."""
    if not samples:
        return None
    ordered = sorted(samples)
    return round(ordered[max(0, math.ceil(p * len(ordered)) - 1)], 3)


def summarize(samples):
    metrics = {}
    for key in ("command_ms", "first_change_ms", "reference_match_ms", "capture_ms"):
        values = [s[key] for s in samples if s.get(key) is not None]
        metrics[key] = {"count": len(values), "p50": quantile(values, .5),
                        "p95": quantile(values, .95), "max": round(max(values), 3) if values else None}
    matched = sum(s["status"] == "matched" for s in samples)
    return {"attempts": len(samples), "matched": matched,
            "failures": len(samples) - matched,
            "failure_rate": (len(samples) - matched) / len(samples) if samples else None,
            "metrics": metrics}


def classify(before_distance, reference_distance, separation, tolerance):
    # Before and target must be distinguishable. A spinner or unrelated background
    # change is insufficient to declare the target page ready.
    if separation <= tolerance * 3:
        return "indistinguishable"
    if reference_distance <= tolerance:
        return "matched"
    if before_distance >= max(tolerance * 2, separation * .20):
        return "changed"
    return "waiting"


def observe(driver, before, target, transition, roi, timeout, poll, tolerance):
    separation = driver.distance(before, target, roi)
    if separation <= tolerance * 3:
        return {"status": "indistinguishable", "separation": separation}
    start = time.monotonic()
    transition()
    command_ms = (time.monotonic() - start) * 1000
    captures, changed, matched = [], None, None
    observations = []
    while time.monotonic() - start < timeout:
        tick = time.monotonic()
        current = driver.shot()
        elapsed = (time.monotonic() - start) * 1000
        captures.append((time.monotonic() - tick) * 1000)
        # PNG capture and transport are included. Never subtract a guessed overhead.
        if elapsed > timeout * 1000:
            break
        before_delta = driver.distance(before, current, roi)
        target_delta = driver.distance(target, current, roi)
        state = classify(before_delta, target_delta, separation, tolerance)
        observations.append({"response_ms": elapsed, "capture_ms": captures[-1],
                             "before_distance": before_delta, "target_distance": target_delta, "state": state})
        if state in ("changed", "matched") and changed is None:
            changed = elapsed
        if state == "matched":
            matched = elapsed
            break
        time.sleep(poll)
    return {"status": "matched" if matched is not None else "timeout",
            "command_ms": command_ms, "first_change_ms": changed,
            "reference_match_ms": matched, "capture_ms": statistics.median(captures) if captures else None,
            "separation": separation, "capture_count": len(captures),
            "capture_total_ms": sum(captures), "observations": observations,
            "first_capture_matched": matched is not None and len(captures) == 1}


def measurement_control(samples):
    """Paired same-visit control; no subtraction of aggregate percentiles."""
    matched = [s for s in samples if s.get("status") == "matched"]
    paired = [s for s in matched if s.get("control_capture_ms") is not None
              and s.get("capture_total_ms") is not None and s.get("reference_match_ms", 0) > 0]
    shares = [s["capture_total_ms"] / s["reference_match_ms"] for s in paired]
    return {"paired_count": len(paired),
            "control_capture_p50_ms": quantile([s["control_capture_ms"] for s in paired], .5),
            "control_capture_p95_ms": quantile([s["control_capture_ms"] for s in paired], .95),
            "median_capture_share": quantile(shares, .5),
            "first_capture_match_rate": sum(s.get("first_capture_matched") is True for s in paired) / len(paired) if paired else None,
            "note": "Origin screenshot is a same-visit no-transition control, not exact PNG/IPC overhead. Capture shares include possible rendering wait; do not subtract them from latency."}


class Native:
    def __init__(self, output, app, hc, root, tolerance, diagnostic=False, fixture_files=100):
        from PIL import Image, ImageChops, ImageStat
        self.Image, self.ImageChops, self.ImageStat = Image, ImageChops, ImageStat
        self.output, self.app, self.hc, self.root = output, app, hc, root
        self.temp = tempfile.TemporaryDirectory(prefix="herdr-page-", dir="/var/tmp" if sys.platform == "darwin" else None)
        self.work = Path(self.temp.name)
        self.home = self.work / "app"
        self.home.mkdir()
        self.env = dict(os.environ)
        # Keep personal data/terminal sessions out of the benchmark. Absolute binary paths
        # are resolved before HOME is replaced. Do not point at ~/.config/herdr-app.
        for key in ("HC_SOCKET", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET", "HC_SCOPE",
                    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"):
            self.env.pop(key, None)
        personal = self.work / "home"
        personal.mkdir()
        self.env.update(HOME=str(personal), HERDR_APP_HOME=str(self.home),
                        HC_SESSION="pb" + uuid.uuid4().hex[:10],
                        XDG_CONFIG_HOME=str(self.work / "config"), XDG_STATE_HOME=str(self.work / "state"),
                        XDG_CACHE_HOME=str(self.work / "cache"), XDG_DATA_HOME=str(self.work / "data"),
                        HERDR_APP_NO_SOUND="1", HERDR_APP_BENCH=str(output / "frames.jsonl"),
                        GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null", GIT_TERMINAL_PROMPT="0")
        self.proc, self.core, self.log, self.awake = None, False, None, None
        self.shot_path = self.work / "current.png"
        self.fixture = None
        self.projects = {}
        self.tolerance = tolerance
        self.resources = runpy.run_path(str(ROOT / 'scripts/benchmark-resources.py'))
        self.diagnostic = diagnostic
        self.fixture_files = fixture_files
        self.diagnostics = runpy.run_path(str(ROOT / 'scripts/benchmark-diagnostics.py')) if diagnostic else None

    def command(self, *args, timeout=20):
        p = subprocess.run(args, env=self.env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
        if p.returncode:
            raise RuntimeError(f"{Path(args[0]).name} {args[1]}: {p.stderr.strip() or p.stdout.strip()}")
        return p.stdout

    def do(self, command, args=None):
        raw = self.command(self.app, "do", command, *([json.dumps(args)] if args is not None else []))
        data = json.loads(raw or "{}")
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(str(data["error"]))
        return data

    def status(self):
        return json.loads(self.command(self.app, "status", timeout=5))

    def check(self, layout):
        state = self.status()
        if state.get("layout") != layout or state.get("errors") or state.get("overlays"):
            raise RuntimeError("Unexpected layout or runtime error: " + json.dumps(state))
        return state

    def setup(self):
        for name in ("layouts", "mods", "themes"):
            shutil.copytree(self.root / name, self.home / name)
        self.instrumentation = self.diagnostics["install"](self.home / "mods") if self.diagnostics else []
        for name in ("keys.json", "programs.json", "settings.json"):
            shutil.copy2(self.root / name, self.home / name)
        settings = json.loads((self.home / "settings.json").read_text())
        settings["zoom"] = 1
        settings["sounds"] = {"enabled": False}
        (self.home / "settings.json").write_text(json.dumps(settings))
        (self.home / "shared.json").write_text(json.dumps({"frame.welcomed": True, "layout": "orca"}))
        # An isolated benchmark must never fire paid agents or show a release-note
        # modal. Seed real, disabled task rows, not fake CLI success responses.
        tasks = [{"id": f"{agent}-reset-ping", "name": f"{name} reset ping",
                  "agent": agent, "enabled": False,
                  "trigger": {"type":"reset","provider":agent,"window":"h5","delaySeconds":5},
                  "argv":[agent,"--version"],"cwd":None}
                 for agent,name in (("claude","Claude"),("codex","Codex"))]
        (self.home / "tasks.json").write_text(json.dumps({"version":1,"tasks":tasks}))
        version = re.search(r"\d+\.\d+\.\d+(?:[-+][\w.-]+)?", self.command(self.app, "--version"))
        if not version:
            raise RuntimeError("Cannot establish Herdr release-note fixture")
        running = version.group()
        (self.home / "update-notes.json").write_text(json.dumps({"last_run":running,"presented":[running]}))
        for kind in ("git", "folder"):
            folder = self.work / kind
            folder.mkdir()
            for i in range(self.fixture_files):
                (folder / f"fixture-{i:03}.txt").write_text(f"benchmark fixture {i}\n")
            if kind == "git":
                self.command("git", "-C", str(folder), "init", "-q")
                self.command("git", "-C", str(folder), "add", ".")
                self.command("git", "-C", str(folder), "-c", "user.name=Benchmark",
                             "-c", "user.email=benchmark@example.invalid", "commit", "-qm", "fixture")
                (folder / "fixture-001.txt").write_text("modified fixture\n")
        self.command(self.hc, "server", "start")
        self.core = True
        self.log = (self.output / "app.log").open("w")
        self.proc = subprocess.Popen([self.app], env=self.env, stdout=self.log, stderr=self.log, stdin=subprocess.DEVNULL)
        start = time.monotonic()
        if sys.platform == 'darwin' and shutil.which('caffeinate'):
            self.awake = subprocess.Popen(['caffeinate', '-d', '-w', str(self.proc.pid)], env=self.env)
        while time.monotonic() - start < 30:
            if self.proc.poll() is not None:
                raise RuntimeError("Herdr exited; see app.log")
            try:
                self.status()
                self.shot()
                break
            except (RuntimeError, subprocess.TimeoutExpired, OSError):
                time.sleep(.2)
        else:
            raise RuntimeError("No native window/screenshot; run in an active desktop session")
        self.startup_capture_ms = (time.monotonic() - start) * 1000
        # The first synchronization can open a modal after the first screenshot.
        time.sleep(1)
        for _ in range(4):
            if not self.status().get("overlays"):
                break
            self.do("overlay.close")
            time.sleep(.3)
        self.check("orca")

    def use_fixture(self, kind):
        if kind == "ssh":
            raise RuntimeError("SSH fixture not available; Ports is intentionally unmeasured")
        if self.fixture == kind:
            return
        if kind not in self.projects:
            self.do("space.new", {"name": "Benchmark " + kind, "folder": str(self.work / kind),
                                 "argv": [sys.executable, "-u", "-c", "import time; print('BENCHMARK READY',flush=True); time.sleep(3600)"]})
            time.sleep(.5)
            current = self.status().get("space")
            if not current:
                raise RuntimeError("Fixture space not selected")
            self.projects[kind] = current
        else:
            self.do("space.select", {"id": self.projects[kind]})
        self.fixture = kind
        time.sleep(.5)

    def select(self, row, page):
        self.do("layout.select", {"stack": row["stack"], "child": page})

    def prepare(self, row):
        self.use_fixture(row["fixture"])
        if self.status().get("layout") != row["layout"]:
            self.do("layout.switch", {"name": row["layout"]})
            time.sleep(.4)
        # Keep panel visible for panel tests and hide it for main tests; compare
        # screenshots only within identical fixture/layout/viewport conditions.
        self.do("layout.show" if row["stack"] == "panel-body" else "layout.hide", {"id": "panel"})
        self.check(row["layout"])

    def shot(self):
        self.shot_path.unlink(missing_ok=True)
        self.command(self.app, "shot", str(self.shot_path), timeout=10)
        with self.Image.open(self.shot_path) as image:
            return image.convert("RGB")

    def distance(self, a, b, roi):
        if a.size != b.size:
            raise RuntimeError(f"Viewport changed: {a.size} vs {b.size}; reference must match")
        w, h = a.size
        box = tuple(round(v * (w if i % 2 == 0 else h)) for i, v in enumerate(roi))
        # Mean per-channel absolute difference over the ROI, normalized to 0..1.
        diff = self.ImageChops.difference(a.crop(box), b.crop(box))
        return sum(self.ImageStat.Stat(diff).mean) / (3 * 255)

    def cleanup(self):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait()
            if self.core:
                try:
                    world = json.loads(self.command(self.hc, "ls", "--json"))
                    for terminal in world.get("terminals", []):
                        self.command(self.hc, "kill", terminal["address"])
                finally:
                    self.command(self.hc, "server", "stop")
        finally:
            if self.awake and self.awake.poll() is None:
                self.awake.terminate()
                self.awake.wait(timeout=5)
            if self.log:
                self.log.close()
            self.temp.cleanup()


def reference_id(row):
    return row["layout"] + "--" + row["page"]


def validate_roi(roi):
    if not isinstance(roi, list) or len(roi) != 4 or not all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in roi):
        raise ValueError("ROI needs four normalized coordinates in [0,1]")
    if roi[0] >= roi[2] or roi[1] >= roi[3]:
        raise ValueError("ROI must have positive width and height")
    return roi


def write_summary(output, report):
    fields = ["layout", "stack", "page", "fixture", "status", "attempts", "matched", "failure_rate",
              "command_p50_ms", "feedback_p50_ms", "feedback_p95_ms", "match_p50_ms", "match_p95_ms",
              "match_max_ms", "capture_p50_ms", "idle_cpu_pct_one_core", "idle_rss_mib", "retained_rss_delta_mib", "reason"]
    with (output / "summary.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for page in report["pages"]:
            warm = page.get("warm", {})
            metrics = warm.get("metrics", {})
            value = lambda key, q: metrics.get(key, {}).get(q)
            writer.writerow({**{k: page.get(k) for k in fields if k in page},
                             "attempts": warm.get("attempts"), "matched": warm.get("matched"),
                             "failure_rate": warm.get("failure_rate"),
                             "command_p50_ms": value("command_ms", "p50"),
                             "feedback_p50_ms": value("first_change_ms", "p50"),
                             "feedback_p95_ms": value("first_change_ms", "p95"),
                             "match_p50_ms": value("reference_match_ms", "p50"),
                             "match_p95_ms": value("reference_match_ms", "p95"),
                             "match_max_ms": value("reference_match_ms", "max"),
                             "capture_p50_ms": value("capture_ms", "p50"),
                             "idle_cpu_pct_one_core": page.get("idle_app_process", {}).get("cpu_pct_one_core"),
                             "idle_rss_mib": page.get("idle_app_process", {}).get("rss_after_mib"),
                             "retained_rss_delta_mib": page.get("rss_after_matches", {}).get("delta_mib")})


def frame_summary(rows):
    # Upstream exports per-second aggregate counters, not individual frame times.
    frames = sum(r.get("window", 0) for r in rows)
    return {"seconds_observed": len(rows), "window_frames": frames,
            "mean_cpu_frame_ms": round(sum(r.get("frame_ms", 0) for r in rows) / frames, 3) if frames else None,
            "mean_script_ms_per_second": round(sum(r.get("script_ms", 0) for r in rows) / len(rows), 3) if rows else None}


def read_frames(path):
    if not path.exists():
        return []
    lines = path.read_text().splitlines()
    rows = []
    for line in lines:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # writer may be appending the last line
    return rows


def run(args):
    rows = [r for r in plan() if (not args.layout or r["layout"] == args.layout) and (not args.stack or r["stack"] == args.stack) and (not args.page or r["page"] in args.page)]
    if not rows:
        raise ValueError("No benchmark pages matched")
    if args.plan:
        print(json.dumps(rows, indent=2))
        return 0
    if args.capture and args.diagnostic:
        raise ValueError("Capture references without instrumentation; use diagnostics on a separate measurement run")
    if not (args.capture or args.references or args.candidate_baseline):
        raise ValueError("Choose --plan, --capture, or --references DIR")
    if args.idle_seconds < 3 or args.fixture_files < 2 or args.fixture_files > 10000 or args.samples < 1 or args.timeout <= 0 or args.poll < 0 or args.settle < 0 or not (0 < args.tolerance < .1):
        raise ValueError("Invalid benchmark parameters")
    app, hc = shutil.which(args.app), shutil.which("hc")
    if not app or not hc:
        raise RuntimeError("herdr-app and hc must be installed and on PATH")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    refs = Path(args.references).resolve() if args.references else None
    approvals = json.loads((refs / "approved.json").read_text()) if refs else {}
    report = {"schema": 1, "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "platform": platform.platform(), "machine": platform.machine(), "mode": "capture" if args.capture else ("diagnostic_candidate" if args.diagnostic else "candidate_baseline") if args.candidate_baseline else "measure",
              "samples": args.samples, "timeout_seconds": args.timeout, "poll_seconds": args.poll,
              "tolerance": args.tolerance, "settle_seconds": args.settle, "fixture_files": args.fixture_files,
              "diagnostic": args.diagnostic, "idle_seconds": args.idle_seconds, "cpu_count": os.cpu_count(), "processor": platform.processor(), "budgets_ms": BUDGETS,
              "metric_contract": "CLI dispatch to screenshot response; observation upper bound, not physical input-to-paint or proof of data readiness",
              "pages": []}
    driver = None
    manifest = {}
    try:
        driver = Native(output, app, hc, ROOT, args.tolerance, args.diagnostic, args.fixture_files)
        report["herdr_version"] = driver.command(app, "--version").strip()
        driver.setup()
        report["startup_first_screenshot_ms"] = driver.startup_capture_ms
        report["instrumentation"] = driver.instrumentation
        for row in rows:
            result = dict(row)
            report["pages"].append(result)
            key = reference_id(row)
            if row["fixture"] == "ssh":
                result.update(status="not_measured", reason="requires an isolated SSH fixture")
                continue
            if refs and key not in approvals:
                result.update(status="not_measured", reason="no approved reference/ROI")
                continue
            try:
                driver.prepare(row)
                other = origin_page(row)
                if args.capture or args.candidate_baseline:
                    driver.select(row, row["page"])
                    roi = [.30, .13, .95, .85] if row["stack"] == "main" else [.72, .15, .98, .88]
                    image = stable_reference(driver, row, roi, args.settle, args.tolerance)
                    image.save(output / (key + ".png"))
                    # Candidate capture also exercises the native resource sampler, but is not a latency baseline.
                    if args.capture:
                        result["idle_app_process"] = driver.resources["measure_idle"](driver.proc.pid, args.idle_seconds)
                    manifest[key] = {"image": key + ".png", "approved": False,
                                     "roi": roi}
                    result["status"] = "reference_candidate"
                    if args.capture:
                        continue
                entry = manifest[key] if args.candidate_baseline else approvals[key]
                if not args.candidate_baseline and entry.get("approved") is not True:
                    result.update(status="not_measured", reason="reference not approved")
                    continue
                roi = validate_roi(entry["roi"])
                reference_root = output if args.candidate_baseline else refs
                image_path = (reference_root / entry["image"]).resolve()
                if not image_path.is_relative_to(reference_root):
                    raise ValueError("Reference image must stay within reference directory")
                with driver.Image.open(image_path) as image:
                    target = image.convert("RGB")
                result["reference"] = {"sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
                                       "roi": roi, "viewport": list(target.size)}
                result["from_page"] = other
                # first observed visit is not a guaranteed cold cache; warm visits repeat
                # the same target from an alternate page, with independently captured before.
                attempts, retained_rss = [], []
                for i in range(args.samples + 1):
                    driver.select(row, other)
                    time.sleep(args.settle)
                    driver.check(row["layout"])
                    control_start = time.monotonic()
                    before = driver.shot()
                    control_ms = (time.monotonic() - control_start) * 1000
                    if i == 0 and args.candidate_baseline:
                        before.save(output / (key + "--before.png"))
                    start_ms = time.time_ns() // 1000000
                    sample = observe(driver, before, target, lambda: driver.select(row, row["page"]),
                                     roi, args.timeout, args.poll, args.tolerance)
                    sample["diagnostic_interval_ms"] = [start_ms, time.time_ns() // 1000000]
                    sample["control_capture_ms"] = control_ms
                    driver.check(row["layout"])
                    sample["phase"] = "first_visit" if i == 0 else "warm"
                    attempts.append(sample)
                    # Retain partial evidence if a later visit fails unexpectedly.
                    result["samples"] = attempts
                    if sample["status"] != "matched" and args.candidate_baseline:
                        driver.shot().save(output / (key + f"--failure-{i:02}.png"))
                    if sample["status"] == "matched":
                        retained_rss.append(driver.resources["snapshot"](driver.proc.pid)["rss_mib"])
                warm = summarize(attempts[1:])
                result.update(status=(("diagnostic_measured" if args.diagnostic else "provisional_measured") if args.candidate_baseline else "measured") if all(s["status"] == "matched" for s in attempts) else "incomplete",
                              samples=attempts, first_visit=attempts[0], warm=warm,
                              rss_after_matches=driver.resources["retention"](retained_rss),
                              measurement_control=measurement_control(attempts[1:]))
                # Collect whole-second aggregates independently of transition capture.
                if attempts[-1]["status"] == "matched":
                    if args.candidate_baseline:
                        driver.shot().save(output / (key + "--after.png"))
                    time.sleep(args.settle)
                    frame_path = output / "frames.jsonl"
                    offset = len(read_frames(frame_path))
                    result["idle_app_process"] = driver.resources["measure_idle"](driver.proc.pid, args.idle_seconds)
                    result["settled_cpu_frames"] = frame_summary(read_frames(frame_path)[offset + 1:])
                if driver.diagnostics:
                    events = driver.diagnostics["parse_events"]((output / "app.log").read_text(errors="replace"))
                    result["diagnostic_spans"] = []
                    for sample in attempts:
                        lo, hi = sample["diagnostic_interval_ms"]
                        result["diagnostic_spans"].append({"phase": sample["phase"],
                            "groups": driver.diagnostics["summarize_events"](events, lo, hi, row["mod"])})
                # A value over budget is a warning, not proof of an actual regression:
                # polling, process dispatch and screenshot encoding all contribute.
                result["budget_warning"] = [
                    k for k, metric, budget in [
                        ("feedback_upper_bound", "first_change_ms", BUDGETS["feedback_ms"]),
                        ("warm_reference_match_upper_bound", "reference_match_ms", BUDGETS["warm_match_ms"]),
                    ] if (warm["metrics"][metric]["p95"] or 0) > budget
                ]
            except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as error:
                result.update(status="error", reason=str(error))
            finally:
                print(key, result["status"], flush=True)
    except Exception as error:
        report["fatal_error"] = str(error)
        raise
    finally:
        try:
            if driver:
                driver.cleanup()
        finally:
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            write_summary(output, report)
            if args.capture or args.candidate_baseline:
                (output / "approved.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if any(p["status"] in ("error", "incomplete") for p in report["pages"]):
        return 1
    if args.candidate_baseline and not any(p["status"] == ("diagnostic_measured" if args.diagnostic else "provisional_measured") for p in report["pages"]):
        return 2
    if refs and not any(p["status"] == "measured" for p in report["pages"]):
        return 2  # no approved successful measurement; never a green benchmark
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--capture", action="store_true")
    mode.add_argument("--candidate-baseline", action="store_true", help="Capture and measure provisional references in the same isolated session; with --diagnostic, collect separate instrumented evidence; never auto-approve")
    mode.add_argument("--references")
    p.add_argument("--app", default="herdr-app")
    p.add_argument("--layout", choices=LAYOUTS)
    p.add_argument("--stack", choices=("main", "panel-body"))
    p.add_argument("--page", action="append", help="Repeat to select specific stack children")
    p.add_argument("--output", default="page-benchmark-" + time.strftime("%Y%m%d-%H%M%S"))
    p.add_argument("--samples", type=int, default=30)
    p.add_argument("--fixture-files", type=int, default=100, help="Repeat at 10/100/1000 with matching references")
    p.add_argument("--idle-seconds", type=float, default=10, help="Settled app-only CPU/RSS observation interval")
    p.add_argument("--diagnostic", action="store_true", help="Separate diagnostic run: trace JS render and host calls in disposable mod copies")
    p.add_argument("--timeout", type=float, default=5)
    p.add_argument("--poll", type=float, default=.025)
    p.add_argument("--settle", type=float, default=1.5)
    p.add_argument("--tolerance", type=float, default=.005)
    try:
        sys.exit(run(p.parse_args()))
    except (RuntimeError, ValueError, OSError, ImportError) as error:
        sys.exit(str(error))
