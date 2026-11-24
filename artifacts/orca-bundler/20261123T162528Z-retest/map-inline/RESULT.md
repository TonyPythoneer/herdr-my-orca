# Retest: Herdr ignores inline source map (data: URI)

Verdict: **CONFIRMED** (every frame reported at main.js:5, the generated line; no mapping to src/orig.js:42).

Versions: herdr-app 0.1.17, hc 0.1.22 (see versions.txt).

| Variant | Directive | check exit | Frame (stderr) |
|---|---|---|---|
| v1 | `//# sourceMappingURL=data:...` (sourcesContent [null]) | 1 | `at <anonymous> (.../mods/probe-inline-v1/main.js?v=1:5:11)` |
| v2 | `//@ sourceMappingURL=data:...` | 1 | `at <anonymous> (.../mods/probe-inline-v2/main.js?v=1:5:11)` |
| v3 | `//# sourceMappingURL=data:...` (sourcesContent 50 lines) | 1 | `at <anonymous> (.../mods/probe-inline-v3/main.js?v=1:5:11)` |

Each run also printed `ORCA_PROBE_INLINE` and `check failed: <folder>` on stderr.
Exit codes are in check-vN.stdout.txt (`exit=1`); stderr in check-vN.stderr.txt.

Notes:
- The map is valid: decoding `AAyCA` gives generated 5:0 -> src/orig.js 42:0 (1-based line 42). So the failure is Herdr not applying it, not a bad map.
- Only one frame per run, so "every frame" holds trivially.
- Fixtures are in fixtures-mods/ and main-vN.js; maps in map1.json and map3.json.
- Caveat: this shows Herdr's reported coordinates are generated ones. It does not prove the inline map is never loaded; the output is consistent with it being ignored.
- No repo files edited, nothing written to ~/.config/herdr-app, no status/shot/do/ls/open calls.
