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
- [x] Step 7: re-run all node tests + isolated Herdr smoke (52 tests; section 9).

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
- [x] Run the initial Node suite: 39 tests passed (the final suite has 52; section 9). Initial `herdr-app check` passes
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
- [ ] Satisfy the strict input-independent allocation invariant in every mode.
  Retained child views now reduce stable mouse-mode explicit construction from
  7,604 to 4 factories in the 200-row fixture, with measured script improvement.
  Initial/changed/keyboard rows and data projection remain input-sized. Full
  virtualization still needs a native row-handler lifecycle and compatible
  offscreen keyboard-focus traversal; the current lazy list lacks these. Do not
  remove nested controls, assume fixed heights, or cache consumed native elements.
- [ ] Obtain an exported full frame trace and total native-element counts.
  Native gpui-fps FRAME/P95 readings were observed, but duplicate zero-value
  exports were withdrawn; no reliable paired capture or full trace is accepted.
  No total-element or trace export API was found in
  Herdr 0.1.15/0.1.16. Explicit factory counters include local helpers and deferred
  children, but exclude native internals. No full-count/trace claim is made.
- [x] Re-run end-to-end smoke on the **final** source (section 9): scroll 200 rows; fold and
  unfold projects and local/remote hosts; reorder within a host; check cross-host
  drag; expand agent lists with variable card heights; test a missing saved folder
  and an offline/rebuilt machine. The last tab-selection attempt returned a
  ScreenCaptureKit error, and its minimal test layout lacked Orca's `main` stack.
  Repeat tab selection/reorder in a representative layout rather than treating
  that fixture warning as a product failure or a passing check.
- [x] Re-run all tests, initial mod checks, and an independent review against the
  final exact source. The last review's source identity is stale after fixes.
  Include cache races, more-than-200 behavior, external writes and the interaction
  and measurement gaps; resolve findings before considering the work complete.
  `agent-config` needs its required overlay props for a meaningful runtime check;
  standalone `herdr-app check` failed with null props and does not prove a defect.
- [x] Reconcile this checklist and the original steps without marking a hard cap,
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
  adoption can construct several full trees before stabilizing: the recorded first
  two intervals counted 30,416 and 7,812 factories. Startup is not claimed faster.
  These are script and constructor
  measurements, not end-to-end frame latency.
- CUA displayed nonzero embedded `gpui-fps` FRAME/P95 readings during the
  experiments. Final review found the exported baseline/final PNGs were identical
  zero-value frames, so both files and their paired-snapshot claim were withdrawn.
  No accepted comparative native-frame evidence remains. The root-owned
  `show_fps_monitor()` path was rejected because Herdr's window root is not a
  ShellRoot. No API for total native-element counts or a frame trace export was
  found. No full native-count/trace or application-frame speedup is claimed.
- Durable evidence: [samples and source hashes](perf-evidence/2026-11-16/measurements.json),
  [baseline log](perf-evidence/2026-11-16/baseline.log),
  [final log](perf-evidence/2026-11-16/final.log).
- Checks: 52/52 Node tests pass; spaces initial check passes on Herdr 0.1.15.
  Fresh-context native review found no remaining correctness blocker after the
  catalog-signature and focus-refill fixes. This is independent context, not a
  claim of reviewer model/provider diversity.

### Phase 3 — verification and closeout: complete; three outcomes remain unfulfilled

- Final source passed project and local/remote host fold/unfold, same-host reorder,
  cross-host drag rejection, agent expansion/collapse, unread toggling and basic
  keyboard traversal. Tabs select/reorder passed in a layout with Orca's `main`
  stack. The 200-row final fixture scrolled to workspace 199.
- Missing saved folder remained visible with `missing`, using the unchanged 15 s
  production polling interval. Smoke adapters supplied three synthetic agents;
  workspace commands, local and loopback remote hosts were real isolated cores.
