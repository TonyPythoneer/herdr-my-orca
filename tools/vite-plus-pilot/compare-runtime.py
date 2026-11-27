#!/usr/bin/env python3
"""Compare the exact parent, unmodified delivery source, and Vite+ packed runtime.
No golden updates, skipped failures, live sync, or changes to tracked production files.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "tools/vite-plus-pilot/dist"

TEST = re.compile(r"\.test\.[cm]?js$")
FAILURE = re.compile(r"^\s*✖\s+(.+?)\s*$", re.MULTILINE)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True)


def test_files(root):
    return sorted(p for p in git(root, "ls-files", "-z", "--", "mods", "scripts", "orca-ui/features").split("\0") if TEST.search(p))


def run_file(root, path, logs, stub, packed=False):
    with tempfile.TemporaryDirectory(prefix="herdr-test-home-") as home:
        env = {**os.environ, "HOME": home, "HERDR_APP_HOME": str(Path(home) / "app"),
               "PATH": str(stub.parent) + os.pathsep + os.environ["PATH"], "NO_COLOR": "1", "FORCE_COLOR": "0"}
        # Never inherit candidate mode into parent or source tests.
        env.pop("HERDR_PACKED_ARTIFACT_DIR", None)
        if packed:
            env["HERDR_PACKED_ARTIFACT_DIR"] = str(DIST)
        Path(env["HERDR_APP_HOME"]).mkdir()
        try:
            p = subprocess.run(["node", "--test", "--test-reporter=spec", "--test-timeout=60000", path],
                               cwd=root, env=env, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, timeout=120)
            if p.returncode == 0:
                return []
            output = p.stdout
            names = {re.sub(r"\s*\([\d.]+ms\)$", "", s).strip()
                     for s in FAILURE.findall(output) if not s.startswith("failing tests")}
            if not names:
                names = {f"runner exit {p.returncode} without named failure"}
        except subprocess.TimeoutExpired as exc:
            output = str(exc.stdout or "")
            names = {"runner timeout"}
        target = logs / (path + ".log")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(output)
        return [f"{path}\t{name}" for name in sorted(names)]


def run_suite(root, files, logs, stub):
    print(f"{root.name}: {len(files)} test files", flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda path: run_file(root, path, logs, stub, packed=root.name == "packed"), files))
    failed = sorted({failure for result in results for failure in result})
    print(f"{root.name}: {len(failed)} named failures", flush=True)
    return failed


def main():
    # Compare the exact first parent of the tested PR merge, not a stale hardcoded base.
    parents = git(ROOT, "rev-list", "--parents", "-n", "1", "HEAD").split()
    if len(parents) != 3:
        raise RuntimeError("Expected the GitHub PR merge commit with two parents")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    if parents[2] != event["pull_request"]["head"]["sha"]:
        raise RuntimeError("Tested merge does not match the PR head")
    base = parents[1]
    delivery = DIST / "delivery"
    if not (delivery / "mods").is_dir():
        raise RuntimeError("Missing packed delivery")
    with tempfile.TemporaryDirectory(prefix="herdr-runtime-parity-") as tmp:
        temp = Path(tmp)
        stub = temp / "bin/herdr-app"
        stub.parent.mkdir()
        stub.write_text('#!/bin/sh\nif [ "$#" -eq 2 ] && [ "$1" = do ] && [ "$2" = orca-status-bar.refresh ]; then exit 0; fi\nexit 1\n')
        stub.chmod(0o755)
        roots = {name: temp / name for name in ("parent", "source", "packed")}
        created = []
        try:
            for name, ref in (("parent", base), ("source", "HEAD"), ("packed", "HEAD")):
                git(ROOT, "worktree", "add", "--detach", str(roots[name]), ref)
                created.append(roots[name])
            # The packed worktree is disposable; tests retain the real git metadata and fixtures.
            shutil.copytree(delivery / "mods", roots["packed"] / "mods", dirs_exist_ok=True)
            parent_files = test_files(roots["parent"])
            source_files = test_files(roots["source"])
            if source_files != test_files(roots["packed"]):
                raise RuntimeError("Packed test inventory changed")
            if not parent_files or not source_files:
                raise RuntimeError("No test files discovered")
            results = {
                name: run_suite(root, parent_files if name == "parent" else source_files,
                                DIST / "runtime-logs" / name, stub)
                for name, root in roots.items()
            }
            parent, source, packed = (set(results[name]) for name in ("parent", "source", "packed"))
            report = {"base": base, "head": git(ROOT, "rev-parse", "HEAD").strip(),
                      "parentFailures": results["parent"], "sourceFailures": results["source"],
                      "packedFailures": results["packed"], "newSourceFailures": sorted(source - parent),
                      "newPackFailures": sorted(packed - source), "fixedParentFailures": sorted(parent - source)}
            (DIST / "runtime-parity.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2))
            # Existing production CI separately requires zero failures. No new named failures are allowed here.
            return 1 if report["newSourceFailures"] or report["newPackFailures"] else 0
        finally:
            for root in reversed(created):
                git(ROOT, "worktree", "remove", "--force", str(root))


if __name__ == "__main__":
    raise SystemExit(main())
