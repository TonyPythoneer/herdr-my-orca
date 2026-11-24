# ⌘⇧F 在已有搜尋字時的行為

## (1) 改了哪些檔案、為什麼

- `mods/orca-files/main.js`：刪掉 `command()` 裡 `search` 分支的 `if (this.q.value().trim()) this.rerun(cx);`。原本按 ⌘⇧F 時，只要搜尋框有字就會重跑一次搜尋；現在只做「切到 Contents 視圖、聚焦搜尋框、通知重繪」。搜尋仍只在輸入、切換 Match 開關、編輯 include/exclude 時觸發。註解也補上一句說明「既有查詢不動，只聚焦」。
- `mods/orca-files/tree-keys.test.js`：新增兩個測試，沿用檔案內既有的 `fixture()`（用 vm 載入 main.js）。
  - 搜尋框有字：只記錄到 `focus`，不呼叫 `rerun`。
  - 搜尋框只有空白：只聚焦，不呼叫 `rerun`（行為與原本相同）。

沒有動 `keys.json`、`panel-views.js`、`orca-panel-head` 或任何 layout：它們的行為本來就正確，只是把命令轉交下去。

## (2) 從按鍵到實際行為的路徑（依序）

1. `keys.json:102`（`layout:orca` 區塊，第 73 行起）：`"cmd-shift-f": "orca-panel-head.search"`。
2. `mods/orca-panel-head/main.js` 的 `init()`（第 59 行起）：常駐的 `for (;;)` 迴圈以 `nextCommand()` 取得 `search`，交給 `viewCommands("search")`。
3. `mods/orca-panel-head/panel-views.js` 的 `VIEW_REVEALS.search` 與 `viewCommands()`：回傳三個命令，依序是 `layout.show {id: "panel"}`、`layout.select {stack: "panel-body", child: "files"}`、`orca-files.search`。前兩個讓右面板顯示並切到 Explorer。
4. 同一個 `init()` 迴圈對每個命令呼叫 `run(name, args)`，最後那個 `orca-files.search` 送到 orca-files。
5. `mods/orca-files/main.js` 建構子裡的 `cx.spawn` 迴圈（第 260–263 行）以 `nextCommand()` 取得 `search`，呼叫 `this.command(c, cx)`。
6. `command()`（第 729 行起）的 `search` 分支：設 `this.view = "search"`、`this.q.focus()`、`cx.notify()`。**這是本次改動的地方**：原本在此之前還會 `if (this.q.value().trim()) this.rerun(cx)`，已刪除。
7. `render()` → `renderBody()`（約第 1153、1172 行）：`this.view === "search"` 時顯示 Contents 分段與 `this.q` 的輸入列，並依 `this.hits` 畫結果；`hits` 為 `null` 時結果區是空的。
8. 搜尋本身（未改動）：`rerun(cx)`（第 754 行）→ 200 ms 的 `cx.timer.after` → `search(query)`（約第 780 行，組 `rg` 參數）→ 結果寫入 `this.hits`。現在只有輸入、切換開關、編輯 include/exclude 會走到這裡。

## (3) 跑了哪些檢查與結果

- `node --test mods/orca-files/`：26 個測試全部通過（含兩個新測試）。
- 回歸確認：在一個暫時副本中把舊的那一行放回去，新測試「搜尋框有字…不重新搜尋」失敗（符合預期）；副本已刪除。
- `node --test mods scripts`：435 個測試，419 通過，16 失敗。失敗的全部在 `scripts/perf-spaces-virtual.test.js`（15 個，讀取 orca-spaces 的 perf 夾具）與 `scripts/titlebar-height.test.js`（1 個，`ReferenceError: unified is not defined`，來自讀取 `mods/orca-tabs/main.js` 的表達式）。這些檔案都不讀 `orca-files`，所以與本次改動無關；我沒有在未改動的基準上另外重跑確認。
- `node scripts/sync-shared.mjs --check`：通過（exit 0）。`orca-files/main.js` 沒有 shared 來源，這次改動不會造成漂移。
- 沒有執行 `herdr-app check`、`herdr-app status` 或 `hc`（依規則不執行）。
- 沒有 git commit；沒有碰 `~/.config/herdr-app`。

## (4) 不確定的地方

- **實機行為未驗證**：我只跑了 node 單元測試，沒有在 Herdr 裡按 ⌘⇧F 看焦點是否真的落在搜尋框。`command()` 內的 `q.focus()` 是既有程式，我沒有改它。
- **live 設定未同步**：這次只改了 repo。依照 `.agents/skills/herdr-app-dev-sync/SKILL.md`，若要生效，需要把 `mods/orca-files/main.js` 複製到 `~/.config/herdr-app/mods/orca-files/main.js`（依規則由你決定，我沒有碰）。
- **舊結果可能過期**：原本 ⌘⇧F 會重搜，搜尋結果會跟上磁碟上的改動；現在若搜尋框有字，會顯示上次的結果，直到你再編輯查詢為止。這是需求本身的取捨，但要知道。
- **切換 worktree 後的情況**：`refresh()` 切換 context 時會清掉 `hits`，但不會清搜尋框文字。因此切到另一個 worktree 後按 ⌘⇧F，搜尋框會保留舊字、結果區為空，要再輸入才會搜尋。舊程式在這種情況下會自動重搜，所以這是新的可見差異。我沒有改它，因為需求要求「不要自動重新搜尋」；如果你希望這時仍自動搜，需要另外加條件。
