# ANSWER: ⌘⇧F 在搜尋框已有字時只聚焦

## (1) 改了哪些檔案、為什麼

- `mods/orca-files/main.js`（`command()` 的 `"search"` 分支）：刪除 `if (this.q.value().trim()) this.rerun(cx);`。原本 ⌘⇧F 會在搜尋框有字時重跑一次搜尋；現在只做 `this.view = "search"`、`this.q.focus()`、`cx.notify()`。另補一行註解說明此分支只聚焦。
- `mods/orca-files/tree-keys.test.js`：新增一個回歸測試，確認搜尋框有字時 `search` 命令只聚焦、不呼叫 `rerun`。

沒有動 `keys.json`、`orca-panel-head`、`orca-ui/` 下的檔案。`orca-ui/app.mjs` 只把 `orca-files` 列為「下一步」，不是它管理的輸出，所以不需要重新生成。

## (2) 從按鍵到實際行為的呼叫順序

1. `keys.json`（`layout:orca`）：`"cmd-shift-f": "orca-panel-head.search"`。
2. `mods/orca-panel-head/main.js` 的 `PanelHead.init()` 迴圈：`nextCommand()` 取到 `"search"`，交給 `viewCommands("search")`。
3. `mods/orca-panel-head/panel-views.js`（原始碼在 `orca-ui/features/panel/head/panel-views.js`）`viewCommands`：回傳 `layout.show {id: "panel"}`、`layout.select {stack: "panel-body", child: "files"}`、`{name: "orca-files.search"}`，逐一 `run()`。
4. `mods/orca-files/main.js` 的 `Files` 類別 `init()` 迴圈：`nextCommand()` 取到 `"search"`，呼叫 `command("search", cx)`（約第 728 行）。
5. 同一分支：`this.view = "search"`、`this.q.focus()`，然後 `cx.notify()` 重繪。此時不再呼叫 `rerun`。
6. 重繪時 `queryStrip(t)` 顯示 Contents 那一列（`queryRow(this.q, ...)`），`this.view === "search"` 時結果區才顯示。
7. 搜尋只在 `this.q` 的 `"change"` 事件（約第 247 行）觸發 `rerun()`，經 200 ms debounce 後呼叫 `search()`（`rg`）。所以 ⌘⇧F 不會再觸發搜尋，打字仍會搜尋。

## (3) 跑過的檢查與結果

- `node --check mods/orca-files/main.js`：通過。
- `node --test mods scripts orca-ui/features`：438 個測試全部通過，0 失敗（含新增的 1 個）。
- `node scripts/build-orca-ui.mjs --check --out .`：`12 managed file(s) match`，exit 0。
- `node scripts/sync-shared.mjs --check`：exit 0。
- 新測試在原始程式碼上會失敗：把 `HEAD` 版的 `main.js` 放到暫存副本跑 `tree-keys.test.js`，結果 8 pass、1 fail。暫存副本已刪除。

未在真實 Herdr 介面中按 ⌘⇧F 驗證（規則禁止執行 herdr-app），焦點與畫面都只靠測試和程式碼推斷。

## (4) 不確定的地方

- 搜尋框有字但沒有結果時，新行為不會自動搜尋。例如切換 worktree 時，`refresh()`（約第 305 行）會清掉 `hits` 但保留 `this.q` 的文字。之後按 ⌘⇧F 會只聚焦，搜尋框有字卻沒有結果，要手動改一下字才會重新搜尋。這是需求的字面結果；若希望在這種情況仍自動搜尋，需要另外定義條件（例如 `hits` 為 null 時才搜）。
- 焦點實際是否落在搜尋框，需要在真實 Herdr 裡按一次確認。
- 測試用的 `fixture()` 是替身物件，只驗證分支邏輯，沒有驗證 `InputState` 的真實行為。
