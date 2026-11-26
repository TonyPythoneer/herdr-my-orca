import unittest
import json
import tempfile
from pathlib import Path
from capture import command_args, seed_startup, blocking_overlays, seed_safe_tasks, seed_permission, snapshot_env, viewport_points, cleanup_session

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
    def test_cleanup_kills_all_terminals_then_stops_core(self):
        calls=[]
        def execute(args, **kw):
            calls.append(args[1:])
            if args[1:3] == ["server","stop"]:
                return '{"stopped":true}'
            if args[1:2] == ["ls"]:
                return '{"terminals":[]}' if any(c[:2] == ["kill","t2"] for c in calls) else '{"terminals":[{"address":"t1"},{"address":"t2"}]}'
            return "{}"
        errors=cleanup_session("hc",{},Path("/tmp"),execute)
        self.assertEqual(errors,[])
        self.assertEqual(calls,[["ls","--json"],["kill","t1"],["kill","t2"],["ls","--json"],["server","stop","--json"]])

    def test_cleanup_stops_core_even_when_terminal_list_is_invalid(self):
        calls=[]
        def execute(args, **kw):
            calls.append(args[1:])
            return '{"stopped":true}' if args[1:3] == ["server","stop"] else '[]'
        errors=cleanup_session("hc",{},Path("/tmp"),execute)
        self.assertTrue(errors)
        self.assertIn(["server","stop","--json"],calls)

    def test_cleanup_continues_after_terminal_kill_failure(self):
        import subprocess
        calls=[]
        def execute(args, **kw):
            calls.append(args[1:])
            if args[1:] == ["kill","t1"]:
                raise subprocess.CalledProcessError(1,args)
            if args[1:3] == ["server","stop"]:
                return '{"stopped":true}'
            return '{"terminals":[{"address":"t1"},{"address":"t2"}]}'
        errors=cleanup_session("hc",{},Path("/tmp"),execute)
        self.assertTrue(errors)
        self.assertIn(["kill","t2"],calls)
        self.assertIn(["server","stop","--json"],calls)

    def test_local_environment_uses_isolated_home_and_unique_session(self):
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first = snapshot_env(Path(one), "/usr/bin")
            second = snapshot_env(Path(two), "/usr/bin")
            self.assertEqual(first["HOME"], str(Path(one)/"home"))
            self.assertEqual(first["HERDR_APP_HOME"], str(Path(one)/"config"))
            self.assertNotEqual(first["HC_SESSION"], second["HC_SESSION"])
            self.assertEqual(first["GIT_CONFIG_GLOBAL"], "/dev/null")
            self.assertNotIn("HC_SOCKET", first)

    def test_window_points_match_retina_and_standard_screenshots(self):
        self.assertEqual(viewport_points((1024,681),(1024,681)),(1024,681))
        self.assertEqual(viewport_points((2048,1362),(1024,681)),(1024,681))
        self.assertEqual(viewport_points((2560,1642),(1153,740)),(1153,740))
        with self.assertRaises(RuntimeError):
            viewport_points((2048,600),(1024,681))

    def test_toast_is_not_modal(self):
        self.assertEqual(blocking_overlays({"overlays":["toast","orca-split-menu"]}),["orca-split-menu"])
    def test_no_tasks_execute(self):
        with tempfile.TemporaryDirectory() as temp:
            seed_safe_tasks(Path(temp))
            tasks=json.loads((Path(temp)/"tasks.json").read_text())["tasks"]
            self.assertTrue(tasks)
            self.assertTrue(all(t["enabled"] is False for t in tasks))

    def test_permission_fixture_preserves_existing_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp)
            path = config/"agent-manager.json"
            path.write_text(json.dumps({"disabled":["codex"], "permissions":{"default":"own", "overrides":{"claude":"ask"}}}))
            seed_permission(config, "ask")
            self.assertEqual(json.loads(path.read_text()), {"disabled":["codex"], "permissions":{"default":"ask", "overrides":{"claude":"ask"}}})

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
            errors,end=click_errors(path,offset)
            self.assertEqual(len(errors),1)
            self.assertIn("cx is no longer valid",errors[0])
            self.assertEqual(end,path.stat().st_size)

    def test_error_split_across_reads_is_not_dropped(self):
        from capture import click_errors
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"app.log"
            path.write_bytes(b"ERROR gpui_shell::quickjs: error in click")
            errors,offset=click_errors(path,0)
            self.assertEqual(errors,[])
            with path.open("ab") as stream:
                stream.write(b" handler: cx is no longer valid\n")
            errors,end=click_errors(path,offset)
            self.assertEqual(len(errors),1)
            self.assertIn("cx is no longer valid",errors[0])
            self.assertEqual(end,path.stat().st_size)

    def test_unfinished_log_line_cannot_pass_a_case_boundary(self):
        from capture import settled_click_errors
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"app.log"
            path.write_bytes(b"ERROR render handler may still be completing")
            errors,_=settled_click_errors(path,0)
            self.assertTrue(errors)
            self.assertIn("Incomplete native log line",errors[0])

