"""Coverage gate for native UI snapshot cases.

Every custom mod with a manifest needs at least one case, every case needs a
verifiable effect, and every case must name a mod folder that exists.
"""
import unittest
from pathlib import Path

import scenarios

ROOT = Path(__file__).resolve().parent.parent
EFFECT_KEYS = {"afterText", "absentText", "overlay", "fileAssert", "closedAbsent"}
CASE_KEYS = {
    "title", "mods", "control", "beforeText", "afterText", "absentText", "evidenceRegion",
    "closedText", "closedAbsent", "noOverlay", "overlay", "popover", "follow", "prepare",
    "files", "group", "fresh", "panel", "page", "layout", "viewport", "permissionFixture",
    "fileAssert", "fixtureExists", "paneChange", "closePane", "wait", "setupOverlay", "pageAfter",
    "allowSetupRuntimeErrors", "allowTransientRuntimeErrors",
}
CONTROL_KEYS = {"label", "xy", "right", "mouse_only", "visible", "region", "occurrence", "scroll"}
ACTION_KEYS = {
    "kind", "label", "xy", "amount", "right", "region", "evidenceRegion", "absentRegion", "scroll", "occurrence",
    "afterText", "absentText", "checks", "noOverlay", "name", "args", "value",
}
# Manifest mods that are intentionally without a case: mod -> one-line reason.
EXEMPT = {}


def mod_dirs():
    return {p.name for p in (ROOT / "mods").iterdir() if p.is_dir()}


def manifest_mods():
    return {p.parent.name for p in (ROOT / "mods").glob("*/mod.json")}


class CoverageGate(unittest.TestCase):
    def test_scenarios_use_only_runner_supported_keys(self):
        unknown = []
        for case in scenarios.CASES:
            unknown.extend(f"{case['title']}: {key}" for key in case if key not in CASE_KEYS)
            unknown.extend(f"{case['title']} control: {key}" for key in case["control"] if key not in CONTROL_KEYS)
            if case.get("follow") and (case.get("closedText") or case.get("closedAbsent")):
                unknown.append(f"{case['title']}: closed popup evidence is skipped when follow actions are present")
            if case.get("closePane") and not any(a.get("kind") == "press" and a.get("label") == "Close diff" for a in case.get("follow", [])):
                unknown.append(f"{case['title']}: closePane needs an explicit Close diff action")
            for action in case.get("prepare", []) + case.get("follow", []):
                if action in case.get("prepare", []) and any(k in action for k in ("afterText", "absentText", "evidenceRegion")):
                    unknown.append(f"{case['title']} prepare action: ignored evidence assertion")
                if action.get("kind") not in {"text", "press", "mouse", "scroll", "command", "escape", "paste"}:
                    unknown.append(f"{case['title']} action: unsupported kind {action.get('kind')}")
                unknown.extend(f"{case['title']} action: {key}" for key in action if key not in ACTION_KEYS)
        self.assertEqual(unknown, [], "scenario fields ignored by the runner")

    def test_every_manifest_mod_has_a_case(self):
        covered = {m for c in scenarios.CASES for m in c["mods"]}
        missing = sorted(m for m in manifest_mods() if m not in covered and m not in EXEMPT)
        self.assertEqual(missing, [], "manifest mods without any snapshot case")

    def test_every_case_asserts_a_visible_effect(self):
        bad = [c["title"] for c in scenarios.CASES if not any(c.get(k) for k in EFFECT_KEYS)]
        self.assertEqual(bad, [], "cases with no verifiable effect")

    def test_every_case_names_an_existing_mod(self):
        dirs = mod_dirs()
        stale = sorted({m for c in scenarios.CASES for m in c["mods"] if m not in dirs})
        self.assertEqual(stale, [], "case mod names that are not mod folders")

    def test_mod_scope_keys_exist(self):
        dirs = mod_dirs()
        stale = sorted(k for k in scenarios.MOD_SCOPE if k not in dirs)
        self.assertEqual(stale, [], "MOD_SCOPE keys that are not mod folders")


if __name__ == "__main__":
    unittest.main()
