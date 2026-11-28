#!/usr/bin/env python3
"""Review and apply this refactor's changed mod files to a local Herdr app home.

Dry-run by default. Refuses live-only edits, symlinks, dirty source files and
unavailable pre-refactor history. Never copies a directory or deletes anything.
"""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
BASE = "94cdf6ffef076898e52baa10c5a75cfaa7d1d8f8"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def changed_paths(base):
    fields = iter(git("diff", "--name-status", "-z", "--find-renames", base, "HEAD", "--", "mods/").decode().split("\0"))
    for kind in fields:
        if not kind:
            break
        path = next(fields)
        if kind.startswith(("R", "C")):
            yield kind, path, next(fields)
        else:
            yield kind, path, None


def safe_path(root, relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "mods":
        raise ValueError("unsafe relative path")
    parent = root
    for part in path.parts:
        parent = parent / part
        if parent.is_symlink():
            raise ValueError("symlink: " + str(parent))
        if parent.exists() and parent != root / path and not parent.is_dir():
            raise ValueError("non-directory ancestor: " + str(parent))
    return root / path


def mode(path):
    return stat.S_IMODE(path.stat().st_mode)


def test_artifact(path):
    name = Path(path).name
    return ".test." in name or name.endswith((".snap.json", ".golden.json", "-test.js", "-test.mjs"))


def inspect_change(base, kind, relative, live):
    src = safe_path(ROOT, relative)
    dst = safe_path(live, relative)
    expected = git("show", "HEAD:" + relative)
    if not src.is_file() or src.read_bytes() != expected:
        raise ValueError("checkout differs from committed HEAD")
    entry = git("ls-tree", "HEAD", "--", relative).decode().split()[0]
    if entry not in ("100644", "100755") or bool(mode(src) & 0o111) != (entry == "100755"):
        raise ValueError("source mode or file type differs from HEAD")
    if dst.exists() and not dst.is_file():
        raise ValueError("live path is not a regular file")
    if not dst.exists() and test_artifact(relative):
        return None, "skip absent test artifact"
    original = git("show", base + ":" + relative) if kind == "M" else None
    current = dst.read_bytes() if dst.exists() else None
    if current == expected and mode(dst) == mode(src):
        return None, "already matches"
    if current is not None and current not in (original, expected):
        raise ValueError("live-only edit; review before copying")
    if kind == "M" and current is None:
        raise ValueError("previously tracked file is missing live; review before copying")
    return (relative, src, dst, expected, current, mode(src), mode(dst) if dst.exists() else None), "copy"


def plan(base, live):
    copies, conflicts = [], []
    for kind, relative, renamed in changed_paths(base):
        if kind not in ("A", "M"):
            print("MANUAL", kind, relative, "-> " + renamed if renamed else "")
            continue
        try:
            copy, reason = inspect_change(base, kind, relative, live)
            print(reason.upper(), relative)
            if copy:
                copies.append(copy)
        except (ValueError, OSError, subprocess.CalledProcessError) as error:
            conflicts.append(relative)
            print("CONFLICT", relative, str(error), file=sys.stderr)
    return copies, conflicts


def app_errors(live):
    env = {**os.environ, "HERDR_APP_HOME": str(live)}
    result = subprocess.check_output(["herdr-app", "status"], env=env, text=True)
    status = json.loads(result)
    if not isinstance(status.get("errors"), list):
        raise ValueError("herdr-app status did not report an errors list")
    return {json.dumps(error, sort_keys=True, ensure_ascii=False) for error in status["errors"]}


def apply_copies(copies, live):
    subprocess.run([str(ROOT / "node_modules/.bin/vpx"), "src/tooling/build-orca-ui.ts", "--check", "--out", "."], cwd=ROOT, check=True)
    before = app_errors(live)
    for relative, src, dst, expected, old, expected_mode, old_mode in copies:
        if safe_path(live, relative) != dst or safe_path(ROOT, relative) != src:
            raise ValueError("path changed during preflight: " + relative)
        current = dst.read_bytes() if dst.exists() else None
        current_mode = mode(dst) if dst.exists() else None
        if current != old or current_mode != old_mode:
            raise ValueError("live changed during preflight: " + relative)
        if src.read_bytes() != expected or mode(src) != expected_mode:
            raise ValueError("source changed during preflight: " + relative)
        dst.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["cp", "-p", str(src), str(dst)], check=True)
        if dst.read_bytes() != expected or mode(dst) != expected_mode:
            raise ValueError("copy verification failed: " + relative)
        print("VERIFIED", relative)
    # The app reloads asynchronously. Check after the reload has had time to settle.
    time.sleep(2)
    new_errors = app_errors(live) - before
    if new_errors:
        raise ValueError("new Herdr errors: " + ", ".join(sorted(new_errors)))
    print("Live bytes/modes verified; no new Herdr errors reported. Human click-through remains separate.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--live", type=Path, default=Path.home() / ".config/herdr-app")
    parser.add_argument("--apply", action="store_true", help="copy only after a clean preflight")
    args = parser.parse_args()
    try:
        base = git("rev-parse", "--verify", args.base + "^{commit}").decode().strip()
        live = args.live.resolve(strict=True)
        if not live.is_dir() or live == ROOT or ROOT in live.parents or live in ROOT.parents:
            raise ValueError("live directory must be separate from the checkout")
        copies, conflicts = plan(base, live)
        print(f"{len(copies)} to copy; {len(conflicts)} conflicts")
        if conflicts:
            return 1
        if args.apply:
            apply_copies(copies, live)
        else:
            print("Dry run; no live files changed.")
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("STOP:", error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
