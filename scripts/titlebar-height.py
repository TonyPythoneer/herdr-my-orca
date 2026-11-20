#!/usr/bin/env python3
"""The one place the titlebar row height is configured for layouts/orca.json.

Herdr layouts have no variables, so edit TITLEBAR_HEIGHT and run this script: it writes the
brand (left sidebar top), tabs (tab strip) and panel-head (right panel header) nodes in the
repo layout and the live copy (~/.config/herdr-app/layouts). `orca-tabs` reads the `tabs`
node for its drop geometry, so nothing else holds the number.
Usage: scripts/titlebar-height.py [--check]   (--check exits nonzero on a mismatch)
"""
import json, os, sys

TITLEBAR_HEIGHT = 32
TRAFFIC_LIGHTS = [12, TITLEBAR_HEIGHT // 2 - 8]
# shortcut: measured on screen, panel-head's bottom border lands 1 unit below the tab strip's at
# equal px (32 and 40 both); cause unknown, re-measure after a Herdr update.
PANEL_HEAD_OFFSET = -1
ROW = {"brand": 0, "tabs": 0, "panel-head": PANEL_HEAD_OFFSET}
# Header-like rows this script does not control, shown so a mismatch is easy to spot.
OTHER = {"sidebar-footer": "layout node", "main-terminals pane header": "layout `header.height`",
         "files toolbar": "orca-files h(32)", "status": "layout node"}
files = ["layouts/orca.json", os.path.expanduser("~/.config/herdr-app/layouts/orca.json")]

def walk(n):
    yield n
    for c in n.get("children", []):
        yield from walk(c)

bad = False
for f in files:
    d = json.load(open(f))
    nodes = [n for n in walk(d) if n.get("id") in ROW]
    assert len(nodes) == len(ROW), f"{f}: missing one of {list(ROW)}"
    expected = {n["id"]: TITLEBAR_HEIGHT + ROW[n["id"]] for n in nodes}
    actual = {n["id"]: n["size"]["px"] for n in nodes}
    mismatch = actual != expected or d.get("titlebar") != "none" or d.get("traffic_lights") != TRAFFIC_LIGHTS
    bad |= mismatch
    if "--check" not in sys.argv:
        for n in nodes:
            n["size"] = {"px": TITLEBAR_HEIGHT + ROW[n["id"]]}
        d["titlebar"] = "none"
        d["traffic_lights"] = TRAFFIC_LIGHTS
        json.dump(d, open(f, "w"), indent=2, ensure_ascii=False)
        open(f, "a").write("\n")
    print(f, actual, "mismatch" if mismatch else "ok")
print("not controlled:", ", ".join(f"{k} ({v})" for k, v in OTHER.items()))
if "--check" in sys.argv and bad:
    sys.exit(1)
