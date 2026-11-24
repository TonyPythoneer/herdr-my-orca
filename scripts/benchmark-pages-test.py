"""Deterministic, no-Herdr/no-Pillow tests of benchmark measurement semantics."""
import csv
import importlib.util
from pathlib import Path
import tempfile
import json
import runpy
import subprocess
import copy
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bench", Path(__file__).with_name("benchmark-pages.py"))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


class Driver:
    def __init__(self, images):
        self.images = iter(images)
    def shot(self):
        return next(self.images)
    def distance(self, a, b, roi):
        return abs(a-b)


class BenchmarkTests(unittest.TestCase):
    def test_distinct_provider_origin(self):
        self.assertEqual(bench.origin_page({"stack":"main","page":"main-providers"}), "main-agents")
        self.assertEqual(bench.origin_page({"stack":"main","page":"main-agents"}), "main-terminals")
        self.assertEqual(bench.origin_page({"stack":"panel-body","page":"vault"}), "files")

    def test_percentiles_and_failures(self):
        self.assertEqual(bench.quantile([9, 1, 5, 3], .95), 9)
        self.assertEqual(bench.quantile([9, 1, 5, 3], .5), 3)
        self.assertIsNone(bench.quantile([], .95))
        row = bench.summarize([
            {"status":"matched", "reference_match_ms":50, "first_change_ms":30},
            {"status":"timeout", "reference_match_ms":None, "first_change_ms":40},
        ])
        self.assertEqual(row["failures"], 1)
        self.assertEqual(row["failure_rate"], .5)
        self.assertEqual(row["metrics"]["reference_match_ms"]["p95"], 50)
        self.assertEqual(row["metrics"]["reference_match_ms"]["count"], 1)

    def test_classifier(self):
        self.assertEqual(bench.classify(0, .1, .1, .005), "waiting")
        self.assertEqual(bench.classify(.04, .06, .1, .005), "changed")
        self.assertEqual(bench.classify(.1, .001, .1, .005), "matched")
        self.assertEqual(bench.classify(.005, .001, .01, .005), "indistinguishable")

    def test_observe_matched(self):
        clock = iter([0, .01, .02, .03, .04, .05, .06, .07, .08, .09, .10, .11])
        with patch.object(bench.time, "monotonic", side_effect=lambda: next(clock)), patch.object(bench.time, "sleep"):
            result = bench.observe(Driver([.04, .1]), 0, .1, lambda: None, [0,0,1,1], 1, 0, .005)
        self.assertEqual(result["status"], "matched")
        self.assertLess(result["first_change_ms"], result["reference_match_ms"])
        self.assertIsNotNone(result["capture_ms"])
        self.assertEqual(result["capture_count"], 2)
        self.assertFalse(result["first_capture_matched"])
        self.assertEqual([x["state"] for x in result["observations"]], ["changed", "matched"])

    def test_observe_timeout_is_not_a_match(self):
        clock = iter([0, .01, .02, .03, .04, .05, .06, .07, .08, .09, .10, .11])
        with patch.object(bench.time, "monotonic", side_effect=lambda: next(clock)), patch.object(bench.time, "sleep"):
            result = bench.observe(Driver([.04, .04, .04]), 0, .1, lambda: None, [0,0,1,1], .05, 0, .005)
        self.assertEqual(result["status"], "timeout")
        self.assertIsNone(result["reference_match_ms"])
        self.assertIsNotNone(result["first_change_ms"])

    def test_indistinguishable_does_not_dispatch(self):
        result = bench.observe(Driver([]), 0, .01, lambda: self.fail("dispatched"), [0,0,1,1], 1, 0, .005)
        self.assertEqual(result["status"], "indistinguishable")

    def test_paired_control_does_not_claim_adjusted_latency(self):
        a = {"status":"matched","control_capture_ms":40,"capture_total_ms":60,"reference_match_ms":80,"first_capture_matched":True}
        b = {"status":"matched","control_capture_ms":50,"capture_total_ms":75,"reference_match_ms":100,"first_capture_matched":False}
        c = {"status":"timeout","control_capture_ms":999}
        r = bench.measurement_control([a,b,c])
        self.assertEqual(r["paired_count"],2)
        self.assertEqual(r["control_capture_p95_ms"],50)
        self.assertEqual(r["median_capture_share"],.75)
        self.assertEqual(r["first_capture_match_rate"],.5)
        self.assertNotIn("adjusted_latency_ms",r)
        self.assertIsNone(bench.measurement_control([])["median_capture_share"])

    def test_frame_aggregate_is_not_a_percentile(self):
        r = bench.frame_summary([{"window":2,"frame_ms":10,"script_ms":8}, {"window":1,"frame_ms":5,"script_ms":4}])
        self.assertEqual(r["mean_cpu_frame_ms"], 5)
        self.assertEqual(r["mean_script_ms_per_second"], 6)
        self.assertIsNone(bench.frame_summary([])["mean_cpu_frame_ms"])

    def test_csv_preserves_unmeasured(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            bench.write_summary(out, {"pages":[{"layout":"orca","stack":"panel-body","page":"ports","fixture":"ssh","status":"not_measured","reason":"requires SSH"}]})
            with (out/"summary.csv").open() as f:
                row = next(csv.DictReader(f))
            self.assertEqual(row["status"],"not_measured")
            self.assertEqual(row["match_p95_ms"],"")
            self.assertEqual(row["reason"],"requires SSH")

    def test_roi(self):
        self.assertEqual(bench.validate_roi([0,0,1,1]), [0,0,1,1])
        with self.assertRaises(ValueError):
            bench.validate_roi([.5,0,.1,1])


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.diag = runpy.run_path(str(Path(__file__).with_name("benchmark-diagnostics.py")))

    def test_instrument_preserves_aliases_and_results_without_secrets(self):
        source = '''import { exec as execute, theme } from "herdr";
export default class Demo extends View {
  render() { return 42; }
  async load() { return execute("git", ["secret-argv"]); }
}
'''
        out, coverage = self.diag["instrument"](source, "demo/main.js")
        self.assertEqual(coverage, ["exec", "init", "render"])
        self.assertIn("exec as __pageDiagNative_execute", out)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "probe.mjs"
            out = out.replace('import { exec as __pageDiagNative_execute, theme } from "herdr";',
                              'const __pageDiagNative_execute = async () => ({code: 0}); const theme = () => {};')
            target.write_text("class View {}\n" + out + "\nconst d = new Demo(); if (d.render() !== 42 || (await d.load()).code !== 0) process.exit(1);")
            r = subprocess.run(["node", str(target)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn("secret-argv", r.stdout)
            spans = self.diag["parse_events"](r.stdout)
            self.assertEqual({s["op"] for s in spans}, {"render", "exec"})

    def test_real_mod_copies_compile(self):
        # Validate the exact generated JS for every touched module, not just a
        # synthetic snippet. No GPUI or installed agents needed for syntax.
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            mods = Path(tmp) / "mods"
            shutil.copytree(bench.ROOT / "mods", mods)
            coverage = self.diag["install"](mods)
            self.assertTrue(any(x["module"] == "orca-spaces/main.js" and "render" in x["operations"] for x in coverage))
            self.assertTrue(any(x["module"] == "orca-agent-manager/main.js" and "knownAgents" in x["operations"] for x in coverage))
            for item in coverage:
                target = mods / item["module"]
                r = subprocess.run(["node", "--input-type=module", "--check"],
                                   input=target.read_text(), capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, item["module"] + ": " + r.stderr)
            self.assertNotIn("HERDR_PAGE_DIAG ", (bench.ROOT / "mods/orca-spaces/main.js").read_text())

    def test_scope_and_overlapping_spans(self):
        event = lambda module, start, end: {"module":module,"op":"exec","family":"git","start_ms":start,"end_ms":end,"duration_ms":end-start,"outcome":"ok"}
        spans = [event("a/main.js", 100, 180), event("a/main.js", 120, 190),
                 event("b/main.js", 100, 150), event("a/main.js", 90, 120)]
        rows = self.diag["summarize_events"](spans, 100, 200, "a")
        self.assertEqual(rows[0]["scope"], "target")
        self.assertEqual(rows[0]["count"], 2)
        self.assertEqual(rows[0]["sum_ms_nonexclusive"], 150)
        self.assertEqual(rows[1]["scope"], "background")
        counts = self.diag["count_events"](spans, 100, 200, "a")
        self.assertEqual(counts["target"]["exec_calls"], 2)
        self.assertEqual(counts["background"]["host_calls"], 1)
        self.assertEqual(self.diag["parse_events"]("HERDR_PAGE_DIAG invalid\n"), [])


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.comparator = runpy.run_path(str(Path(__file__).with_name("benchmark-compare.py")))
        self.compare = self.comparator["compare"]
        self.before = {k: "same" for k in self.comparator["ENV_KEYS"]}
        self.before.update(mode="measure", diagnostic=False, samples=30, commit="base")
        metric = {"count":30,"p50":90,"p95":100,"max":130}
        self.before["pages"] = [{"layout":"orca","stack":"main","page":"main-agents","fixture":"git",
            "status":"measured","from_page":"main-terminals","reference":{"sha256":"abc","roi":[0,0,1,1],"viewport":[100,100]},
            "warm":{"attempts":30,"matched":30,"failures":0,"failure_rate":0,
                    "metrics":{k:dict(metric) for k in self.comparator["METRICS"]}}}]
        self.after = copy.deepcopy(self.before)
        self.after["commit"] = "candidate"

    def test_flags_regression_only_when_both_thresholds_exceeded(self):
        target = self.after["pages"][0]["warm"]["metrics"]["reference_match_ms"]
        target["p95"] = 120
        self.assertEqual(self.compare(self.before,self.after)["pages"][0]["status"],"stable")
        target["p95"] = 121
        result = self.compare(self.before,self.after)["pages"][0]
        self.assertEqual(result["status"],"regression_candidate")
        self.assertEqual(result["metrics"]["reference_match_ms"]["delta_ms"],21)
        target["p95"] = 70
        self.assertEqual(self.compare(self.before,self.after)["pages"][0]["status"],"improvement_candidate")

    def test_refuses_mismatched_environment_and_incomplete_runs(self):
        self.after["diagnostic"] = True
        self.assertEqual(self.compare(self.before,self.after)["pages"][0]["status"],"not_comparable")
        self.after["diagnostic"] = False
        self.after["pages"][0]["reference"]["sha256"] = "different"
        self.assertEqual(self.compare(self.before,self.after)["pages"][0]["status"],"not_comparable")
        self.after["pages"][0]["reference"]["sha256"] = "abc"
        self.after["pages"][0]["warm"]["matched"] = 29
        self.assertEqual(self.compare(self.before,self.after)["pages"][0]["status"],"not_comparable")

    def test_missing_route_not_silently_ignored(self):
        self.after["pages"] = []
        self.assertEqual(self.compare(self.before,self.after)["counts"]["not_comparable"],1)

class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.res = runpy.run_path(str(Path(__file__).with_name("benchmark-resources.py")))

    def test_ps_time_formats(self):
        for value, seconds in [("0:01.25",1.25),("01:02:03",3723),("1-02:00:00",93600)]:
            self.assertEqual(self.res["cpu_seconds"](value), seconds)

    def test_cpu_one_core_scale_and_rss_delta(self):
        samples = iter([{"monotonic_s":10,"cpu_s":5,"rss_mib":100},
                        {"monotonic_s":20,"cpu_s":5.2,"rss_mib":103}])
        r = self.res["measure_idle"](123, 10, sample=lambda pid: next(samples), sleep=lambda _:None)
        self.assertEqual(r["cpu_pct_one_core"],2)
        self.assertEqual(r["rss_delta_mib"],3)

    def test_retention_threshold_and_insufficient_samples(self):
        self.assertEqual(self.res["retention"]([100])["status"],"insufficient_samples")
        self.assertFalse(self.res["retention"]([100,100,100,105,106,105])["growth_candidate"])
        self.assertTrue(self.res["retention"]([100,100,100,130,131,132])["growth_candidate"])


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.report = runpy.run_path(str(Path(__file__).with_name("benchmark-report.py")))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sha = "a" * 40
        self.plan = self.report["PLAN"]

    def generate(self, missing=None, incomplete=None, mismatch=False, no_image=False):
        for group in {self.report["group_id"](p) for p in self.plan}:
            if group == missing:
                continue
            folder = self.root / ("native-benchmark-" + group + "-" + self.sha)
            folder.mkdir()
            rows, approvals = [], {}
            for p in self.plan:
                if self.report["group_id"](p) != group:
                    continue
                row = dict(p)
                key = self.report["route_id"](p)
                if p["fixture"] == "ssh":
                    row.update(status="not_measured", reason="requires SSH")
                else:
                    row.update(status="provisional_measured", from_page="origin",
                        reference={"sha256":"abc"}, samples=[{"status":"matched","phase":"first_visit"}]
                        + [{"status":"matched","phase":"warm"} for _ in range(30)],
                        warm={"attempts":30,"matched":30,"failures":0,"metrics":{
                            m:{"count":30,"p50":40,"p95":60,"max":70} for m in self.report["METRICS"]}})
                    if incomplete == key:
                        row["status"] = "incomplete"
                        row["samples"][-1]["status"] = "indistinguishable"
                        row["warm"].update(matched=29,failures=1)
                    approvals[key] = {"approved":False}
                    for suffix in (".png","--before.png","--after.png"):
                        if not (no_image and key == "orca--main-agents" and suffix == "--after.png"):
                            (folder / (key + suffix)).touch()
                rows.append(row)
            if group == "orca-main":
                next(r for r in rows if r["page"] == "main-tasks")["warm"]["metrics"]["reference_match_ms"]["p95"] = 220
            (folder / "report.json").write_text(json.dumps({"schema":1,"commit":"b"*40 if mismatch else self.sha,
                "mode":"candidate_baseline","diagnostic":False,"samples":30,"pages":rows}))
            (folder / "approved.json").write_text(json.dumps(approvals))
            (folder / "runner.json").write_text(json.dumps({"commit":self.sha,"capture":"success","validate":"success"}))

    def aggregate(self, result="success"):
        return self.report["aggregate"](self.root,self.sha,self.sha,"https://example.invalid/run",result,30)

    def test_report_full_and_budget_priority(self):
        self.generate()
        result = self.aggregate()
        self.assertEqual(result["status"],"complete_provisional")
        self.assertEqual(result["coverage"]["provisional"],11)
        self.assertEqual(result["coverage"]["excluded"],1)
        self.assertEqual(result["coverage"]["approved"],0)
        self.assertEqual(result["routes"][0]["route_id"],"orca--main-tasks")
        self.assertEqual(result["routes"][0]["priority"],1)
        self.assertIn("<!-- herdr-native-benchmark-report:v1 -->",self.report["markdown"](result))
        self.assertEqual(self.aggregate("failure")["status"],"needs_investigation")

    def test_scoped_aggregation_does_not_treat_unselected_routes_as_missing(self):
        self.generate(missing="orca-panel-body")
        selection = {"include": [{"layout":"orca","stack":"main","pages":["main-agents"]}]}
        result = self.report["aggregate"](self.root,self.sha,self.sha,"https://example.invalid/run","success",30,selection)
        self.assertEqual(result["status"],"complete_provisional")
        self.assertEqual(result["coverage"]["required"],1)
        self.assertEqual(result["coverage"]["not_selected"],11)
        self.assertEqual([r["route_id"] for r in result["routes"]],["orca--main-agents"])

    def test_incomplete_and_missing_groups_are_not_passes(self):
        self.generate(missing="orca-panel-body", incomplete="orca--main-providers")
        result = self.aggregate("failure")
        self.assertEqual(result["coverage"]["by_status"]["missing"],7)
        self.assertEqual(result["coverage"]["by_status"]["incomplete"],1)
        self.assertEqual(result["status"],"needs_investigation")
        row = next(r for r in result["routes"] if r["route_id"] == "orca--main-providers")
        self.assertIn("indistinguishable",row["sample_status_counts"])
        self.assertIn("ROI",row["next_action"])
        self.assertEqual(self.report["select_diagnostic"](self.root / ("native-benchmark-orca-main-" + self.sha) / "report.json"),"main-providers")

    def test_wrong_sha_rejected(self):
        self.generate(mismatch=True)
        self.assertEqual(self.aggregate()["coverage"]["provisional"],0)

    def test_missing_image_rejected(self):
        self.generate(no_image=True)
        result = self.aggregate()
        row = next(r for r in result["routes"] if r["route_id"] == "orca--main-agents")
        self.assertEqual(row["status"],"invalid")
        self.assertEqual(result["status"],"needs_investigation")


if __name__ == "__main__":
    unittest.main()