- A controllable real loopback connection was disconnected after its git catalog
  was populated. The sidebar retained the repository and marked the host
  unreachable ([offline](perf-evidence/2026-11-16/offline.png)). Switching the
  relay to a different isolated core reproduced `a different core answers there`;
  the sidebar showed `rebuilt · Connect`
  ([rebuilt](perf-evidence/2026-11-16/rebuilt.png)). A fixture timer invoked the
  unchanged `reconnect(machine, cx)` method used by that button; it re-registered
  the new core, cleared the error and kept the cached project discoverable
  ([reconnected](perf-evidence/2026-11-16/reconnected.png)). This checks the actual
  repair method and cores; the last Connect invocation was not a native click.
  CUA later reported `noWindowsAvailable`, so final host-state inspection used
  Herdr's own frame capture and CLI state, rather than treating cached CUA images
  as current observations.
- Final 52/52 Node tests and all four initial mod checks pass; `git diff --check`
  passes. Probe generation also rejects an existing destination without changing
  its marker file. `agent-config` received static inspection only; a null-props
  standalone check is not meaningful for its required overlay contract.
- All changes and tests remain in the `perf-todo` worktree. No user live Herdr
  config was overwritten. Task-created local/remote terminals were ended, relay
  machines removed, new isolated remote cores stopped, and the task-owned app
  process quit. The pre-existing test core and terminals were preserved.
- Exact-source fresh-context review accepted production commit `168bdd5` and the
  corrected closeout records within the stated limits. It independently verified
  52/52 tests, identical review-store copies, source hashes and sample medians.
  Both evidence findings (duplicate native screenshots and pilot startup counts)
  were corrected before acceptance. No code changed after that review.
- Phase commits: `d237eae` (cache/offline preservation), `168bdd5` (retained rows
  and probe), followed by this verification/evidence closeout commit. Work remains
  explicitly incomplete for the three requirements below; completing the safe
  implementation/review phases does not mark those requirements complete.

### Unfulfilled requirements

The checklist is intentionally not all checked. A hard total git/project bound
cannot preserve an arbitrary number of user projects without a retention/storage
policy; input-independent allocation in every mode remains an open design problem,
not a proven runtime impossibility; and full native counts/traces are not exposed
by the inspected API. The safe completed
changes and measured limits above do not substitute for those three outcomes.


## 10. 暫停與續做入口（2026-11-16）

**狀態：已依使用者要求恢復執行，原始「全部做完」目標尚未完成。**
使用者因 token 不足要求先儲存狀態；本次只保存交接，不繼續實作。
先前「能安全做的都做完」收尾過早，不能據此把其餘工作判定為無法完成。

- 工作目錄：`/Users/tonyyang/git/herdr-my-orca.worktrees/perf-todo`，分支 `perf-todo`。
  本次保存前 HEAD 為 `ab98444`，工作目錄乾淨。
- 已提交：`d237eae` 離線快取修正、`168bdd5` retained rows 與 probe、
  `ab98444` smoke／review／證據校正。驗證與限制詳見第 9 節；程式最後驗證
  為 52/52 Node tests、四個 mod checks 通過，獨立 review 無剩餘程式阻擋問題。
- **下一步優先處理所有模式的配置量上限**：仍可繼續設計、實作，不能直接
  推定必須等待 Herdr 改版。先讀 `mods/orca-spaces/main.js` 的 `render`、
  `retainedRow`、`rowSignature`、`syncRetained` 與 `focus.js`。目前穩定滑鼠模式
  重用 Entity，但初次／變更／鍵盤模式仍直接建立整列，資料投影與簽章仍為 O(n)。
  先定義要約束的是 JS 陣列、元件建立量或總常駐量，再評估把工作移到事件／task、
  分批處理或保留完整焦點順序的設計；保留 nested controls、變動高度與拖曳。
- 既有修正不可退回：不要快取已消耗的 NativeElement；不要在 render 中
  `cx.new`／`set_props`；簽章不能重複序列化整份 `g.worktrees`；鍵盤模式的
  64-handle pool 補充與完整 Tab 順序必須保留。現有 regression 在
  `mods/orca-spaces/retained-row.test.js`。
- 目錄硬上限尚缺保留／清除或儲存政策。`git.cache.v2` 同時支援離線／未開啟
  專案發現，`projects.saved.v1` 為使用者管理清單；不得直接 LRU 刪除專案。
  若考慮 paged catalog，需連同 spaces、nav、agents 的讀取與 migration 設計。
