"""Process resource measurements for the isolated native benchmark (macOS/Linux)."""
import subprocess
import time
import statistics


def cpu_seconds(value):
    # ps TIME may be mm:ss.xx, hh:mm:ss, or days-hh:mm:ss.
    day, sep, rest = value.strip().partition("-")
    days = int(day) if sep else 0
    parts = (rest if sep else day).split(":")
    result = 0.0
    for part in parts:
        result = result * 60 + float(part)
    return days * 86400 + result


def snapshot(pid):
    result = subprocess.run(["ps", "-p", str(pid), "-o", "time=", "-o", "rss="],
                            capture_output=True, text=True, timeout=5)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError("Benchmark app process is no longer observable")
    cpu, rss = result.stdout.split()
    return {"monotonic_s": time.monotonic(), "cpu_s": cpu_seconds(cpu), "rss_mib": int(rss) / 1024}


def measure_idle(pid, seconds, sample=snapshot, sleep=time.sleep):
    before = sample(pid)
    sleep(seconds)
    after = sample(pid)
    elapsed = after["monotonic_s"] - before["monotonic_s"]
    cpu = after["cpu_s"] - before["cpu_s"]
    if elapsed <= 0 or cpu < 0:
        raise ValueError("Invalid process counter interval")
    return {"elapsed_s": round(elapsed, 3), "cpu_pct_one_core": round(cpu / elapsed * 100, 3),
            "rss_before_mib": round(before["rss_mib"], 3), "rss_after_mib": round(after["rss_mib"], 3),
            "rss_delta_mib": round(after["rss_mib"] - before["rss_mib"], 3)}


def retention(samples):
    """A plateau vs growth hint, not proof of a memory leak."""
    if len(samples) < 6:
        return {"status":"insufficient_samples", "count":len(samples)}
    first = statistics.median(samples[:3])
    last = statistics.median(samples[-3:])
    return {"status":"observed", "count":len(samples), "first_three_median_mib":round(first,3),
            "last_three_median_mib":round(last,3), "delta_mib":round(last-first,3),
            "peak_mib":round(max(samples),3), "samples_mib":samples,
            "growth_candidate":last-first > 16 and last-first > first * .10}
