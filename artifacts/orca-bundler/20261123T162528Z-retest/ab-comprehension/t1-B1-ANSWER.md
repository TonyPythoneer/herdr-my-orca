# ANSWER: ⌘⇧F 在搜尋框已有字時只聚焦、不重新搜尋

## (1) 改了哪些檔案、為什麼

只改一個檔案：`mods/orca-files/main.js`，`command()` 裡 `c === "search"` 分支。

- 刪掉 `if (this.q.value().trim()) this.rerun(cx);`。原本搜尋框有字時，⌘⇧F 會再跑一次 `rg`；現在只做 `view = "search"`、`q.focus()`、`notify()`。
- 同一段註解補一句說明「只聚焦，既有查詢保留目前結果」，讓之後的人知道這是刻意的。

沒有動的：`keys.json`、`orca-panel-head`（按鍵橋接與 `viewCommands`）、`rerun()`/`search()` 本身（其他入口如切換 Contents/Names、改 toggle、改 include/exclude、輸入文字仍會搜尋）。

`mods/orca-files` 不在 `orca-ui/app.mjs` 的 `features` 清單，也沒有 manifest，所以依 README 規定直接改 `mods/` 內的檔案，不需要改 `orca-ui/` 來源再 build。

## (2) 從按鍵到實際行為（依序）

1. `keys.json:102` — `"cmd-shift-f": "orca-panel-head.search"`。
2. `mods/orca-panel-head/main.js`（來源 `orca-ui/features/panel/head/main.js:58-65`）— `init()` 裡的 `nextCommand()` 迴圈取得 `search`，呼叫 `viewCommands("search")`，再依序 `run(...)`。
3. `mods/orca-panel-head/panel-views.js`（來源 `orca-ui/features/panel/head/panel-views.js`）— `viewCommands()` 回傳三個命令：`layout.show {id: "panel"}`、`layout.select {stack: "panel-body", child: "files"}`、`orca-files.search`。
4. `mods/orca-files/main.js` — 上述 `run("orca-files.search")` 進到 `Files` 的 `command(c, cx)`（約第 728 行）。這裡是改動的地方：
   - 原本：`view = "search"` → `q.focus()` → 若 `q` 有字則 `rerun(cx)`。
   - 現在：`view = "search"` → `q.focus()` → `notify()`。
5. （改前才會走）`rerun(cx)`（約第 754 行）— 取消舊 timer、`searchGeneration++`、200 ms 後 `cx.spawn` 呼叫 `search(v)`（`rg --vimgrep ...`），結果寫入 `this.hits` 並重繪。現在這條路徑在 ⌘⇧F 上不再經過。

命令只有 `panel-views.js` 這一處呼叫 `orca-files.search`（grep 結果），所以改動只影響 ⌘⇧F 這條入口。

## (3) 跑了哪些檢查與結果

- `node --check mods/orca-files/main.js` — 語法通過。
- `node --test mods scripts orca-ui/features` — 437 tests，437 pass，0 fail。
- `node scripts/sync-shared.mjs --check` — exit 0（shared 副本一致）。
- `node scripts/build-orca-ui.mjs --check --out .` — exit 0，12 個 managed file 一致。
- `git status` — 只有 `mods/orca-files/main.js` 有改動；沒有 commit。

沒有跑：`herdr-app check`、`herdr-app status`（依規定不執行 herdr-app）；沒有在真實 Herdr 視窗裡按 ⌘⇧F 看實際畫面。

沒有新增測試：這次改動是刪除一行，`command()` 依賴 Herdr runtime（`nextCommand`、`cx`、`InputState`），現有 test 框架沒有直接覆蓋 orca-files 的命令分派。

## (4) 不確定的地方

1. **切換 worktree 後的狀況（最重要）。** `refresh()` 在 context 改變（換 worktree）時會清掉 `this.hits`，但不會清 `this.q` 的文字，也不會把 `view` 改回去。若使用者在 Contents 頁、搜尋框有字，然後換 worktree，接著按 ⌘⇧F，現在會看到「搜尋框有字、結果區空白」，要再編輯查詢才會重新搜尋。原本是會自動重搜的。這是「不自動搜尋」的直接後果，我照需求保留了行為，沒有另外處理。如果你要的是「有字但沒有結果時仍補搜一次」，要另外改條件（例如只在 `this.hits == null` 時 rerun），這不在這次需求內。
2. **真實 UI 行為未驗證。** 我只看了程式碼路徑與測試，沒有實際開 Herdr 確認焦點與游標位置。
3. **live 設定尚未同步。** 這次只改 repo 內的 `mods/orca-files/main.js`，`~/.config/herdr-app/mods/orca-files/main.js` 沒有更新（規定不碰），要同步需照 `herdr-app-dev-sync` 的流程做。
