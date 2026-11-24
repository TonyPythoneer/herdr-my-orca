#!/usr/bin/env python3
"""Compare two non-instrumented benchmark reports without hiding missing samples."""
import argparse
import json
import math
from pathlib import Path
import sys

ENV_KEYS = ("schema", "mode", "platform", "machine", "processor", "cpu_count",
            "herdr_version", "samples", "timeout_seconds", "poll_seconds",
            "settle_seconds", "idle_seconds", "tolerance", "fixture_files", "metric_contract", "diagnostic")
METRICS = ("first_change_ms", "reference_match_ms", "command_ms", "capture_ms")


def key(page):
    return (page["layout"], page["stack"], page["page"], page["fixture"])


def complete(page, count):
    warm = page.get("warm", {})
    return (page.get("status") == "measured" and warm.get("attempts") == count
            and warm.get("matched") == count and warm.get("failures") == 0)


def compare(before, after):
    reasons = [k for k in ENV_KEYS if k not in before or k not in after or before[k] != after[k]]
    if before.get("mode") != "measure" or after.get("mode") != "measure":
        reasons.append("not_measurement")
    if before.get("diagnostic") is not False or after.get("diagnostic") is not False:
        reasons.append("instrumented_run")
    if not isinstance(before.get("samples"), int) or before["samples"] < 30:
        reasons.append("fewer_than_30_warm_samples")
    left = {key(p): p for p in before["pages"]}
    right = {key(p): p for p in after["pages"]}
    rows = []
    for route in sorted(left.keys() | right.keys()):
        b, a = left.get(route), right.get(route)
        result = dict(zip(("layout", "stack", "page", "fixture"), route))
        rows.append(result)
        if not b or not a:
            result.update(status="not_comparable", reason="missing route in one run")
            continue
        if reasons:
            result.update(status="not_comparable", reason="environment: " + ", ".join(reasons))
            continue
        if not complete(b, before["samples"]) or not complete(a, after["samples"]):
            result.update(status="not_comparable", reason="incomplete or unmeasured route",
                          before_status=b.get("status"), after_status=a.get("status"),
                          before_failure_rate=b.get("warm", {}).get("failure_rate"),
                          after_failure_rate=a.get("warm", {}).get("failure_rate"))
            continue
        if not b.get("reference") or b.get("reference") != a.get("reference") or not b.get("from_page") or b["from_page"] != a.get("from_page"):
            result.update(status="not_comparable", reason="different or missing reference, ROI, viewport or origin page")
            continue
        metrics = {}
        for metric in METRICS:
            bm = b["warm"]["metrics"].get(metric, {})
            am = a["warm"]["metrics"].get(metric, {})
            x, y = bm.get("p95"), am.get("p95")
            if bm.get("count") != before["samples"] or am.get("count") != after["samples"] or not all(isinstance(v, (int,float)) and math.isfinite(v) and v >= 0 for v in (x,y)):
                continue
            delta = y - x
            metrics[metric] = {"before_p95": x, "after_p95": y, "delta_ms": round(delta, 3),
                               "delta_pct": round(100 * delta / x, 2) if x else None,
                               "before_p50": bm.get("p50"), "after_p50": am.get("p50"),
                               "before_max": bm.get("max"), "after_max": am.get("max"),
                               "regression_candidate": delta > 20 and delta > .20 * x,
                               "improvement_candidate": -delta > 20 and -delta > .20 * x}
        if not all(m in metrics for m in METRICS):
            result.update(status="not_comparable", reason="incomplete metric samples")
            continue
        primary = ("first_change_ms", "reference_match_ms")
        overhead = metrics["capture_ms"]["regression_candidate"] or metrics["command_ms"]["regression_candidate"]
        resources = {}
        for name, field, units in [("idle_app_process","cpu_pct_one_core","percentage points"),
                                   ("idle_app_process","rss_after_mib","MiB"),
                                   ("rss_after_matches","delta_mib","MiB")]:
            x = b.get(name, {}).get(field)
            y = a.get(name, {}).get(field)
            if all(isinstance(v, (int,float)) and math.isfinite(v) for v in (x,y)):
                resources[field] = {"before":x,"after":y,"delta":round(y-x,3),"units":units}
        result["resource_observations"] = resources
        result.update(status="regression_candidate" if any(metrics[m]["regression_candidate"] for m in primary)
                      else "improvement_candidate" if any(metrics[m]["improvement_candidate"] for m in primary)
                      else "stable", metrics=metrics,
                      overhead_warning=overhead,
                      note="Repeat under controlled conditions; observation latency is not proof of root cause.")
    counts = {status: sum(row["status"] == status for row in rows) for status in
              ("stable","regression_candidate","improvement_candidate","not_comparable")}
    return {"before_commit": before.get("commit"), "after_commit": after.get("commit"),
            "environment_mismatches": reasons, "counts": counts, "pages": rows}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("before", type=Path)
    p.add_argument("after", type=Path)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    report = compare(json.loads(args.before.read_text()), json.loads(args.after.read_text()))
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        with args.output.open("x") as f:
            f.write(rendered)
    else:
        print(rendered, end="")
    # Not a merge gate: regression candidates require repetition and interpretation.
    return 2 if not any(row["status"] != "not_comparable" for row in report["pages"]) else 0


if __name__ == "__main__":
    sys.exit(main())
