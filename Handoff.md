# Handoff：Workspace options sort 不會立即生效 / 不會記憶

## 問題描述

使用者在工作區選項彈窗（Workspace options → Sort by）點選排序（例如「Name」），出現以下症狀：

1. 點完後 sidebar **不會立即重排**，看起來「沒反應」。
2. 離開彈窗再次進入，偏好的 sort by **不會被記憶**（radio 沒有標記為已選，或 sidebar 沒有以該排序顯示）。
3. 只有等到下一次無關的 git 刷新或狀態變化，排序才會「遲到」生效。

## 專案架構背景（重要）

- 這不是網頁，也不是 webview。這是 **Herdr 桌面應用**（Rust + GPUI）的使用者設定倉庫（`herdr-my-orca`）。
- `mods/orca-sidebar-top` 負責「Workspace options」彈窗（寫入選項）。
- `mods/orca-sidebar-projects` 負責 sidebar 實際畫面與排序（讀取選項並重排）。
- Herdr mods **之間沒有共享 store**（`setShared` 不會通知其他 mod，跨模組未註冊的指令名會報錯）。兩個 mod 只能透過 `localStorage["workspace.options.v1"]` 傳遞狀態。
- `localStorage` 不是瀏覽器的，而是 Herdr 給 mods 用的跨模組持久化儲存 API。
- 排序規則（`name` / `smart` / `recent` / `repo` / `manual`）來自 Orca（Herdr App 原生桌面 UI）的規則，被移植到 `orca-sidebar-projects`。

## 現有程式碼狀態

### 關鍵檔案

| 檔案 | 職責 |
|------|------|
| `mods/orca-sidebar-top/main.js` | 彈窗 UI、`readOptions()`、`writeOptions()`、選項寫入 `localStorage` |
| `mods/orca-sidebar-projects/storage.js` | `workspaceOptions()`：讀取 `workspace.options.v1`，含雙層記憶體快取 |
| `mods/orca-sidebar-projects/main.js` | `Spaces` 類：`ordered()`、`grouped()`、`retainedRow()`、`rowSignature()`、`render()` |
| `mods/orca-sidebar-projects/worktree-plan.js` | `applyWorkspaceOptions()`、`sortRows()`：實際排序邏輯 |
| `mods/orca-sidebar-top/refresh.test.js` | 彈窗測試（含新增的 `options-changed` 測試） |

### `writeOptions()`（現狀，已修改）

`mods/orca-sidebar-top/main.js`：

```js
function writeOptions(patch) {
  const next = { ...readOptions(), ...patch };
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
  run("orca-sidebar-projects.options-changed");
  return next;
}
```

- `readOptions()` 沒有快取，每次都會從 `localStorage.getItem("workspace.options.v1")` 重新解析。因此**寫入本身應該會被記憶**。
- 新增 `run("orca-sidebar-projects.options-changed")`，試圖通知 `orca-sidebar-projects` 重繪。

### `orca-sidebar-projects` 的命令迴圈（現狀，已存在）

`mods/orca-sidebar-projects/main.js` 約第 232 行：

```js
else if (cmd === "options-changed") this.notify(taskCx);
```

收到 `options-changed` 後會呼叫 `this.notify()`，理應觸發 `render()` → `ordered()` → `applyWorkspaceOptions()` → `sortRows()`。

### `rowSignature()` 的 retained 行快取（現狀，已修改）

`mods/orca-sidebar-projects/main.js` 約第 354 行：

```js
rowSignature({ r, t, mine, groupBy, sortBy }, ...) {
  ...
  return JSON.stringify([
    r.w, Boolean(r.g), git, r.also?.map(row => row.w), r.head, r.count, r.unopened, r.pos,
    t, mine, groupBy, sortBy, this.reviewOf(r.g), avatarFile(r.g?.owner),
    ...
  ]);
}
```

