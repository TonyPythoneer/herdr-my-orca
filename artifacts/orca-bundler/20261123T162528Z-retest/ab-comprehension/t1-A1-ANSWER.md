# ANSWER: ⌘⇧F 在搜尋框已有字時不重新搜尋

## (1) 改了哪些檔案、為什麼

- `mods/orca-files/main.js`（主要改動）：`Files.command()` 的 `"search"` 分支原本是
  ```js
  if (c === "search") {
    this.view = "search";
    this.q.focus();
    if (this.q.value().trim()) this.rerun(cx);   // 搜尋框有字就重新搜尋
    cx.notify();
    return;
  }
  ```
  刪掉 `if (this.q.value().trim()) this.rerun(cx);` 這一行，其餘（切到 Contents、聚焦搜尋框、通知重繪）不變。加了一行註解說明原因。
- `mods/orca-files/tree-keys.test.js`：新增一個回歸測試 `⌘⇧F on a query that already has text only focuses it, without searching again`。它用既有的 fixture 直接呼叫 `command("search")`，斷言 view 變成 `search`、`q.focus()` 被呼叫一次、`rerun` 沒被呼叫。

沒有改的：`keys.json`、`mods/orca-panel-head/*`（只做 show/select 和轉送，不需要改）、`rerun()` 本身（輸入框打字、Include/Exclude、三個切換鈕仍照常重新搜尋）。

## (2) 從按鍵到實際行為的路徑（依序）

1. `keys.json`，scope `layout:orca`，`"cmd-shift-f": "orca-panel-head.search"`（第 102 行）。
2. Herdr 把 `orca-panel-head` 的 `search` 命令送進 `mods/orca-panel-head/main.js` 的 `PanelHead.init()` 迴圈（`nextCommand()`）。
3. `mods/orca-panel-head/panel-views.js` 的 `viewCommands("search")` 回傳三條命令：`layout.show {id:"panel"}`、`layout.select {stack:"panel-body", child:"files"}`、`orca-files.search`。`PanelHead.init()` 逐一 `run()`。
4. `orca-files` 的 `Files` 建構子裡的命令迴圈（`mods/orca-files/main.js` 第 261–262 行）收到 `search`，呼叫 `this.command("search", cx)`。
5. `mods/orca-files/main.js` 的 `Files.command()`（第 723 行起，`search` 分支約第 728 行）：設 `view = "search"`、`q.focus()`，然後（已改）直接 `notify`，不再呼叫 `rerun`。
6. 之後的 Contents 結果由既有流程產生，沒有改動：`queryStrip()` / `queryRow()` 畫出搜尋框；使用者打字時 `q` 的 `change` 事件 → `rerun()`（200 ms debounce）→ `search()` → `exec("rg", …)` → `hits` → `searchResults()` 畫出列表。

## (3) 跑了哪些檢查與結果

- `node --test mods/orca-files/tree-keys.test.js`：9/9 通過（含新測試）。
- 新測試對舊程式碼：失敗（`reruns` 為 1），證明測試確實抓到這個行為。
- `node --test mods/orca-files/*.test.js mods/keys.test.js mods/orca-panel-head/*.test.js`：全部通過（含 keys.json 綁定斷言與 panel-views 測試）。
- `node --test mods scripts`（全套）：434 個測試，418 通過，16 失敗。這 16 個失敗在還原我的改動後的基準版本也完全相同（名稱一致）。失敗項目都在 `scripts/perf-spaces-virtual.test.js`（呼叫 Python 腳本）與 `scripts/titlebar-height.test.js`（`unified is not defined`），與 orca-files 無關。
- `node scripts/sync-shared.mjs --check`：通過（exit 0）。
- 沒有執行 `herdr-app check`、`herdr-app status`、`hc`，也沒有實際啟動 Herdr 看畫面（依你的要求）。

## (4) 不確定的地方

- **切換 worktree 後的行為變化。** `refresh()` 切換 context 時會清掉 `hits`，但不清 `q` 的文字。原本在這種狀態下按 ⌘⇧F 會重新搜尋、顯示結果；改完後會只顯示舊的搜尋框文字、結果區是空的，直到使用者編輯查詢才會重新搜尋。這符合「有字就不自動搜尋」的字面要求，但它是一個可見的行為變化，你可能想決定要不要例外處理（例如只在 `hits === null` 時補搜）。我沒有擅自加例外。
- **與 `~/.config/herdr-app` 不同步。** `herdr-app-dev-sync` 規定 mod 的修改要同時落到 repo 和 live config；但你禁止碰 `~/.config/herdr-app`，所以這次只改了這個副本。實際在跑的 Herdr 仍是舊行為，要同步需要另外處理。
- **焦點是否真的落在搜尋框** 只靠程式碼路徑推斷（`q.focus()` 沒有改），沒有在真實 UI 驗證。
- 「搜尋框有字」的判斷用 `q.value().trim()`，和原本一致；純空白的情況與舊行為相同（不搜尋）。
- 沒有 commit（依規則）。
