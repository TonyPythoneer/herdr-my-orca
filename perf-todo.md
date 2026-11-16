# perf-todo.md — herdr-my-orca performance audit

Baseline: 2026-11-15. 41 mods, 18,456 LOC JS. Pure modules can be tested in
Node; UI rendering runs inside Herdr/gpui. Treat UI hotspots as static-review
findings until measured in the Herdr runtime.

## 0. Measurement method

- Pure modules: `node --test mods/<x>/*.test.js`, plus ad-hoc `node -e` micro-timing
  on the exported functions with large inputs (diff 2000-line, usage 1000-bucket).
- UI mods: no automated measurement available. Plan: add a Herdr-side timing probe
  (console.time around render) only if needed; otherwise rely on code review of
  render paths and the invariants below.
- Always record before/after numbers in the "Done" section; never claim a speedup
  without a measurement.

## 1. Baseline invariants to preserve

- Render paths must not allocate unbounded arrays per frame (virtual lists already
  used in orca-diff; check orca-tabs/orca-files/orca-spaces lists).
- localStorage reads + JSON.parse must not happen inside per-row render; move to
  init or memoize with invalidation.
- No O(n²) over terminal/agent lists in render (crew-style grouping is O(n)).
- Cache parsed usage output; probes already separated by provider.

## 2. Hotspots (static review, by file size)

1. `mods/orca-spaces/main.js` (1300) — largest. Reads `workspaceOptions()` and
   `stored()` (localStorage+JSON.parse) during render (lines ~537, 617, 1206).
   Candidate: memoize workspaceOptions + stored results; invalidate on nav write.
2. `mods/orca-files/main.js` (1144) — file tree rendering; check for per-row
   `stored`/`JSON.parse` and nested filters.
3. `mods/orca-tabs/main.js` (1091) — tab strip; check drag/reorder O(n²).
4. `mods/win98/dialog.js` (954) — windowing; mostly static.
5. `mods/agent-config/main.js` (850) — model cache read; check parse frequency.
6. `mods/orca-changes/main.js` (803) — diff/change list; reuse diff-rows.
7. `mods/orca-menu/main.js` (775) — menu; check filtering.
8. `mods/orca-new-menu/models.js` + main (409+?) — model probe parsing.

## 3. Memory concerns

- Review caches (`pr.cache.v2`) grow unbounded across repos/branches; consider
  cap + LRU eviction.
- `git.cache.v2`, `projects.saved.v1` similarly.
- Usage buckets arrays small but re-parsed each probe; fine.
- Virtual lists already bound row DOM; verify orca-spaces cards use them.

## 4. Duplication (simplification, not perf)

- `review-store.js` duplicated verbatim in orca-spaces and orca-changes. Cross-mod
  import not available in Herdr; keep in sync or extract to a shared mod if Herdr
  supports. Until then, any edit must touch both.
- `stored()` helper duplicated in orca-spaces (and similar in other mods).

## 5. Iteration plan (step by step)

- [x] Step 1: audit + perf-todo.md; micro-opt crewGroups (O(n) grouping). Tests pass.
- [x] Step 2: memoize `workspaceOptions()` + `stored()` in orca-spaces; measure render.
- [ ] Step 3: cap review/git/project caches (LRU) in both review-stores + stored sites.
- [x] Step 4: verify virtualization in orca-spaces/orca-files/orca-tabs lists.
- [x] Step 5: micro-bench diffRows/usage parse with large inputs; optimize only if justified.
- [x] Step 6: check whether Herdr allows a shared `stored()` module.
- [ ] Step 7: re-run all node tests + manual Herdr smoke.

## 6. Done

- Step 1: `mods/orca-pane/crew.js` crewGroups now single-pass grouping (was
  STATUS_ORDER.length * members filter). Node tests: 6/6 pass.
- Step 2: `mods/orca-spaces/main.js` `stored()` memoized by raw string; skips
  re-parse on repeated renders, auto-invalidates on external writes.
  `workspaceOptions()` now memoized by the stored result reference (avoids spread + alloc per render).
