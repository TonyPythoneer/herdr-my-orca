import runpy
import unittest
from pathlib import Path

M = runpy.run_path(str(Path(__file__).with_name("ci-impact.py")))
ROOT = M["ROOT"]
FILES = [p for p in M["git"](ROOT, "ls-files", "-z") if p]


class ImpactTest(unittest.TestCase):
    def plan(self, *paths, force=False):
        return M["select"](ROOT, FILES, paths, force)

    def test_pull_request_base_tracks_tested_merge_not_stale_event(self):
        event = {"pull_request": {"base": {"sha": "old-main"}, "head": {"sha": "pr-head"}}}
        parents = ["merge-commit", "new-main", "pr-head"]
        self.assertEqual(M["pull_request_base"](event, parents), "new-main")

    def test_pull_request_base_fails_open_for_unverified_checkout(self):
        event = {"pull_request": {"base": {"sha": "old-main"}, "head": {"sha": "pr-head"}}}
        for parents in ([], ["pr-head", "old-main"], ["merge", "new-main", "other-head"], ["merge", "new-main", "pr-head", "extra"]):
            with self.subTest(parents=parents):
                self.assertIsNone(M["pull_request_base"](event, parents))
        self.assertIsNone(M["pull_request_base"]({}, ["merge", "new-main", "pr-head"]))

    def test_docs(self):
        p = self.plan("README.md")
        self.assertEqual(p["selected_test_files"], 0)
        self.assertEqual(p["native_routes"], 0)
        self.assertFalse(p["git_benchmark"])

    def test_known_ci_orchestration_only(self):
        p = self.plan(".github/workflows/ci.yml", ".github/workflows/benchmark-native.yml",
                      ".github/workflows/performance-retention.yml", ".github/workflows/main-ui-snapshot.yml",
                      ".github/workflows/main-ui-snapshot-reusable.yml", ".github/workflows/native-ui-candidate.yml",
                      "scripts/ci-impact.py", "scripts/ci-impact-test.py", "scripts/test-ci-routing.py",
                      "docs/ci-full-process.md", "ui-snapshot/README.md")
        self.assertFalse(p["full"])
        self.assertEqual(p["selected_test_files"], 0)
        self.assertEqual(p["native_routes"], 0)
        self.assertTrue(p["snapshot"])
        self.assertEqual(p["lint_paths"], [])

    def test_ci_orchestration_with_product_change_keeps_product_tests(self):
        p = self.plan(".github/workflows/ci.yml", "mods/orca-files/main.js")
        self.assertIn("orca-files", p["native_mods"])
        self.assertGreater(p["selected_test_files"], 0)
        self.assertEqual(p["native_routes"], 1)

    def test_full_process_keeps_all_logic_and_native_checks(self):
        p = self.plan(".github/workflows/ci.yml", force=True)
        self.assertTrue(p["full"])
        self.assertEqual(p["selected_test_files"], p["total_test_files"])
        self.assertEqual(p["native_routes"], p["total_native_routes"])

    def test_single_test(self):
        p = self.plan("mods/orca-files/delete-target.test.js")
        self.assertEqual(p["selected_test_files"], 1)
        self.assertFalse(p["native_mods"])
        self.assertEqual(p["native_routes"], 0)
        self.assertEqual(p["syntax_paths"], ["mods/orca-files/delete-target.test.js"])

    def test_git(self):
        p = self.plan("mods/orca-sidebar-projects/main.js")
        self.assertTrue(p["git_benchmark"])
        self.assertIn("orca-sidebar-projects", p["native_mods"])
        self.assertEqual(p["native_routes"], 0)
        self.assertLess(p["selected_test_files"], p["total_test_files"])
        self.assertNotIn("scripts/perf-spaces-virtual.test.js", [f for row in p["test_matrix"]["include"] for f in row["files"]])

    def test_test_fixtures_do_not_launch_native(self):
        p = self.plan("mods/orca-files/files-ui.golden.json")
        self.assertGreater(p["selected_test_files"], 0)
        self.assertFalse(p["native_mods"])
        self.assertEqual(p["native_routes"], 0)
        p = self.plan("scripts/benchmark-pages-test.py")
        self.assertEqual(p["selected_test_files"], 1)
        self.assertEqual(p["native_routes"], 0)

    def test_projection(self):
        p = self.plan("mods/orca-sidebar-projects/worktree-plan.js")
        self.assertTrue(p["projection_benchmark"])
        self.assertFalse(p["git_benchmark"])
        self.assertEqual(p["native_routes"], 0)
        self.assertNotIn("scripts/perf-spaces-virtual.test.js", [f for row in p["test_matrix"]["include"] for f in row["files"]])

    def test_files_page(self):
        p = self.plan("mods/orca-files/main.js")
        self.assertEqual(p["native_routes"], 1)
        self.assertEqual(p["native_matrix"]["include"], [{"layout": "orca", "stack": "panel-body", "pages": ["files"]}])
        self.assertFalse(p["git_benchmark"])

    def test_layout(self):
        p = self.plan("layouts/orca.json")
        self.assertTrue(all(row["layout"] == "orca" for row in p["native_matrix"]["include"]))

    def test_shared_static_assets(self):
        p = self.plan("mods/orca-assets/refresh-cw.svg")
        self.assertEqual(p["direct_mods"], ["orca-agent-settings", "orca-assets", "orca-files", "orca-status-bar"])
        self.assertFalse(p["full"])
        self.assertIn("scripts/shared-config-assets.test.mjs", [f for row in p["test_matrix"]["include"] for f in row["files"]])

    def test_shared(self):
        p = self.plan("src/shared/panel-motion.ts")
        self.assertIn("orca-files", p["native_mods"])
        self.assertIn("orca-changes", p["native_mods"])
        self.assertFalse(p["full"])

    def test_lint_tracks_changed_files_only(self):
        p = self.plan("mods/orca-status-bar/main.js")
        self.assertEqual(p["lint_paths"], ["mods/orca-status-bar/main.js"])

    def test_typescript_changes_select_lint(self):
        p = self.plan("orca-ui/shared/future.ts")
        self.assertTrue(p["full"])
        self.assertIn("orca-ui", p["lint_paths"])

    def test_fallback(self):
        p = self.plan("unknown-source.rs")
        self.assertTrue(p["full"])
        self.assertEqual(p["selected_test_files"], p["total_test_files"])
        self.assertEqual(p["native_routes"], p["total_native_routes"])

    def test_no_duplicate_tests(self):
        p = self.plan("mods/orca-status-bar/main.js", "mods/orca-sidebar-projects/main.js")
        files = [f for row in p["test_matrix"]["include"] for f in row["files"]]
        self.assertEqual(len(files), len(set(files)))


if __name__ == "__main__":
    unittest.main()