class PaneEvidenceTests(unittest.TestCase):
    def test_pane_ids_are_collected_from_space_tree(self):
        from capture import pane_ids
        world={"spaces":[{"tabs":[{"terminals":[{"terminal":"t1","pane":"p1"},{"terminal":"t2","pane":"p2"}]}]}]}
        self.assertEqual(pane_ids(world),{"p1","p2"})

    def test_pane_inventory_rejects_terminal_without_pane(self):
        from capture import pane_ids
        world={"spaces":[{"tabs":[{"terminals":[{"terminal":"t1"}]}]}]}
        with self.assertRaisesRegex(ValueError,"terminal has no pane ID"):
            pane_ids(world)

    def test_pane_focus_error_confirms_only_missing_pane(self):
        from capture import pane_missing_response
        self.assertTrue(pane_missing_response(1,'{"error":"no such pane"}'))
        self.assertFalse(pane_missing_response(0,'{}'))
        with self.assertRaisesRegex(RuntimeError,"Cannot verify pane existence"):
            pane_missing_response(1,'{"error":"core unavailable"}')

class VisibleEvidenceTests(unittest.TestCase):
    def test_absence_checks_search_crops_when_full_frame_misses_text(self):
        from capture import ocr_rows, assert_visible
        calls=[]
        def read(crop):
            calls.append(crop)
            return ([{"text":"Find files", "confidence":.9, "x":.8, "y":.2}]
                    if crop == (.6,0,1,1) else [])
        rows=ocr_rows(read,absent=["Find files"])
        self.assertEqual(len(calls),4)
        with self.assertRaises(RuntimeError):
            assert_visible(rows,absent=["Find files"])

    def test_ocr_keeps_confident_complete_text_over_partial_duplicates(self):
        from capture import merge_ocr_rows, visible_matches
        rows=[{"text":"Ask", "confidence":.9, "x":.5, "y":.3}]
        merge_ocr_rows(rows,[{"text":"Ask for approval", "confidence":.8, "x":.51, "y":.3}])
        self.assertEqual(len(rows),1)
        self.assertTrue(visible_matches(rows,"Ask for approval"))
        merge_ocr_rows(rows,[{"text":"Ask", "confidence":.2, "x":.5, "y":.3}])
        self.assertTrue(visible_matches(rows,"Ask for approval"))

    def test_ocr_retries_missing_text_and_deduplicates_overlapping_labels(self):
        from capture import ocr_rows, select_visible
        calls=[]
        def read(crop):
            calls.append(crop)
            if crop is None:
                return [{"text":"Projects", "confidence":.9, "x":.1, "y":.1}]
            return [{"text":"Projects", "confidence":.9, "x":.101, "y":.1},
                    {"text":"primary", "confidence":.9, "x":.09, "y":.24}]
        rows=ocr_rows(read,["primary"],(0,0,.28,1))
        self.assertEqual(calls,[None,(0,0,.28,1)])
        self.assertEqual(len(rows),2)
        self.assertEqual(select_visible(rows,"primary")["x"],.09)

    def test_visual_evidence_is_scoped_and_not_a_hash_only_check(self):
        from capture import visible_matches,assert_visible
        rows=[{"text":"Close diff","confidence":.95,"x":.64,"y":.12},
              {"text":"Close diff","confidence":.9,"x":.9,"y":.9}]
        self.assertEqual(len(visible_matches(rows,"Close diff",[.4,0,.7,.2])),1)
        with self.assertRaises(RuntimeError):
            assert_visible(rows,absent=["Close diff"])
        with self.assertRaises(RuntimeError):
            assert_visible(rows,required=["Save"])
        with self.assertRaises(RuntimeError):
            assert_visible([],absent=["Save"])

    def test_all_previously_unobserved_mods_have_an_explicit_scope_and_case(self):
        from scenarios import MOD_SCOPE
        covered={m for c in CASES for m in c["mods"]}
        self.assertTrue(set(MOD_SCOPE)<=covered)
        self.assertTrue(any(c.get("closePane") and c.get("follow") for c in CASES))
        self.assertTrue(any(c.get("fileAssert",{}).get("file")=="tasks.json" for c in CASES))
        self.assertTrue(any(c.get("fileAssert",{}).get("file")=="agent-manager.json" for c in CASES))

    def test_project_group_uses_actual_primary_checkout_marker(self):
        grouped=[c for c in CASES if c.get("group")]
        for c in grouped:
            if c.get("group")=="collapse":
                self.assertIn("primary",c["afterText"])
            elif c.get("absentText"):
                self.assertIn("primary",c["absentText"])
                self.assertIn("primary",c["beforeText"])
        file_case=next(c for c in CASES if c["title"]=="Explorer: open file")
        self.assertTrue(file_case["control"]["visible"])
        self.assertTrue(file_case["fresh"])
        self.assertIn("Snapshot sample",file_case["afterText"])

    def test_duplicate_labels_require_explicit_position_and_distinct_rows(self):
        from capture import select_visible
        rows=[{"text":"Create workspace","confidence":.95,"x":.5,"y":.40},
              {"text":"Create workspace","confidence":.95,"x":.5,"y":.60}]
        with self.assertRaises(RuntimeError):
            select_visible(rows,"Create workspace")
        self.assertEqual(select_visible(rows,"Create workspace",occurrence="top"),rows[0])
        self.assertEqual(select_visible(rows,"Create workspace",occurrence="bottom"),rows[1])
        with self.assertRaises(RuntimeError):
            select_visible([rows[0],dict(rows[0],x=.55)],"Create workspace",occurrence="top")