- Step 3: Review stores target 200 entries by refresh timestamp, not true
  LRU: reads do not update `at` because it also determines freshness. Branches
  currently in the sidebar and fresh entries are protected from eviction, even
  when they exceed the target, to preserve refresh pacing. Git and
  saved-project stores remain unresolved: they are also the persisted project
  catalog, so blindly evicting entries would remove visible projects.
  The spaces view now replaces its local review cache when shared state changes,
  so evicted or invalidated entries cannot be restored by a stale merge; completed
  lookups first incorporate the latest shared state before saving.
  Inactive negative git entries are pruned after refresh; active negative entries
  and all known projects remain. Reopening a pruned folder probes it again.
  An experimental duplicate eviction reduced a synthetic 1,000-entry cache from
  153,891 to 30,799 JSON bytes, but was removed after review: reopening an evicted
  remote location while offline could lose its cached grouping. No git-cache
  reduction beyond inactive negative entries is claimed.
- Step 4: orca-files virtualizes its tree at one call site; search results are
  capped at 200 matches and rendered directly. orca-spaces and orca-tabs render
  directly. Herdr's `list` supports variable heights, but virtual renderers forbid
  per-row handlers; spaces cards have multiple controls and drag handlers.
- Step 5: Node, 1,000 iterations after 10 warmups: 2,000-line diffRows took
  498.93 ms before and 513.23 ms after; 1,000-bucket parseOmpUsage took 450.83 ms
  before and 465.35 ms after. Neither function changed; differences are run noise,
  not a speedup claim. No hot-loop optimization justified by these timings.
- Spaces row planning: 30 iterations of 4,000 spaces (two per worktree) took
  517.20 ms before and 107.43 ms after replacing the duplicate lookup with a map.
  This is a synthetic data-projection benchmark, not a UI frame measurement.
- Agent grouping: 30 iterations of 2,000 cards and 2,000 agents took 1,121.55 ms
  for the previous per-card filter and 25.24 ms for the grouped lookup in Node.
  This measures the grouping alone, not the rendered interface.
- Tab pane selection: one pass now picks the first agent pane or first pane for
  each tab, rather than scanning all panes for each tab. In Node, 30 iterations
  with 2,000 tabs and panes took 347.13 ms before and 3.63 ms after; this is a
  synthetic selection benchmark, not a UI frame measurement.
- Spaces grouping now plans row, status and host descriptors separately from
  element construction. It caches the descriptors by their actual dependencies
  (row host/status order, grouping, repair and fold state); row positions resolve
  against the current rows so other changes do not leave stale card data.
  In Node with 200 synthetic rows, 10,000 signature computations took 66.49 ms
  versus 123.63 ms for 10,000 planning calls; the difference is not an observed
  Herdr frame-time improvement.
- Isolated Herdr 0.1.15 probe, 200 synthetic folder workspaces and 200 agents:
  eight instrumented `render()` calls took 34–46 ms at HEAD and 32–44 ms with
  the current changes. Both constructed 6,004 elements directly in main.js per
  call; elements made in imported helpers were not counted. A 200 ms timer
  triggered each render. This is not a frame-time or scrolling measurement and
  does not establish a UI speedup. Both versions scrolled to workspace 199 in
  the isolated synthetic fixture; full node counts remain open. An isolated
  two-workspace session passed fold/unfold and drag-reorder, and a missing saved
  folder showed its indicator (fixture polling shortened to one second). A
  separate loopback core then verified local/remote machine folding, project
  folding, same-host reordering and rejection of a cross-host drag after the
  descriptor change. The changed 200-row fixture also scrolled to its last row.
  After the descriptor change the same
  fixture took 31–35 ms for scripted renders and still created 6,004 directly
  counted elements; this does not prove a material UI speedup.
- Shared helper: `herdr-app check` rejects a relative import outside the mod's
  application directory, so the duplicated helpers cannot be shared that way.
- orca-tabs tabColorStore is memoized by raw string (localStorage fallback) with
  shared() primary; orca-menu `stored()` is memoized and the unread click handler
  uses it. Neither change has a separate runtime benchmark.
- Static audit: orca-files parses command output outside row rendering; its tree
  flattens at most 5,000 entries before virtualizing visible rows. orca-changes
  builds its capped 1,000-file list directly and delegates diffs to orca-diff.
  Agent-config reads and parses its catalog during initialization, while the
  new-menu model probe parses its response when invoked. The tab context menu
  filters panes once for its selected tab; tab drag uses indices for its move.
  These observations are not runtime performance measurements.

## 7. Virtualization plan (orca-spaces / orca-tabs)

Goal: reduce per-frame DOM allocation for long lists without changing visuals.

### Preconditions (must do first)
1. Herdr perf probe: wrap render in `console.time("spaces.render")` / `console.timeEnd`,
   scroll 200 workspaces, record baseline ms/frame and DOM node count.