- 完整原生元素數／frame trace 尚未取得。35→8 ms 僅為已保存 log 的穩定
  script render 中位數；7,604→4 是 explicit factories，不是全部原生元素。
  先前兩張基準／最終 HUD 匯出圖相同且為零值，已刪除並撤回比較主張；不得沿用。
- 續做前先檢查 Git 狀態及第 8 節未勾選項；有程式變更後才重跑相關驗證。
  Probe 為 `scripts/perf-spaces.py <全新 mod 目錄> [git-ref]`，只接受不存在的
  目錄。第 8 節有測試命令，第 9 節連結 durable evidence。
- 沒有本次仍在運行的 worker、app 或測試 relay；本次建立的終端與隔離遠端 core
  已結束。既有 test core／終端未動。`/tmp/orca-perf-a002` 等舊 fixture 不保證存在
  或仍可用，必須重新確認；不要覆寫使用者 live Herdr config。

後續仍依原要求：每完成一個階段，更新本檔狀態並各自 commit。

## 11. 恢復執行：焦點掃描（2026-11-16）

- 每次 render 與事件簽章更新各讀取一次目前焦點，傳入各列簽章，避免
  每列重複掃描焦點 handles。保留鍵盤模式直接繪製與 pool 補充行為。
- 新 regression：80 列事件更新的焦點讀取由 80 次降為 1 次，並驗證末列
  簽章包含正確焦點。這是操作次數檢查，沒有宣稱 frame-time 改善。
- 驗證：spaces 28/28 tests、herdr-app check、git diff --check 通過。
- 所有模式配置量上限、目錄容量政策、原生 frame 證據仍未完成；下一步
  繼續研究初次／變更／鍵盤模式的有界建構與完整焦點順序。

### 焦點批次驗收補充

- 新增 render 批次 regression，80 列分別在無焦點與末列有焦點時，
  禁止逐列讀取焦點並核對全部簽章。完整 Node suite 54/54 通過。
- 本次生成的 gpui-kit 宣告仍明確禁止 lazy list renderer 的 handlers／
  retained state；不是可直接替換卡片的方案。繼續研究其他有界配置設計。
- 已向使用者提出目錄政策選項：保留全部並分頁、硬上限後手動移除、
  或允許自動移除非釘選專案。尚未收到政策回覆，不改變持久化格式。

## 12. Lazy list plus child Entity runtime probe (2026-11-16)

- New isolated home: `/tmp/orca-entity-list.vFfb4b`, using the existing test core;
  no terminals created. Executable: `/tmp/orca-perf-a002/PerfHerdr.app/Contents/MacOS/Herdr`.
- A deliberate throw in Row.render still passed `check`: it does not execute
  deferred child renders. Initial checks alone cannot validate this route.
- Mounted a personal `probe` layout in the actual app. The lazy renderer returns
  `div().child(this.row)`; init creates the Entity, and Row.render registers an
  on_click handler. The native frame shows the row text and status errors is empty.
- Durable source and frame: `perf-evidence/2026-11-16/entity-list-probe/`.
  Welcome remains overlaid, but the probe row is visible at the top left.
- Correct the earlier broad conclusion: the ban on handlers inside a lazy renderer
  does not prevent an existing child Entity rendering its own handlers. This is
  a virtualization candidate, not production acceptance. Click delivery, variable
  heights, long-list allocation, offscreen Tab order and drag remain unverified.
- Next: extend to many rows and count child renders, then verify focus traversal
  beyond the viewport before integrating retainedRows and descriptor planning.
- Isolated app process is tracked by exec session 46422; inspect before reusing.

### Long-list follow-up

- `long-list.js` creates 1,000 Entities in init, with alternating 40/80 logical
  pixel heights. Actual runtime entered child renders 0 through 15 only in the
  captured interval; owner-side counters agree. Source, unedited log and native
  frame are saved beside the one-row probe. This bounds visible UI construction
  in this fixture, not total resident Entity count or data arrays.
- Runtime warns that `track_scroll` is ignored on `list`. The request to reveal
  row 999 therefore did not work. Do not claim offscreen focus traversal passed.
  A compatible navigation design is still needed before production integration.
- Initial rendering was deferred while the window was inactive; taking a native
  shot woke layout. Empty earlier timer samples are not zero-cost render samples.
- No production changes in this phase. Existing keyboard fallback is preserved.