- `sortBy` 已加入簽名，理應讓排序改變時 `WorkspaceRow` 實體重新 props。
- `retainedRow()` 與 `grouped()` 中的 `draw()` 已經傳遞 `sortBy` 進入 `rowSignature()`。

## 已做的修改（三個檔案）

1. **`mods/orca-sidebar-top/main.js`**：`writeOptions()` 結尾加入 `run("orca-sidebar-projects.options-changed")`。
2. **`mods/orca-sidebar-projects/main.js`**：
   - `rowSignature()` 新增 `sortBy` 參數並放入 JSON 簽名。
   - `retainedRow()` 新增 `sortBy` 參數並放入 `data`。
   - `grouped()` 中的 `draw()` 讀取 `workspaceOptions().sortBy` 並傳入 `retainedRow()`。
3. **`mods/orca-sidebar-top/refresh.test.js`**：新增測試「changing workspace options pings orca-sidebar-projects so the sidebar re-sorts」。

測試結果：69 個測試通過，唯一失敗的是事前就存在的黃金快照摘要（與主題調色板有關，與本次修改無關）。

## 為什麼手動測試「還是沒效果」的可能原因

以下是尚未確認、需要下一位 AI 調查的方向：

### A. 原始碼修改未生效於執行中的 Herdr 應用
這是 mods 原始碼，需要透過 `herdr-app` 重新載入該 mod，或重新啟動 Herdr 應用，修改才會生效。使用者手動測試時可能還在跑舊版編譯後的 mod。

**驗證方式**：確認 Herdr 是否有熱重載 mod 的機制，或是否需要 `herdr-app check` / 重新啟動。

### B. `run("orca-sidebar-projects.options-changed")` 是否能正確送達
`gpui-kit.d.ts` 記載：`run(command, args)` 會將 `<mod>.<command>` 送達該 mod 的 `nextCommand()`。但 `orca-sidebar-projects` 的 `mod.json` 沒有註冊 `options-changed` 作為獨立指令（它只是 `nextCommand()` 迴圈內手動比對的字串）。

需要確認：
- `run("orca-sidebar-projects.options-changed")` 送出後，是否確實進入 `orca-sidebar-projects` 的 `nextCommand()` 迴圈。
- 若 `run` 需要指令預先註冊，`options-changed` 可能會被拒絕或靜默丟失。

### C. `options-changed` 的 `this.notify(taskCx)` 不足以觸發完整重排
`orca-sidebar-projects` 收到 `options-changed` 後只呼叫 `this.notify(taskCx)`。但 `notify()` 內部：

```js
notify(_cx) {
  this.refreshRetained();
  this.syncRetained(this.ownerCx);
  this.ownerCx.notify();
}
```

`refreshRetained()` 會重新計算 `rowSignature`（現在已包含 `sortBy`），但 `syncRetained()` 有 `MAX_RETAINED_OPERATIONS = 16` 的限制，且只針對 `retainedPending` 內的 key。如果 sidebar 行很多，一次 `notify` 可能只更新部分行，剩下的需等待下一輪。

### D. `storage.js` 的雙層快取可能導致 `orca-sidebar-projects` 讀到舊選項
`workspaceOptions()` 有兩層快取：
1. `stored()` 的 `_storedCache`（keyed by raw string）
2. `workspaceOptions()` 的 `_workspaceOptionsCache`（keyed by saved value）

當 `orca-sidebar-top` 寫入 `localStorage` 後，`orca-sidebar-projects` 下一次呼叫 `workspaceOptions()` 應該會偵測到 raw 字串變更並失效快取。但如果兩個 mod 的 `localStorage` 視圖不同步（例如 Herdr 的 `localStorage` 實作有延遲或隔離），可能會讀到舊值。

### E. `localStorage` 在 Herdr 中的行為
Herdr 的 `localStorage` 是否真的是跨 mod 即時共享？是否有寫入後延遲才可讀取的情形？這需要在實際 Herdr 環境中驗證。

## 下一步建議（給下一位 AI）