2. `v_virtual_list` takes a fixed height; gpui-kit `list` supports variable heights
   but forbids handlers in its renderer. Current cards expand (agent list) and have
   multiple interactive controls, so fixed-height virtualization
   would clip. Options: (a) collapse agent lists by default (compact mode) so card
   height is fixed, (b) use a two-level list (host header + virtualized cards with
   estimated heights + overscan), (c) keep immediate mode but memoize card subtrees.

### Phase A — orca-tabs (low risk, small list)
- Tab count is bounded (usually < 30); virtualization not needed.
- Instead: memoize `item()` output per tab id when tab data unchanged (already
  mostly; tabColorStore memoized). No change planned.

### Phase B — orca-spaces (high risk)
1. Split `grouped()` into a pure data step (`planRows(rows, groupBy, machines)`)
   returning an array of `{ kind, data }` descriptors, and a render step mapping
   descriptors to elements. This separates expensive filtering from DOM building
   and enables memoization of the descriptor array.
2. Memoize the descriptors by the host/status ordering, grouping, repair and fold
   inputs they actually depend on. Resolve their indices against fresh rows each
   render. Measure the result; this does not avoid building the row elements.
3. Only if Phase B.2 is insufficient and a fixed card height is chosen, wrap the
   flat (single-machine, no host headers) branch in `v_virtual_list` with the
   measured item height + overscan 8. Keep multi-machine branch immediate (rare).
4. Saved-projects list: small, leave as-is; optionally virtualize if > 50 entries.

### Phase C — verification
- Re-run Herdr probe; compare ms/frame and node count. Record in Done.
- Run node tests (diff/crew/usage) — unaffected.
- Manual smoke: scrolling, drag-reorder, fold/unfold, multi-machine, missing folder.

### Rollback
- Each phase is a separate commit; Phase B.1 (pure data split) is safe to keep
  even if B.3 (virtualization) is reverted.

## 8. Subtasks and handoff (2026-11-15)

The earlier implementation was committed as `ee1069e`. This checkout was clean
at the start of the 2026-11-16 continuation. Work remains incomplete until the
unproved runtime and allocation items below have evidence. Continuation phases
are committed separately, with status recorded in section 9.

### Completed and checked

- [x] Group crew, workspace agents and tab panes in one pass. Tests cover status
  order, merged-worktree agents and first-agent/first-pane selection. Synthetic
  timings are in section 6; they do not establish an application speedup.
- [x] Separate sidebar host/status/row descriptors from element construction and
  memoize their structural inputs. Test host ordering, status ordering, folding,
  repair entries and resolving cached indices against reordered current rows.
- [x] Keep the two `review-store.js` copies identical. Protect visible branch
  keys and fresh entries from the 200-entry eviction target, so a working set over
  200 does not defeat the positive/negative TTLs. Tests exercise both stores and
  repeated ticks with 205 visible branches. The target is deliberately a soft cap.
- [x] Adopt shared review-cache deletions and synchronize before saving a lookup;
  test stale invalidation and concurrent updates. Copy mutable per-view storage
  state and tab-color fallback before modifying them; test independent instances
  and failed localStorage writes.
- [x] Remove inactive negative git-cache entries, while retaining active entries
  and known repository snapshots. Do not restore the discarded duplicate-entry
  eviction without proving offline grouping and project discovery are preserved.
- [x] Inspect list strategies and the named hotspots. The files tree has a
  bounded projection and virtualized visible rows; the changes list is capped but
  built directly; the tabs strip renders directly. Model probes/catalog parsing
  happen during probe/initialization, not per displayed row. See section 6.
- [x] Run the current Node suite: 39 tests pass. Initial `herdr-app check` passes
  for spaces, tabs, menu and changes. An isolated Herdr session verified 200-row
  scrolling, local and loopback-remote machine folds, project folding, same-host
  drag reorder and cross-host drag behavior. Missing-folder indicator was checked
  with a one-second **fixture-only** polling interval. These checks span several
  successive revisions, not one final unchanged build.
- [x] Obtain a provisional independent review. It found active-review eviction
  churn, a possible offline-grouping regression in duplicate git eviction, mutable
  memoized values, and gaps in measurements and documentation. The first three
  were addressed or the unsafe experiment removed; the reviewed snapshot predates
  those fixes and the tab-pane change, so it is not final acceptance.

