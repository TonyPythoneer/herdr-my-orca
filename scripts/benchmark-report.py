#!/usr/bin/env python3
"""Deterministic benchmark evidence aggregation for human and AI reviewers.

No LLM/API calls. Missing, invalid, unreviewed and failed evidence remain distinct.
The only writes are the three report files in the requested output directory.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re
import runpy

ROOT = Path(__file__).resolve().parent.parent
BENCH = runpy.run_path(str(ROOT / "scripts/benchmark-pages.py"))
PLAN = BENCH["plan"]()
BUDGETS = BENCH["BUDGETS"]
METRICS = ("first_change_ms", "reference_match_ms", "command_ms", "capture_ms")


def route_id(row):
    return row["layout"] + "--" + row["page"]


def group_id(row):
    return row["layout"] + "-" + row["stack"]


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def p95(row, metric):
    v = row.get("warm", {}).get("metrics", {}).get(metric, {}).get("p95")
    return v if finite(v) else None


def load_json(path):
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("expected JSON object")
    return data


def read_evidence(path, commit, group):
    """A missing report is not a passed group; validate source identity and schema."""
    try:
        data = load_json(path)
        if data.get("schema") != 1 or data.get("commit") != commit:
            raise ValueError("unsupported schema or checkout SHA mismatch")
        if data.get("mode") != "candidate_baseline" or data.get("diagnostic") is not False:
            raise ValueError("not an uninstrumented candidate baseline")
        if not isinstance(data.get("pages"), list):
            raise ValueError("missing pages")
        expected = {route_id(r): r for r in PLAN if group_id(r) == group}
        pages = {}
        for p in data["pages"]:
            key = route_id(p)
            if key not in expected or key in pages or any(p.get(k) != expected[key][k] for k in ("layout", "stack", "fixture", "mod")):
                raise ValueError("unexpected/duplicate route or fixture metadata: " + key)
            pages[key] = p
        return data, pages, None
    except (OSError, ValueError, KeyError, TypeError) as e:
        return {}, {}, str(e)


def priority(row):
    if row["status"] in ("missing", "invalid", "incomplete", "error"):
        return 0
    if row["status"] == "excluded":
        return 4
    if row["budget_warnings"]:
        return 1
    if row.get("rss_after_matches", {}).get("growth_candidate"):
        return 2
    return 3


def recommendation(row):
    key = row["status"]
    failures = row["sample_status_counts"]
    if key in ("missing", "invalid"):
        return "Inspect runner installation, artifact manifest, setup error and checkout identity before evaluating performance."
    if key == "excluded":
        return "Add an isolated SSH fixture; never substitute a local page result."
    if key == "error":
        return "Inspect route error, app.log, fixture dependencies and screenshot evidence. Fix the harness or product only after attribution."
    if key == "incomplete":
        if failures.get("indistinguishable", 0):
            return "Inspect origin/target ROI and page identity. Choose a distinct origin or meaningful region; do not loosen the tolerance."
        if failures.get("timeout", 0):
            return "Inspect failed screenshots and asynchronous data readiness. Reproduce with real dependencies and a separate diagnostic run."
        return "Inspect missing samples, reference evidence and route validation before interpreting latency."
    if row["budget_warnings"]:
        control = row.get("measurement_control", {})
        if ((control.get("median_capture_share") or 0) >= .6 and (control.get("first_capture_match_rate") or 0) >= .9):
            return "Capture-dominated observation candidate: most visits match on the first screenshot. Inspect paired origin capture and native traces; do not subtract percentiles or infer a product regression."
        return "Inspect capture/command overhead and diagnostic spans; reproduce on the same physical Mac. Only optimize confirmed work."
    if row.get("rss_after_matches", {}).get("growth_candidate"):
        return "Repeat retention test over longer runs and inspect caches/view lifecycle; RSS growth is not proof of a leak."
    return "Review target, before and after screenshots; verify data is ready. Do not change production code without supporting evidence."


def summarize_route(expected, data, page, group_error, folder, samples):
    key = route_id(expected)
    p = page or {}
    raw_status = p.get("status")
    row = {**expected, "route_id": key, "group": group_id(expected),
           "source_path_hint": "mods/" + expected["mod"] + "/" if expected["mod"] != "native-terminal" else "Herdr native terminal (upstream)",
           "raw_status": raw_status, "status": "missing", "reason": group_error or p.get("reason"),
           "reference_review": "not_reviewed", "sample_status_counts": {},
           "warm": p.get("warm", {}), "first_visit": p.get("first_visit"),
           "reference": p.get("reference"), "from_page": p.get("from_page"),
           "idle_app_process": p.get("idle_app_process", {}),
           "rss_after_matches": p.get("rss_after_matches", {}),
           "settled_cpu_frames": p.get("settled_cpu_frames", {}),
           "measurement_control": p.get("measurement_control", {}),
           "budget_warnings": [], "evidence": {"artifact": folder.name, "report": "report.json",
                                               "app_log": "app.log", "frame_log": "frames.jsonl"}}
    if not page:
        row["reason"] = row["reason"] or data.get("fatal_error") or "Expected route absent from report"
    elif expected["fixture"] == "ssh" and raw_status == "not_measured":
        row["status"] = "excluded"
        row["reference_review"] = "not_applicable"
    elif raw_status in ("error", "incomplete"):
        row["status"] = raw_status
    elif raw_status == "provisional_measured":
        warm = p.get("warm", {})
        raw = p.get("samples", [])
        # Cross-check raw visits, all metric counts, and the required images.
        files = [key + suffix for suffix in (".png", "--before.png", "--after.png")]
        valid = (data.get("samples") == samples and warm.get("attempts") == samples
                 and warm.get("matched") == samples and warm.get("failures") == 0
                 and len(raw) == samples + 1
                 and all(s.get("status") == "matched" for s in raw)
                 and raw[0].get("phase") == "first_visit"
                 and all(s.get("phase") == "warm" for s in raw[1:])
                 and all(warm.get("metrics", {}).get(m, {}).get("count") == samples
                         and all(finite(warm["metrics"][m].get(k)) and warm["metrics"][m][k] >= 0
                                 for k in ("p50", "p95", "max")) for m in METRICS)
                 and all((folder / name).is_file() for name in files)
                 and isinstance(p.get("reference"), dict)
                 and bool(p.get("from_page")))
        try:
            approved = load_json(folder / "approved.json")[key]["approved"]
            valid = valid and approved is False
        except (OSError, ValueError, KeyError, TypeError):
            valid = False
        row["status"] = "provisional" if valid else "invalid"
        if not valid:
            row["reason"] = "Reported successful route lacks complete raw visits, metrics or unapproved visual evidence"
    else:
        row["status"] = "invalid"
        row["reason"] = row["reason"] or "Unexpected route status"
    if page:
        row["sample_status_counts"] = dict(Counter(s.get("status", "unknown") for s in p.get("samples", [])))
        row["evidence"]["screenshots"] = sorted(x.name for x in folder.glob(key + "*.png"))
    if row["status"] == "provisional":
        for metric, threshold in (("first_change_ms", BUDGETS["feedback_ms"]),
                                  ("reference_match_ms", BUDGETS["warm_match_ms"])):
            observed = p95(row, metric)
            if observed is not None and observed > threshold:
                row["budget_warnings"].append({"metric": metric, "p95_ms": observed, "budget_ms": threshold})
    row["priority"] = priority(row)
    row["next_action"] = recommendation(row)
    return row


def diagnostics(folder, commit):
    path = folder / "diagnostic" / "report.json"
    if not path.exists():
        return {"status":"not_available"}
    try:
        d = load_json(path)
        if d.get("commit") != commit or d.get("mode") != "diagnostic_candidate" or d.get("diagnostic") is not True:
            raise ValueError("diagnostic identity/contract mismatch")
        result = []
        for page in d["pages"]:
            counts = Counter()
            elapsed = Counter()
            maxima = {}
            for sample in page.get("diagnostic_spans", []):
                for g in sample.get("groups", []):
                    k = (g["scope"], g["module"], g["op"], g.get("family") or "")
                    counts[k] += g["count"]
                    elapsed[k] += g["sum_ms_nonexclusive"]
                    maxima[k] = max(maxima.get(k, 0), g["max_ms"])
            groups = [{"scope":k[0], "module":k[1], "operation":k[2], "family":k[3],
                       "count":counts[k], "sum_ms_nonexclusive":round(elapsed[k],3),
                       "max_ms":maxima[k]} for k in sorted(elapsed, key=lambda k: (-elapsed[k], k))]
            result.append({"route_id":route_id(page), "status":page.get("status"),
                           "reason":page.get("reason"), "span_count":sum(counts.values()),
                           "top_groups":groups[:15], "report":"diagnostic/report.json"})
        return {"status":"observed" if any(p["span_count"] for p in result) else "no_spans",
                "fatal_error":d.get("fatal_error"), "pages":result,
                "note":"Instrumented samples are not latency baselines; spans may overlap or be absent."}
    except (OSError, ValueError, KeyError, TypeError) as e:
        return {"status":"invalid", "reason":str(e)}


def select_diagnostic(path):
    """Bound extra CI work to one route per group. Never select absent/SSH routes."""
    data = load_json(path)
    candidates = [p for p in data.get("pages", []) if p.get("status") in ("incomplete", "provisional_measured")]
    expected = {route_id(r): r for r in PLAN if r["fixture"] != "ssh"}
    candidates = [p for p in candidates if route_id(p) in expected]
    if not candidates:
        return ""
    candidates.sort(key=lambda p: (p.get("status") != "incomplete",
                                   -(p95(p, "reference_match_ms") or 0), route_id(p)))
    return candidates[0]["page"]


def aggregate(root, commit, head, run_url, matrix_result, samples, selection=None):
    planned = PLAN
    if selection is not None:
        wanted = {(r["layout"], r["stack"], page) for r in selection["include"] for page in r["pages"]}
        planned = [p for p in PLAN if (p["layout"], p["stack"], p["page"]) in wanted]
        if not planned or len(planned) != len(wanted):
            raise ValueError("invalid scoped native selection")
    groups, rows = [], []
    for group in sorted({group_id(p) for p in planned}):
        folder = root / ("native-benchmark-" + group + "-" + commit)
        data, pages, error = read_evidence(folder / "report.json", commit, group)
        try:
            runner = load_json(folder / "runner.json")
            if runner.get("commit") != commit:
                raise ValueError("runner checkout mismatch")
        except (OSError, ValueError) as e:
            runner = {"status":"unavailable", "reason":str(e)}
        entry = {"group":group, "artifact":folder.name, "report_error":error,
                 "fatal_error":data.get("fatal_error"), "runner":runner,
                 "environment":{k:data.get(k) for k in ("platform","machine","processor","cpu_count","herdr_version",
                     "samples","timeout_seconds","poll_seconds","settle_seconds","idle_seconds","fixture_files","tolerance")},
                 "startup_first_screenshot_ms":data.get("startup_first_screenshot_ms"),
                 "diagnostics":diagnostics(folder, commit)}
        groups.append(entry)
        for expected in planned:
            if group_id(expected) == group:
                rows.append(summarize_route(expected, data, pages.get(route_id(expected)), error, folder, samples))
    rows.sort(key=lambda p: (p["priority"], -(p95(p, "reference_match_ms") or 0), p["route_id"]))
    counts = Counter(p["status"] for p in rows)
    required = sum(p["fixture"] != "ssh" for p in planned)
    blockers = [p["route_id"] for p in rows if p["status"] not in ("provisional","excluded")]
    ready = (not blockers and counts["provisional"] == required and matrix_result == "success"
             and all(g["runner"].get("capture") == "success" and g["runner"].get("validate") == "success" for g in groups))
    return {"schema":"herdr.ai-benchmark.v1", "checkout_sha":commit, "pr_head_sha":head, "run_url":run_url,
            "matrix_result":matrix_result, "status":"complete_provisional" if ready else "needs_investigation",
            "coverage":{"planned":len(planned),"total_routes":len(PLAN),"not_selected":len(PLAN)-len(planned),"required":required,"provisional":counts["provisional"],
                        "excluded":counts["excluded"],"approved":0,"by_status":dict(counts)},
            "metric_contract":{"latency":"CLI dispatch to screenshot response upper bound; not input-to-display or data-ready latency",
                "cpu":"app process only, 100% = one core", "rss":"MiB; retention is not proof of a leak",
                "budgets_ms":BUDGETS,"comparison":"No before/after regression claim from candidate references or different runners. Use benchmark-compare.py with approved matching references and controlled hardware.",
                "diagnostics":"Separate bounded instrumented pass; groups overlap and are not a critical path"},
            "blocking_routes":blockers, "groups":groups, "routes":rows,
            "next_iteration":{"first":"resolve missing/invalid/incomplete evidence", "then":"review screenshots and reproduce flagged observations",
                "change":"inspect source_path_hint and diagnostic groups, patch one confirmed bottleneck, add a regression test",
                "verify":"rerun CI and compare approved same-device baseline; do not auto-approve or auto-merge",
                "budget":"one diagnostic route per matrix job, five warm visits; no external model calls"}}


def fmt(v):
    return f"{v:.1f}" if finite(v) else "—"


def safe(v):
    # Report prose is data, not Markdown or workflow instructions.
    return re.sub(r"[\r\n]+", " ", str(v or "")).replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;").replace("@", "&#64;")[:240]


def markdown(report):
    c = report["coverage"]
    out = ["<!-- herdr-native-benchmark-report:v1 -->",
           "## Native benchmark feedback",
           "",
           f"**{c['provisional']}/{c['required']} required routes measured (provisional)** · "
           f"{c['excluded']} excluded · {c.get('not_selected', 0)} not selected · {c['approved']} visually approved · matrix: {safe(report['matrix_result'])}",
           "",
           f"Commit: `{safe(report['pr_head_sha'][:12])}` · [Run and artifacts]({report['run_url']})",
           "",
           "Download **ai-benchmark-report** for machine-readable JSON, evidence pointers and prioritized next actions. Raw matrix artifacts contain screenshots, samples and logs.",
           "",
           "| Priority | Layout / page | Status | Matched | Feedback P95 ms | Match P95 ms | Capture P95 ms | Idle CPU % | RSS MiB |",
           "|---|---|---|---:|---:|---:|---:|---:|---:|"]
    for row in report["routes"]:
        warm = row["warm"]
        matched = str(warm.get("matched", "—")) + "/" + str(warm.get("attempts", "—"))
        # Incomplete rows retain raw data in JSON, but don't present partial percentiles as a comparable result.
        valid = row["status"] == "provisional"
        out.append("| P" + str(row["priority"]) + " | " + safe(row["route_id"]) + " | " + row["status"]
                   + " | " + matched + " | " + " | ".join(fmt(p95(row,m)) if valid else "—" for m in ("first_change_ms","reference_match_ms","capture_ms"))
                   + " | " + fmt(row["idle_app_process"].get("cpu_pct_one_core"))
                   + " | " + fmt(row["idle_app_process"].get("rss_after_mib")) + " |")
    out += ["", "### Next iteration"]
    for group in report["groups"]:
        if group["report_error"] or group["fatal_error"] or group["runner"].get("capture") != "success" or group["runner"].get("validate") != "success":
            out.append("- **" + safe(group["group"]) + "**: runner capture=" + safe(group["runner"].get("capture","unknown"))
                       + ", validation=" + safe(group["runner"].get("validate","unknown")) + ". "
                       + safe(group["fatal_error"] or group["report_error"] or "Inspect the workflow logs."))
    for row in report["routes"]:
        if row["priority"] <= 2:
            out.append("- **" + safe(row["route_id"]) + "**: " + safe(row["reason"] or row["next_action"]))
    if not any(row["priority"] <= 2 for row in report["routes"]):
        out.append("- No blocking route, budget or retention candidate from this run. Review screenshots before approving any baseline.")
    for group in report["groups"]:
        diag = group["diagnostics"]
        out.append("- Diagnostic " + safe(group["group"]) + ": " + safe(diag["status"])
                   + (" (" + ", ".join(safe(p["route_id"]) + ": " + str(p["span_count"]) + " spans" for p in diag.get("pages", [])) + ")" if diag.get("pages") else ""))
    out += ["", "**Interpretation:** provisional screenshot observations, not verified content readiness or physical input-to-paint. "
            "Different hosted machines are not controlled before/after comparisons. Missing data is not zero. Diagnostic runs are separate. "
            "Fix measurement blockers first; never auto-approve a screenshot or auto-merge an optimization.", ""]
    return "\n".join(out)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--select-diagnostic", type=Path)
    p.add_argument("--input", type=Path)
    p.add_argument("--output", type=Path)
    p.add_argument("--commit")
    p.add_argument("--head")
    p.add_argument("--run-url")
    p.add_argument("--matrix-result")
    p.add_argument("--samples", type=int, default=30)
    p.add_argument("--selection", type=json.loads)
    a = p.parse_args()
    if a.select_diagnostic:
        print(select_diagnostic(a.select_diagnostic))
        return
    if not all((a.input, a.output, a.commit, a.head, a.run_url, a.matrix_result)):
        p.error("aggregation requires input, output, commit, head, run-url and matrix-result")
    if not re.fullmatch(r"[0-9a-f]{40}", a.commit) or not re.fullmatch(r"[0-9a-f]{40}", a.head):
        p.error("expected exact 40-character commit SHA")
    report = aggregate(a.input, a.commit, a.head, a.run_url, a.matrix_result, a.samples, a.selection)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "ai-report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    (a.output / "report.md").write_text(markdown(report))
    (a.output / "next-actions.json").write_text(json.dumps({
        "schema":report["schema"],"checkout_sha":a.commit,"pr_head_sha":a.head,
        "status":report["status"],"workflow":report["next_iteration"],
        "actions":[{"route":r["route_id"],"priority":r["priority"],"source_path_hint":r["source_path_hint"],
                    "action":r["next_action"],"evidence":r["evidence"]} for r in report["routes"] if r["priority"] <= 2]
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
