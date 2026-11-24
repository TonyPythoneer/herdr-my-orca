import unittest
import json
import tempfile
from pathlib import Path
from capture import command_args, seed_startup, blocking_overlays, seed_safe_tasks

class CommandArgsTests(unittest.TestCase):
    def test_name_is_not_command_parameter(self):
        for command, name in [("layout.switch","orca"),("space.new","Snapshot project"),("tab.new","Second terminal"),("mod.open","orca-split-menu")]:
            self.assertEqual(command_args(command,name=name),["do",command,"--name",name])
    def test_named_arguments(self):
        self.assertEqual(command_args("layout.select",stack="main",child="main-agents"),["do","layout.select","--stack","main","--child","main-agents"])
    def test_overlay_id(self):
        self.assertEqual(command_args("overlay.close",id="frame-welcome"),["do","overlay.close","--id","frame-welcome"])

class StartupFixtureTests(unittest.TestCase):
    def test_known_persisted_onboarding_state(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp)
            seed_startup(config, "herdr-app 0.1.17")
            self.assertEqual(json.loads((config/"shared.json").read_text()), {"layout":"orca","frame.welcomed":True})
            self.assertEqual(json.loads((config/"update-notes.json").read_text()), {"presented":["0.1.17"]})
    def test_unknown_version_does_not_invent_release(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp)
            seed_startup(config, "unknown")
            self.assertFalse((config/"update-notes.json").exists())

class SnapshotSafetyTests(unittest.TestCase):
    def test_toast_is_not_modal(self):
        self.assertEqual(blocking_overlays({"overlays":["toast","orca-split-menu"]}),["orca-split-menu"])
    def test_no_tasks_execute(self):
        with tempfile.TemporaryDirectory() as temp:
            seed_safe_tasks(Path(temp))
            tasks=json.loads((Path(temp)/"tasks.json").read_text())["tasks"]
            self.assertTrue(tasks)
            self.assertTrue(all(t["enabled"] is False for t in tasks))

from scenarios import CASES

class ModInventoryTests(unittest.TestCase):
    def test_only_custom_controls(self):
        self.assertGreaterEqual(len(CASES),20)
        self.assertEqual(len({c["title"] for c in CASES}),len(CASES))
        for c in CASES:
            self.assertTrue(c["mods"] and all(m.startswith("orca-") or m=="orca-agent-flyout" for m in c["mods"]))
            self.assertTrue(c["control"]["label"])
            if "xy" in c["control"]:
                x,y=c["control"]["xy"]
                self.assertTrue(0<=x<1024 and 0<=y<681)

    def test_duplicate_agent_label_is_scoped_to_click_point(self):
        agents=[c for c in CASES if c["control"]["label"]=="Agents"]
        self.assertEqual(len(agents),2)
        self.assertTrue(all(c["control"]["mouse_only"] for c in agents))
        self.assertNotEqual(agents[0]["control"]["xy"],agents[1]["control"]["xy"])


class NativeLogTests(unittest.TestCase):
    def test_expired_context_is_a_click_failure(self):
        from capture import click_errors
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"app.log"
            path.write_bytes(b"old ERROR quickjs\n")
            offset=path.stat().st_size
            with path.open("ab") as stream:
                stream.write(b"\x1b[31mERROR\x1b[0m gpui_shell::engine::quickjs: error in click handler: cx is no longer valid\n")
                stream.write(b"WARN unrelated startup warning\n")
            self.assertEqual(len(click_errors(path,offset)),1)
            self.assertIn("cx is no longer valid",click_errors(path,offset)[0])