### Remaining work

- [ ] Design a data-preserving bound for `git.cache.v2` and `projects.saved.v1`.
  They also hold the project catalog, including unopened and offline repositories;
  a hard LRU eviction can make user projects or offline grouping disappear. Trace
  consumers in `orca-spaces`, `orca-nav` and `orca-agents`, migration/restart and
  disconnected-host behavior before changing the stored format. Do not silently
  evict user-managed projects. Decide whether a paged catalog is warranted.
- [x] Decide whether a true persistent LRU is needed for review entries: current
  eviction orders stale, unprotected entries by refresh timestamp, while `at`
  also controls freshness. Keep both store copies synchronized and preserve TTL
  pacing, including more than 200 active or fresh branches and cross-mod writes.
- [ ] Address the long-list allocation invariant. The 200-workspace fixture still
  constructs at least 6,004 elements in the spaces module per render, with no
  demonstrated material render improvement. Herdr's lazy lists prohibit row
  handlers, while these variable-height cards have nested controls and drag
  handlers. Establish a design that preserves all interactions before applying
  conditional virtualization; do not assume fixed height or cache native elements.
- [ ] Obtain full frame timing and total native-element counts, if the runtime
  exposes them; the existing `Date.now()` probe measures script render time and
  counts only constructors called directly in `main.js`. Repeat baseline and final
  measurements with the same fixture and record the environment and limitations.
- [ ] Re-run end-to-end smoke on the **final** source: scroll 200 rows; fold and
  unfold projects and local/remote hosts; reorder within a host; check cross-host
  drag; expand agent lists with variable card heights; test a missing saved folder
  and an offline/rebuilt machine. The last tab-selection attempt returned a
  ScreenCaptureKit error, and its minimal test layout lacked Orca's `main` stack.
  Repeat tab selection/reorder in a representative layout rather than treating
  that fixture warning as a product failure or a passing check.
- [ ] Re-run all tests, initial mod checks, and an independent review against the
  final exact source. The last review's source identity is stale after fixes.
  Include cache races, more-than-200 behavior, external writes and the interaction
  and measurement gaps; resolve findings before considering the work complete.
  `agent-config` needs its required overlay props for a meaningful runtime check;
  standalone `herdr-app check` failed with null props and does not prove a defect.
- [ ] Reconcile this checklist and the original steps without marking a hard cap,
  full frame measurement, virtualization, or final review done until evidenced.

Useful verification commands (run from the repository root):

```sh
node --test mods/orca-diff/*.test.js mods/orca-pane/*.test.js mods/orca-spaces/*.test.js mods/orca-status/*.test.js mods/orca-tabs/*.test.js
herdr-app check mods/orca-spaces
herdr-app check mods/orca-tabs
herdr-app check mods/orca-menu
herdr-app check mods/orca-changes
git diff --check
```

`herdr-app check` may generate `gpui-kit.d.ts` and `jsconfig.json` inside a mod;
preserve pre-existing or concurrently created files. An isolated test fixture and
probe were built under `/tmp/orca-perf-a002`; temporary paths are not durable and
must be revalidated before reuse. Do not overwrite the user's live Herdr config.


## 9. Continuation status (2026-11-16)

### Phase 1 — cache policy and offline preservation: complete

- Keep review eviction ordered by refresh timestamp, with a soft target of 200.
  A separate persistent access timestamp/LRU is not justified by the measured
  workload; it would add read-side writes and must not change the freshness TTLs.
  Both store copies remain identical. Existing tests cover more than 200 active
  and fresh entries, stale eviction, invalidation and concurrent completions.
- `git.cache.v2` is also the catalog consumed by spaces (unopened main/sibling
  worktrees), nav (project filter choices), and agents (repository session scope).
  `projects.saved.v1` is explicitly user-managed; only its remove action deletes
  entries. JSON formats and restart behavior remain unchanged. A hard total bound
  cannot retain an arbitrary number of projects losslessly; pagination bounds
  loaded/rendered data, not total durable storage. Do not silently evict projects.
  A paged catalog is not warranted without evidence of catalog-size pressure and
  a host API to load pages; no new storage format or migration was added. The
  original hard-cap request stays unfulfilled, rather than claiming a cap exists.
- Fixed a catalog preservation defect found during this trace: nonzero git status
  results from temporary failures no longer clear known snapshots. Failed or empty
  repo identity probes and failed worktree listings keep the previous complete
  snapshot and mark it for retry; only an explicit `not a git repository` result
  clears it. Publish a refreshed snapshot only after its worktree list succeeds.
