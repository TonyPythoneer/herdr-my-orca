import runpy
import unittest
from pathlib import Path

M = runpy.run_path(str(Path(__file__).with_name("ci-impact.py")))
ROOT = M["ROOT"]
FILES = [p for p in M["git"](ROOT, "ls-files", "-z") if p]


class ImpactTest(unittest.TestCase):
    def plan(self, *paths, force=False):
        return M["select"](ROOT, FILES, paths, force)

    def test_docs(self):
        p = self.plan("README.md")
        self.assertEqual(p["selected_test_files"], 0)
        self.assertEqual(p["native_routes"], 0)
        self.assertFalse(p["git_benchmark"])

    def test_single_test(self):
        p = self.plan("mods/orca-spaces/git-refresh.test.js")
        self.assertEqual(p["selected_test_files"], 1)
        self.assertFalse(p["native_mods"])
        self.assertEqual(p["native_routes"], 0)
        self.assertEqual(p["syntax_paths"], ["mods/orca-spaces/git-refresh.test.js"])

    def test_git(self):
        p = self.plan("mods/orca-spaces/main.js")
        self.assertTrue(p["git_benchmark"])
        self.assertIn("orca-spaces", p["native_mods"])
        self.assertEqual(p["native_routes"], 0)
        self.assertLess(p["selected_test_files"], p["total_test_files"])
        self.assertIn("scripts/perf-spaces-virtual.test.js", [f for row in p["test_matrix"]["include"] for f in row["files"]])

    def test_files_page(self):
        p = self.plan("mods/orca-files/main.js")
        self.assertEqual(p["native_routes"], 2)
        self.assertTrue(all(row["pages"] == ["files"] for row in p["native_matrix"]["include"]))
        self.assertFalse(p["git_benchmark"])

    def test_layout(self):
        p = self.plan("layouts/orca.json")
        self.assertTrue(all(row["layout"] == "orca" for row in p["native_matrix"]["include"]))

    def test_shared(self):
        p = self.plan("orca-ui/shared/panel-motion.js")
        self.assertIn("orca-files", p["native_mods"])
        self.assertIn("orca-changes", p["native_mods"])
        self.assertFalse(p["full"])

    def test_fallback(self):
        p = self.plan("unknown-source.rs")
        self.assertTrue(p["full"])
        self.assertEqual(p["selected_test_files"], p["total_test_files"])
        self.assertEqual(p["native_routes"], p["total_native_routes"])

    def test_no_duplicate_tests(self):
        p = self.plan("mods/orca-status/main.js", "mods/orca-spaces/main.js")
        files = [f for row in p["test_matrix"]["include"] for f in row["files"]]
        self.assertEqual(len(files), len(set(files)))


if __name__ == "__main__":
    unittest.main()
