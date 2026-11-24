#!/usr/bin/env python3
"""The one place the titlebar row height is configured for the Orca layouts.

Herdr layouts have no variables, so edit TITLEBAR_HEIGHT and run this script: it writes the
nodes each layout builds its titlebar row from in the repo layout. `orca` has tabs (the one header
over the sidebar and the work column) and panel-head (right panel header). `orca-header` reads the
`tabs` node for its drop geometry, so nothing else holds the number.

Usage: scripts/titlebar-height.py [--check] [--root DIR] [--write-live]
  --check       exits nonzero on a mismatch, writes nothing
  --root DIR    reads and writes DIR/layouts/<name>.json (default: this repo)
  --write-live  also writes ~/.config/herdr-app/layouts/<name>.json (off by default: syncing a
                running app is a separate, per-file step; see the dev-sync skill)
"""
import json, os, sys

TITLEBAR_HEIGHT = 32
TRAFFIC_LIGHTS = [12, TITLEBAR_HEIGHT // 2 - 8]
# shortcut: measured on screen, panel-head's bottom border lands 1 unit below the tab strip's at
# equal px (32 and 40 both); cause unknown, re-measure after a Herdr update.
PANEL_HEAD_OFFSET = -1
ROWS = {
    "orca": {"tabs": 0, "panel-head": PANEL_HEAD_OFFSET},
}
# Header-like rows this script does not control, shown so a mismatch is easy to spot.
OTHER = {"status-footer": "layout node", "main-terminals pane header": "layout `header.height`",
         "files toolbar": "orca-files h(32)", "status": "layout node"}


def walk(n):
    yield n
    for c in n.get("children", []):
        yield from walk(c)


def targets(root):
    found = []
    for name in ROWS:
        found.append(os.path.join(root, "layouts", f"{name}.json"))
        if "--write-live" in sys.argv:
            found.append(os.path.expanduser(f"~/.config/herdr-app/layouts/{name}.json"))
    return found


def check(f, row):
    d = json.load(open(f))
    nodes = [n for n in walk(d) if n.get("id") in row]
    assert len(nodes) == len(row), f"{f}: missing one of {list(row)}"
    expected = {n["id"]: TITLEBAR_HEIGHT + row[n["id"]] for n in nodes}
    actual = {n["id"]: n["size"]["px"] for n in nodes}
    mismatch = actual != expected or d.get("titlebar") != "none" or d.get("traffic_lights") != TRAFFIC_LIGHTS
    return d, nodes, actual, mismatch


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--root" in sys.argv:
        if sys.argv.index("--root") + 1 >= len(sys.argv):
            sys.exit(__doc__)
        root = os.path.abspath(sys.argv[sys.argv.index("--root") + 1])
    bad = False
    for f in targets(root):
        row = ROWS[os.path.basename(f)[: -len(".json")]]
        d, nodes, actual, mismatch = check(f, row)
        bad |= mismatch
        if "--check" not in sys.argv:
            for n in nodes:
                n["size"] = {"px": TITLEBAR_HEIGHT + row[n["id"]]}
            d["titlebar"] = "none"
            d["traffic_lights"] = TRAFFIC_LIGHTS
            json.dump(d, open(f, "w"), indent=2, ensure_ascii=False)
            open(f, "a").write("\n")
        print(f, actual, "mismatch" if mismatch else "ok")
    print("not controlled:", ", ".join(f"{k} ({v})" for k, v in OTHER.items()))
    if "--check" in sys.argv and bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