- Checks: four new failure regressions failed before the fix and passed after;
  all 22 spaces tests pass, including offline/unopened catalog JSON round-trip,
  external storage invalidation and the existing review pacing/race checks.
  `herdr-app check mods/orca-spaces` passes on Herdr 0.1.15.
- No performance speedup claimed for this correctness change. Catalog size before
  and after is unchanged for known repositories; only inactive negative entries
  are removed by the existing pruning policy.

### Phase 2 — retained rows and repeatable probe: complete within stated limits

- Reuse native child `Entity` views for unchanged workspace rows. Native elements
  are never cached or reused across render descriptions. The existing overflow
  list stays immediate, so nested buttons, hover, drag, variable heights and Tab
  traversal keep their original layout and handlers.
- Synchronize child creation/props/release outside render using the owner's
  persistent async context and existing 250 ms task. Events update affected child
  props before notifying the owner. New/changed host snapshots paint directly
  until adopted, avoiding stale rows. Removed rows release their entity handles.
- Keyboard mode deliberately uses the original direct path: retaining rows would
  suppress focus-pool refill for controls beyond the first 64 handles. This
  fallback preserves accessibility and is covered with 80 rows. Initial mounting,
  changed rows and keyboard mode still construct input-sized trees; pure row
  planning/signature arrays remain O(n). This is not full virtualization or a
  proof of the strict input-independent allocation invariant in section 1.
- Independent review caught repeated sibling-catalog serialization in signatures;
  signatures now exclude `g.worktrees` and merged rows' unused git metadata.
  A regression adds 2,000 sibling records without increasing a row's signature.
- Added `scripts/perf-spaces.py`: it exclusively creates a new instrumented mod,
  resolves optional Git revisions to commits, asserts its source transformations,
  and counts explicit constructors in all local helpers. Interval logs include
  deferred child constructors. Native-internal elements/text are not counted.
- Same 200-folder/200-agent fixture, 300 logical px sidebar, 200 ms notifications,
  Apple M1 Max / macOS 27.2 / Herdr 0.1.16 / core 0.1.21. Baseline is `65719ed`.
  Drop two matching warmups, take the next ten matching samples: baseline script
  render median **35 ms** (34–48), final stable render **8 ms** (8–10).
  Explicit factory calls per stable render/interval are **7,604 → 4**. Initial
  retained adoption costs about two full trees; the first interval counted 15,408
  factories, so startup is not claimed faster. These are script and constructor
  measurements, not end-to-end frame latency.
- Fresh-process embedded `gpui-fps` HUD screenshots also show FRAME/P95 readings.
  They are sampled snapshots under synthetic timer-driven rerenders and scrolling,
  not exported per-frame traces or a controlled distribution comparison. The
  root-owned `show_fps_monitor()` path was rejected because Herdr's window root is
  not a ShellRoot. No API for total native-element counts was found. Full native
  count/trace claims remain unproved; zero startup HUD values were not treated as
  zero-cost frames.
- Durable evidence: [samples and source hashes](perf-evidence/2026-11-16/measurements.json),
  [baseline log](perf-evidence/2026-11-16/baseline.log),
  [final log](perf-evidence/2026-11-16/final.log),
  [baseline HUD](perf-evidence/2026-11-16/baseline.png),
  [final HUD](perf-evidence/2026-11-16/final.png).
- Checks: 52/52 Node tests pass; spaces initial check passes on Herdr 0.1.15.
  Fresh-context native review found no remaining correctness blocker after the
  catalog-signature and focus-refill fixes. This is independent context, not a
  claim of reviewer model/provider diversity.

### Phase 3 — final smoke and closeout: in progress

- Final source passed project and local/remote host fold/unfold, same-host reorder,
  cross-host drag rejection, agent expansion/collapse, unread toggling and basic
  keyboard traversal. Tabs select/reorder passed in a layout with Orca's `main`
  stack. The 200-row final fixture scrolled to workspace 199.
- Missing saved folder remained visible with `missing`, using the unchanged 15 s
  production polling interval. Smoke adapters supplied three synthetic agents;
  workspace commands, local and loopback remote hosts were real isolated cores.
- A controllable loopback connection now verifies offline/rebuilt-host behavior;
  final record reconciliation and exact-source closeout review remain.