### Variable-size virtual list follow-up

- `v_virtual_list` accepts a per-row size array and existing child Entities. The
  1,000-row fixture alternates 40/80 heights and successfully reveals row 999
  using VirtualListScrollHandle. Actual native frame shows rows 987 through 999;
  the saved log confirms those 13 child render calls. Check passes without the
  lazy-list track_scroll warning. Source/log/frame saved as `variable-virtual*`.
- This removes the programmatic-navigation obstacle for the variable-size route.
  Production card sizes must be measured and updated on expansion/resizing; the
  fixture's known heights are not a valid substitute. Focus traversal and nested
  input delivery still need runtime acceptance before switching production.
- Existing init still creates 1,000 entities and sizes; native item_sizes handling
  may copy the full array. No claim of input-independent allocation in all modes.
- Telemetry today.json contains usage/startup aggregates, not frame traces or total
  native element counts. gpui-fps exports HUD controls only in current declarations.
- Next: calibrate heights via child on_size_change and test native focus movement
  beyond visible rows, then integrate only after those interaction gates pass.

### Measured heights and native focus follow-up

- Expanded row 999 from 80 to 160 at runtime through Entity.set_props. Its own
  on_size_change reports 160; a coalescing owner timer updates the virtual size
  array outside render. Actual frame shows the expanded last row. Native focus
  handle 999 reports true after revealing it. Status errors remains empty.
- Native window.focus_prev from 988 reaches 987 after the expansion. This checks
  one native focus step, including a previously rendered row now above the visible
  range; it does not prove traversal to a never-rendered row (986 and earlier).
- Source, exact log and expanded native frame saved as `measured-*`. The expanded
  frame comes from the height/focus version before the extra focus_prev step;
  measured-focus.js and its log additionally cover that step.
- Next: test traversal across never-rendered rows using window.focus_next/prev,
  then implement navigation/prefetch as required. Production controls and drag
  remain unchanged pending these gates. Init/resident arrays still scale with N.

### Never-rendered focus boundary and prefetch

- Native backward traversal from 988 produces 987, then leaves the probe's row
  handles (-1), eventually wrapping to 999. It skips never-rendered 986 entirely.
  `native-traversal.js` and exact final log preserve this failed acceptance case.
- A separate task-driven prefetch prototype requests scroll_to_item(target), waits
  until that child render is observed, then focuses its native handle. It passes
  all nine moves 988 down to 980, including never-rendered rows 986 through 980.
  Source and exact output saved as `prefetch-focus.*`. A frame-capture loop wakes
  the inactive isolated window; these are correctness checks, not frame timings.
- This is a candidate mechanism, not completed Tab support: production must hook
  the boundary while retaining each row's nested control order and reverse order.
  Existing focus.js mode/pool behavior must not be removed without replacement.
- Next integration scope: spaces focus.js boundary notification, retained row
  registration of first/last stop, owner scroll/pending focus lifecycle, measured
  row sizes, and tests for folding/removal while a focus request is pending.
  Keep virtualization off production until real Tab and nested controls pass.

### Scoped action routing for virtual focus

- Current API supports cx.bind_keys with a context predicate and on_action. Bind
  Shift-Tab to probe.previous only under OrcaProbe; dispatch that same action along
  the focused child Entity path. All nine moves 988 through 980 report focused=true.
  This proves the action-to-owner route, not an injected physical key event.
- Listeners/key_context must be on a plain div wrapper: the initial attempt on
  v_virtual_list warned and did not wire them. Corrected wrapper passes check
  without warnings and receives all eight action calls. Saved corrected source
  and runtime excerpt: `entity-list-probe/action-focus.*`.
- Integration should use scoped forward/backward actions, keep native traversal
  within each mounted row, and hand off at row boundaries with reveal-before-focus.
  Multiple controls per row, changing controls, boundary exit to neighboring mods,
  and actual Tab binding precedence remain gates; no production switch yet.

### Multiple controls and removed pending target

- Three native focus handles per Entity: row root and two nested controls. Scoped
  actions use native focus_prev/next within a row and reveal-before-focus across
  rows. Runtime assertions check the expected handle after every move.
