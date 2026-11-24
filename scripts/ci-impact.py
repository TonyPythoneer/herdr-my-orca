#!/usr/bin/env python3
"""Select bounded CI work from tracked paths. Unknown impact fails open to full validation."""
import argparse
from collections import defaultdict
import json
import os
import posixpath
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
TEST = re.compile(r"\.test\.[cm]?js$")
# Cross-mod contracts that use commands/shared state rather than imports.
CONTRACTS = {
    "orca-spaces": {"orca-menu", "orca-worktree", "orca-status"},
    "orca-menu": {"orca-spaces", "orca-pane"},
    "orca-status": {"orca-spaces", "orca-worktree"},
    "orca-worktree": {"orca-spaces", "orca-status"},
    "agent-config": {"orca-agent-manager", "orca-new-menu"},
    "orca-agent-manager": {"agent-config", "orca-new-menu"},
    "orca-new-menu": {"agent-config", "orca-agent-manager"},
    "orca-tabs": {"orca-nav", "orca-pane", "orca-panel-head"},
    "orca-panel-head": {"orca-files", "orca-changes", "orca-agents", "orca-panel-gap"},
    "orca-chrome": {"orca-tabs", "orca-tasks"},
}
CHROME = {"orca-chrome", "orca-tabs", "orca-nav", "orca-pane", "orca-float", "orca-landing"}
PANEL = {"orca-panel-head", "orca-panel-gap"}


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root).decode().split("\0")


def module(path):
    parts = path.split("/")
    return parts[1] if len(parts) > 2 and parts[0] == "mods" else None


def suite(path):
    return "behavior" if re.search(r"(?:flow|golden)\.test\.|/(?:render|git-refresh|interactions)\.test\.", path) else "unit"


def routes(root):
    result = []
    for path in sorted((root / "layouts").glob("orca*.json")):
        def walk(node):
            if node.get("type") == "stack" and node.get("id") in ("main", "panel-body"):
                for child in node.get("children", []):
                    result.append((path.stem, node["id"], child["id"], child.get("content", {}).get("mod")))
            for child in node.get("children", []):
                walk(child)
        walk(json.loads(path.read_text()))
    return result


def shared_outputs(root):
    result = defaultdict(set)
    manifest = root / "orca-ui/shared/manifest.json"
    if manifest.exists():
        for entry in json.loads(manifest.read_text())["files"]:
            result[entry["source"]].update(filter(None, map(module, entry["outputs"])))
    return result


def dependent_tests(root, files, changed, tests):
    """Reverse transitive relative-path references, including imports and fixture URLs."""
    tracked = set(files)
    reverse = defaultdict(set)
    for path in tracked:
        if not path.startswith(("mods/", "scripts/", "orca-ui/")) or not path.endswith((".js", ".mjs", ".cjs", ".py")):
            continue
        source = (root / path).read_text(errors="replace")
        for target in re.findall(r"""['"](\.{1,2}/[^'"\n]+)['"]""", source):
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
            if resolved in tracked:
                reverse[resolved].add(path)
    seen = set(changed)
    queue = list(seen)
    while queue:
        for user in reverse[queue.pop()] - seen:
            seen.add(user)
            queue.append(user)
    return seen.intersection(tests)


