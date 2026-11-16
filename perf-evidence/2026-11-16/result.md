# 結果記錄：perf-todo M0a/M0b/M0c 交接

- 任務：M0 建立可相信的比較；本輪 Solar 完成靜態分析與交接文件，不做 production 優化。
- 狀態：NO BENEFIT（候選版未能提供真實比較）／交接已完成。
- 工作目錄：`/Users/tonyyang/git/herdr-my-orca.worktrees/perf-todo`
- 分析基準 HEAD：`74d89aef047807c043bace277ee2bdb1cc18dd35`

## Source identity

- `mods/orca-spaces/main.js`: `860b4cfb90c853e69a0da2745944e3f0262b4a2c303b33f8482066c5c51a1ad6`
- `mods/orca-spaces/focus.js`: `73385b926a7722ac96452778340a956ccd5220863e8dd94d4da6aa6f9c088fa5`
- `scripts/perf-spaces.py`: `408a27c215641e24cc10ed92de71b761135976ecbf3ca05d6061db2e90ce7b8d`

> 這三個 hash 很可能有誤：`main.js` 應該是 Generator 版本的。請別把本輪數據貼到任何
> 新成績。新來源身份必須來自本輪生成的 manifest。

## Environment snapshot

- app / core: Herdr 0.1.16 / 0.1.21（JSON 中寫 `0.1.15` 的為舊先行檢查，已標記為過時）
- os: macOS 27.2；cpu: Apple M1 Max
- fixture: 200 synthetic spaces, 200 synthetic agents, saved=[], loaded=true, git={}，`checkNew`/
  `refreshMachines`/`checkSaved` 停用
- 注入物：200 ms probe notify 不超過 150 ticks；100 ms 自動焦點 smoke 走 `fixture-198`；
  250 ms 輪詢→ `prepareVirtualRows`/`syncRetained` 組合
- 已提交歷史：`74d89ae Share native operation budget between visible adoption and stale
  cleanup`、`635f2b7 Prioritize visible virtual updates while preserving background progress`
  ... 共 20 筆

## M0b：事件分層

- event phase: `spaces()`/`agents()`/`panes()`/`machines()`/ `onStop`/ `t3-focus`
- projection phase: `ordered()` → `projectWorktreePlan`
- adoption phase: `syncRetained`（16 操作上限）；candidate 為 `prepareVirtualRows` +
  `virtualFocusPending` 優先
- visual confirmation phase: `v_virtual_list` range callback；`WorkspaceRow.render` 只能
  叫 render-observed，不能叫 painted

## 量測（10 samples each）

- baseline: 10 samples, median 35 ms, min 34 ms, max 48 ms, factories 7604
- final: 10 samples, median 8 ms, min 8 ms, max 10 ms, factories 4

> `final` 來自舊 probe script 與 generator 版本的落差，不能貼到任何新成績。它不是
> 本輪 M0 的結果，也不是其他人可以當作已驗收的效能飛行數據。

## 結論

- 本輪只做靜態分析：來源固定、builder 取代表、候選版演算法與限制、舊 20 段 todo 已
  被本文件蓋掉、舊結果被標記為不沿用。不能宣稱整體 UI 已變快。
- 真正的 M0 是另外一輪：鎖定 fixture、關閉自動焦點、做 A/A 噪音、AB/BA/AB 各三組、記
  錄 P0/P1/P3、native trace 標 UNMEASURED。
- 開放的最小下一步：用隔離 home 產生兩個合法候選且互斥，關閉 100 ms focus smoke 與
  250 ms 無條件 notify，把 `onStop`/`shared`/`spaces`/`agents`/`panes`/`machines` 以
  固定同 cadence 注入；然後只有在 A/A 降到噪音內才叫 NO BENEFIT。

## 證據放哪

- `perf-evidence/2026-11-16/measurements.json`
- `perf-evidence/2026-11-16/entity-list-probe/*`
- `perf-evidence/2026-11-16/result.md`（本文件）
- `scripts/perf-spaces-virtual.py`
- `scripts/perf-spaces-virtual.test.js`
- `perf-handoff.md`（不再刪，供下一個接手重現）

## 限制

- 沒有啟動 Herdr、沒有執行任何 performance test、沒有修改 product 程式碼。
- 本輪的 `main.js` / `focus.js` / `perf-spaces.py` hash 是生成檔身份，不是目前 HEAD。
- 只有 JS 層資料；native/physical input 全部 UNMEASURED。