- Exact sequence passes backward 988:0 -> 987:2 -> 987:1 -> 987:0 -> 986:2,
  continuing to 985:0, then forward back to 988:0 (19 checked positions).
  `multi-control.js` and its exact log preserve the successful run.
- Separate mutation run removes/releases row 986 while its boundary focus request
  is pending. Cancellation keeps focus on 987:0; subsequent navigation reaches 985
  and reverses through stable row keys without focusing the released Entity.
  All 19 expected-handle assertions pass; `removed-target.*` records the run.
- Both initial checks pass. This is native action dispatch with real focus handles,
  not proof of physical Tab binding priority, actual card stop ordering or drag.
  Production integration must also handle dynamic control removal inside a row.

### Real production-card virtualization candidate

- Added scripts/perf-spaces-virtual.py, reusing the exclusive-create instrumented
  builder and asserting every source substitution. It defers actual rowElements
  until an existing child Entity is requested by native lazy list layout.
- Mounted the generated 200-workspace/200-agent mod in the isolated app. Actual
  project headers/cards/agents render, status errors is empty. First check hit an
  interrupted script budget; immediate repeat passed. Neither run proves keyboard
  acceptance. Durable frame, log and generated source hash are `real-cards*`.
- Captured initial intervals 26 and 244 explicit factories; stable visible-list
  renders add 10 factories. Script samples are 8-14ms in this run, with no paired
  baseline: no speedup claim. Full native counts and frame trace remain absent.
- Candidate uses a fixture-only 600px nested viewport, mouse-only lazy list, and
  64px placeholders until Entity adoption. It is not production-ready and does
  not handle status/host descriptor virtualization. Existing production untouched.
- Next: replace that fixture layout with the measured variable-size virtual route
  and scoped focus handoff, then validate actual card controls, grouping and drag.

### Real-card measured virtual sizes

- Candidate builder now uses v_virtual_list with VirtualListScrollHandle and
  per-row sizes measured by each actual WorkspaceRow.on_size_change. Root size
  updates viewport height; 600px is only the pre-layout estimate, not a fixed
  constraint. Changed measurements notify the owner outside render.
- Mounted actual 200-row card code reports 116px for measured rows 0-13, replacing
  64px estimates. Native frame and status inspected (errors empty). Source hash,
  native frame and labeled log excerpt saved as `real-measured*`.
- One initial check hit interrupted script budget again; repeat passed. This
  repeated initial-check reliability issue remains open; do not hide it behind
  the successful repeat. Script samples in the saved excerpt are 9-15ms; no paired
  speedup claim. Adoption interval counted 1,126 explicit factories.
- Fresh temporary build matches the mounted main.js byte-for-byte. A second build
  rejects the existing destination and preserves its main.js bytes.
- Still a candidate: size-array projection/signatures and Entity population scale
  with N, placeholders can shift on calibration, and actual keyboard/group/drag
  integration remains. Next wire real card stop order and scoped focus handoff.

### Actual card focus integration in candidate

- Candidate now installs scoped forward/backward actions, models existing card
  stop order, and reveals the next row before handing off first/last focus.
  Pending requests hold keyboard mode; missing rows cancel the request. When a
  pool is exhausted, it is replenished outside render and the target is redrawn.
- Real cards exposed calibration drift: after measured sizes change, a one-shot
  scroll can leave the target offscreen. Pending requests now re-request reveal
  until the current signature is painted and its target handle exists.
- First integration also hit a nested operation interrupted error. Candidate
  syncRetained now caps native create/update/release operations at 16 per call,
  marking a snapshot synchronized only after every operation finishes. JS scans,
  signatures and arrays still scale with N; not the strict full allocation bound.
- Clean regenerated final candidate passes check. Native action dispatch produces
  all 18 expected focus positions: card/new/more/fold/head for 198, 197 and 196,
  followed by card/new/more for 195. Exact log sequence was asserted against that
  expected order. Final status errors is empty. Source hash and labeled focus log
  saved as real-focus*. No diagnostic patch remains in the accepted generated mod.
- Still not production acceptance: actual Tab key priority, forward real-card
  traversal, PR/hidden controls, fold/removal during pending focus, host/status
  headers, drag, sidebar-width layout and cross-mod boundary exit remain open.
  The candidate is generated separately; production main.js is unchanged.