def select(root, files, changed, force=False):
    tests = sorted(p for p in files if TEST.search(p) and p.startswith(("mods/", "scripts/", "orca-ui/features/")))
    mods = {module(p) for p in files if p.endswith("/mod.json") and module(p)}
    layouts = routes(root)
    shared = shared_outputs(root)
    asset_manifest = root / "mods/orca-assets/resources.json"
    assets = json.loads(asset_manifest.read_text()) if asset_manifest.exists() else {}
    direct, affected, selected, lint, page_keys, reasons = set(), set(), set(), set(), set(), {}
    full = force
    all_native = force
    git_bench = force
    projection_bench = force
    snapshot = force
    config = force
    for path in sorted(set(changed)):
        if path in ("README.md", "metrics/WORKERS.md") or (path.startswith("docs/") and path.endswith(".md")):
            reasons[path] = "documentation"
        elif TEST.search(path) and path in tests:
            selected.add(path)
            reasons[path] = "test-only"
        elif path == "scripts/ci-impact-test.py":
            reasons[path] = "selector contract test"
        elif path == "scripts/benchmark-pages-test.py":
            selected.add("scripts/benchmark-pages.test.js")
            reasons[path] = "benchmark harness test only"
        elif module(path) in mods and (path.endswith(".golden.json") or Path(path).name in ("flow-host.mjs", "flow-nodes.mjs", "golden.mjs")):
            selected.update(p for p in tests if module(p) == module(path))
            reasons[path] = "mod test fixture"
        elif path.startswith("ui-snapshot/"):
            snapshot = True
            reasons[path] = "snapshot observer"
        elif path.startswith("scripts/benchmark-"):
            if path == "scripts/benchmark-git-status.py":
                git_bench = True
            elif path == "scripts/benchmark-worktree-plan.mjs":
                projection_bench = True
                lint.add(path)
            else:
                all_native = True
                selected.update(p for p in tests if p.startswith("scripts/benchmark-"))
            reasons[path] = "benchmark harness"
        elif path in assets:
            direct.update(assets[path])
            selected.add("scripts/shared-config-assets.test.mjs")
            config = True
            reasons[path] = "static config resource consumers"
        elif path in shared:
            direct.update(shared[path])
            config = True
            reasons[path] = "generated shared source consumers"
        elif path.startswith("orca-ui/features/panel/head/"):
            direct.add("orca-panel-head")
            selected.update(p for p in tests if p.startswith("orca-ui/features/panel/head/"))
            config = True
            reasons[path] = "panel head feature"
        elif module(path) in mods:
            direct.add(module(path))
            config = True
            if path == "mods/orca-spaces/main.js":
                git_bench = True
            if path == "mods/orca-spaces/worktree-plan.js":
                projection_bench = True
            reasons[path] = "mod implementation or fixture"
        elif path == "layouts/orca.json":
            config = True
            selected.update(p for p in tests if p.startswith(("mods/", "orca-ui/features/")) or p == "scripts/layout.test.js")
            page_keys.update((l, s, p) for l, s, p, _ in layouts if l == Path(path).stem)
            reasons[path] = "layout integration"
            affected.update(mods)
        elif path.startswith("scripts/") and not path.startswith(("scripts/ci-impact", "scripts/metrics", "scripts/build-orca-ui", "scripts/orca-ui-manifests", "scripts/check-config", "scripts/sync-")):
            matching = dependent_tests(root, files, [path], tests)
            matching.update(t for t in tests if t.startswith("scripts/") and Path(path).name in (root / t).read_text(errors="replace"))
            if matching:
                selected.update(matching)
                if path.endswith((".js", ".mjs", ".cjs")) and path in files:
                    lint.add(path)
                reasons[path] = "script dependency tests"
            else:
                full = all_native = True
                reasons[path] = "unclassified script: full fallback"
        else:
            full = True
            all_native = True
            reasons[path] = "global or unclassified: full fallback"
    affected.update(direct)
    selected.update(dependent_tests(root, files, changed, tests))
    for mod in direct:
        affected.update(CONTRACTS.get(mod, set()) & mods)
    for mod in affected:
        selected.update(p for p in tests if module(p) == mod)
    # Script tests sometimes read real mods via filesystem instead of imports.
    for test in tests:
        if not test.startswith("scripts/"):
            continue
        source = (root / test).read_text(errors="replace")
        if any(mod in source for mod in affected) or any(Path(p).name in source for p in changed if p.startswith("scripts/")):
            selected.add(test)
    if direct:
        # Build/manifest checks catch generated drift; these tests cover their contracts.
        selected.update(p for p in tests if p.startswith("scripts/") and ("orca-ui-manifests" in p or "build-orca-ui" in p) and any(pth in shared or pth.startswith("orca-ui/") for pth in changed))
    for l, s, p, mod in layouts:
        if mod in direct or (direct & CHROME) or (direct & PANEL and s == "panel-body"):
            page_keys.add((l, s, p))
    if full:
        selected.update(tests)
        affected.update(mods)
        git_bench = projection_bench = snapshot = config = True
    if all_native:
        page_keys.update((l, s, p) for l, s, p, _ in layouts)
    # Lint every affected handwritten area, not unrelated modules. Global fallback uses all.
    if full:
        lint.update(("mods", "scripts", "orca-ui"))
    else:
        lint.update("mods/" + m for m in direct)
        if any(p.startswith("orca-ui/") and not TEST.search(p) for p in changed):
            lint.add("orca-ui")
    groups = defaultdict(list)
    for l, s, p in sorted(page_keys):
        groups[l, s].append(p)
    matrix = [{"layout": l, "stack": s, "pages": ps} for (l, s), ps in sorted(groups.items())]
    test_matrix = [{"suite": k, "files": sorted(p for p in selected if suite(p) == k)}
                   for k in ("unit", "behavior") if any(suite(p) == k for p in selected)]
    syntax = sorted(p for p in files if p.endswith((".js", ".mjs", ".cjs", ".py", ".sh")) and (full or p in changed))
    return {"schema": 1, "full": full, "changed": sorted(set(changed)), "reasons": reasons,
            "direct_mods": sorted(direct), "native_mods": sorted(affected),
            "test_matrix": {"include": test_matrix}, "total_test_files": len(tests),
            "selected_test_files": len(selected), "lint_paths": sorted(lint),
            "config": config, "snapshot": snapshot, "git_benchmark": git_bench, "projection_benchmark": projection_bench, "syntax_paths": syntax,
            "native_matrix": {"include": matrix}, "native_routes": len(page_keys),
            "total_native_routes": len(layouts)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    files = [x for x in git(ROOT, "ls-files", "-z") if x]
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text()) if os.environ.get("GITHUB_EVENT_PATH") else {}
    name = os.environ.get("GITHUB_EVENT_NAME", "")
    base = event.get("pull_request", {}).get("base", {}).get("sha") if name == "pull_request" else event.get("before")
    force = not base or base == "0" * 40 or name not in ("pull_request", "push")
    changed = []
    if not force:
        try:
            changed = [x for x in git(ROOT, "diff", "--name-only", "--no-renames", "-z", base, "HEAD") if x]
        except subprocess.CalledProcessError:
            force = True
    result = select(ROOT, files, changed, force)
    result.update(base_sha=base, checkout_sha=git(ROOT, "rev-parse", "HEAD")[0].strip())
    a.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if os.environ.get("GITHUB_OUTPUT"):
        out = {"tests": result["test_matrix"], "native": result["native_matrix"],
               "has_tests": bool(result["test_matrix"]["include"]), "has_native": bool(result["native_matrix"]["include"]),
               "mods": result["native_mods"], "has_mods": bool(result["native_mods"]),
               "lint": result["lint_paths"], "syntax": result["syntax_paths"], "config": result["config"], "snapshot": result["snapshot"],
               "git_benchmark": result["git_benchmark"], "projection_benchmark": result["projection_benchmark"], "full": result["full"]}
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            for key, value in out.items():
                stream.write(key + "=" + json.dumps(value, separators=(",", ":")) + "\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write("## Change-aware validation\n\n")
            stream.write(f"- Test files: {result['selected_test_files']}/{result['total_test_files']}\n")
            stream.write(f"- Native routes: {result['native_routes']}/{result['total_native_routes']}\n")
            stream.write(f"- Native mods: {len(result['native_mods'])}\n")
            stream.write(f"- Git benchmark: {result['git_benchmark']}\n")
            stream.write(f"- Workspace projection benchmark: {result['projection_benchmark']}\n")
            stream.write(f"- Full fallback: {result['full']}\n")
            stream.write("\nSee the impact-plan artifact for selected paths and reasons.\n")


if __name__ == "__main__":
    main()
