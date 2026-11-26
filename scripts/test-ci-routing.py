"""Static regression contract: ordinary PRs must never launch heavyweight jobs."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / ".github" / "workflows"
TARGET = "ci/main-with-full-process"
GUARD = "github.event_name == 'pull_request' && github.base_ref == '" + TARGET + "'"


class Routing(unittest.TestCase):
    def test_fast_ci(self):
        ci = (ROOT / "ci.yml").read_text()
        self.assertIn("pull_request:\n    types: [opened, synchronize, reopened, edited]", ci)
        self.assertEqual(ci.count("if: " + GUARD), 5)
        self.assertIn("Run UI snapshot observer unit tests (no GUI)", ci)
        self.assertIn("FULL_PROCESS: ${{ " + GUARD + " }}", ci)
        self.assertIn("args+=(--force-full)", ci)

    def test_native_workflows(self):
        for name in ("benchmark-native.yml", "performance-retention.yml", "native-ui-candidate.yml"):
            with self.subTest(name=name):
                body = (ROOT / name).read_text()
                self.assertIn("branches: [" + TARGET + "]", body)
                self.assertNotIn("workflow_dispatch:", body)
                self.assertNotIn("    paths:", body)

    def test_snapshot_checks_candidate(self):
        body = (ROOT / "main-ui-snapshot-reusable.yml").read_text()
        self.assertIn("if: " + GUARD, body)
        self.assertNotIn("ref: main", body)
        self.assertNotIn("contents: write", body)
        self.assertNotIn("git push", body)


if __name__ == "__main__":
    unittest.main()