1. **先確認修改是否已部署**：檢查執行中的 Herdr 是否載入了修改後的 `main.js`。若無熱重載，需重新啟動 Herdr 或執行 `herdr-app check`。

2. **在 `orca-sidebar-projects` 加除錯日誌**：在 `options-changed` 分支、`notify()`、`rowSignature()`、`sortedRows()` 加入 `console.log`（或 Herdr 相當的輸出），確認：
   - `options-changed` 是否被收到
   - `workspaceOptions().sortBy` 是否為新值
   - `rowSignature()` 是否因 `sortBy` 改變而產生不同簽名
   - `sortRows()` 是否以新的 `sortBy` 重新排序

3. **驗證 `run()` 命令路由**：確認 `run("orca-sidebar-projects.options-changed")` 是否成功送達 `orca-sidebar-projects` 的 `nextCommand()`。若不行，考慮改用其他通知機制（例如直接 `setShared` + 轮询，或檢查 Herdr 是否有跨 mod 事件 API）。

4. **檢查 `syncRetained` 的操作上限**：`MAX_RETAINED_OPERATIONS = 16` 可能導致一次 `notify` 只更新部分行。若排序改變後只有部分行重排，這是原因。

5. **測試「跳開再進去」的記憶**：開啟彈窗後，直接檢查 `localStorage.getItem("workspace.options.v1")` 的內容是否為預期的 `sortBy`。若是，則寫入正常，問題在於 sidebar 讀取或重繪；若不是，則 `writeOptions` 本身沒執行。

6. **考慮更強制的重繪**：若 `options-changed` 通知不足夠，可在 `writeOptions()` 後額外呼叫某種全域刷新，或在 `orca-sidebar-projects` 中針對 `options-changed` 不只 `notify()`，而是直接重建 `this.plan` / `this.rowIndex`。

## 測試指令（在 repo 根目錄）

```bash
# 執行相關測試
node --experimental-loader ./scripts/gpui-stub-loader.mjs --test ./mods/orca-sidebar-top/refresh.test.js
node --experimental-loader ./scripts/gpui-stub-loader.mjs --test ./mods/orca-sidebar-projects/git-refresh.test.js
node --experimental-loader ./scripts/gpui-stub-loader.mjs --test ./mods/orca-sidebar-projects/storage.test.js
node --experimental-loader ./scripts/gpui-stub-loader.mjs --test ./mods/orca-sidebar-projects/retained-row.test.js
```

> 注意：這些是 Node 單元測試（用 `gpui-stub-loader.mjs` stub 掉 `gpui-kit`/`gpui-base`/`herdr`），**不是**在真實 Herdr 應用中測試。真實環境的行為可能不同。

## 預期行為（修復後）

使用者在 Workspace options 選擇「Sort by ▸ Name」後：
1. `writeOptions({ sortBy: "name" })` 寫入 `localStorage["workspace.options.v1"]` → **被記憶**
2. `run("orca-sidebar-projects.options-changed")` 通知 `orca-sidebar-projects`
3. `orca-sidebar-projects` 收到後 `notify()` → `ordered()` → `applyWorkspaceOptions()` → `sortRows()` 以 `name` 重排
4. `rowSignature()` 因 `sortBy` 改變而產生新簽名 → `WorkspaceRow` 實體重新 props → **sidebar 立即重排**
5. 再次開啟彈窗，`readOptions()` 從 `localStorage` 讀回 `sortBy: "name"` → radio 顯示為已選

## 目前未解決的問題清單

- [ ] 確認 `run("orca-sidebar-projects.options-changed")` 確實送達 `orca-sidebar-projects` 的 `nextCommand()`
- [ ] 確認 `notify()` → `syncRetained()` 能更新所有行（不受 `MAX_RETAINED_OPERATIONS` 阻擋）
- [ ] 確認 `localStorage` 在 Herdr 中是跨 mod 即時可讀的
- [ ] 確認修改後的原始碼已部署到執行中的 Herdr 應用