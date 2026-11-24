"""Opt-in instrumentation of disposable Herdr mod copies; never edit production files."""
import json
from pathlib import Path
import re
import statistics

HOST_IMPORT = re.compile(r'import\s*\{([^}]+)\}\s*from\s*["\']herdr["\'];')
VIEW = re.compile(r'\bexport default class (\w+) extends View\s*\{')
OPERATIONS = {"exec", "readTextFile", "knownAgents", "hc"}
PREFIX = "HERDR_PAGE_DIAG "


def instrument(source, label):
    """Return source and coverage. Preserve import aliases and synchronous behavior."""
    wrapped = []
    def replace(match):
        names = []
        for entry in match[1].split(","):
            entry = entry.strip()
            if not entry:
                continue
            parts = re.split(r"\s+as\s+", entry)
            if parts[0] in OPERATIONS and len(parts) <= 2:
                name = parts[-1]
                native = "__pageDiagNative_" + name
                names.append(parts[0] + " as " + native)
                wrapped.append((parts[0], name, native))
            else:
                names.append(entry)
        return 'import { ' + ', '.join(names) + ' } from "herdr";'
    # Only rewrite actual host import declarations, not arbitrary comments/strings.
    source = re.sub(r'^import\s*\{([^}]+)\}\s*from\s*["\']herdr["\'];', replace, source, flags=re.M)
    view = VIEW.search(source)
    if not wrapped and not view:
        return source, []
    helper = '''
// Generated in an isolated benchmark copy only.
const __pageDiagLabel = LABEL;
function __pageDiagNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now() : Date.now();
}
function __pageDiagEmit(op, started, tick, outcome, family) {
  try {
    console.log("HERDR_PAGE_DIAG " + JSON.stringify({
      module: __pageDiagLabel, op, start_ms: started, end_ms: Date.now(),
      duration_ms: Math.max(0, __pageDiagNow() - tick), outcome, family
    }));
  } catch (_) { /* diagnostics must never change mod behavior */ }
}
function __pageDiagCall(op, fn, receiver, args) {
  const started = Date.now(), tick = __pageDiagNow();
  // No argv, cwd, URL, file path, content, exception text or secret is recorded.
  const family = op === "exec" && ["git","rg","find","ls","claude","codex","pi","opencode","zsh","sh","bash"].includes(args[0])
    ? args[0] : op === "exec" ? "other" : null;
  try {
    const value = fn.apply(receiver, args);
    if (value && typeof value.then === "function") {
      return value.then(result => {
        __pageDiagEmit(op, started, tick, result?.code != null && result.code !== 0 ? "nonzero" : "ok", family);
        return result;
      }, error => {
        __pageDiagEmit(op, started, tick, "rejected", family);
        throw error;
      });
    }
    __pageDiagEmit(op, started, tick, "ok", family);
    return value;
  } catch (error) {
    __pageDiagEmit(op, started, tick, "threw", family);
    throw error;
  }
}
'''.replace("LABEL", json.dumps(label), 1)
    # Prepend wrappers so top-level calls cannot encounter a temporal dead zone.
    for op, name, native in wrapped:
        helper += f'const {name} = (...args) => __pageDiagCall({json.dumps(op)}, {native}, undefined, args);\n'
    source = helper + "\n" + source
    coverage = [op for op, _, _ in wrapped]
    if view:
        cls = view[1]
        source += f'''
for (const __method of ["init", "render"]) {{
  const __original = {cls}.prototype[__method];
  if (typeof __original === "function") {{
    {cls}.prototype[__method] = function(...args) {{
      return __pageDiagCall(__method, __original, this, args);
    }};
  }}
}}
'''
        coverage.extend(["init", "render"])
    return source, coverage


def install(mods):
    coverage = []
    for path in sorted(mods.glob("*/*.js")):
        if path.name.endswith(".test.js"):
            continue
        label = path.relative_to(mods).as_posix()
        source, ops = instrument(path.read_text(), label)
        if ops:
            path.write_text(source)
            coverage.append({"module": label, "operations": ops})
    return coverage


def parse_events(text):
    result = []
    for line in text.splitlines():
        pos = line.find(PREFIX)
        if pos < 0:
            continue
        try:
            item, _ = json.JSONDecoder().raw_decode(line[pos + len(PREFIX):])
            if isinstance(item, dict) and {"module","op","start_ms","end_ms","duration_ms","outcome"} <= item.keys():
                result.append(item)
        except (ValueError, TypeError):
            continue
    return result


def summarize_events(events, start_ms, end_ms, mod):
    # Completed spans within the interval only. Never add overlapping durations
    # and call that total page latency. Background modules are shown separately.
    groups = {}
    for item in events:
        if not (start_ms <= item["start_ms"] <= item["end_ms"] <= end_ms):
            continue
        key = (item["module"], item["op"], item.get("family") or "")
        groups.setdefault(key, []).append(item)
    rows = []
    for (module, op, family), items in groups.items():
        times = sorted(i["duration_ms"] for i in items)
        rows.append({"module": module, "op": op, "family": family or None,
                     "scope": "target" if module.split("/")[0] == mod else "background",
                     "count": len(times), "p50_ms": statistics.median(times), "max_ms": max(times),
                     "sum_ms_nonexclusive": round(sum(times), 3),
                     "non_ok": sum(i["outcome"] != "ok" for i in items)})
    return sorted(rows, key=lambda r: (-r["sum_ms_nonexclusive"], r["module"], r["op"]))
