# ⌘⇧F 在已有搜尋字時不重新搜尋

## (1) 改了哪些檔案、為什麼

- `mods/orca-files/main.js`：`command()` 裡的 `"search"` 分支原本是
  `if (this.q.value().trim()) this.rerun(cx);`，有字就重新跑 `rg`。已刪除這一行，
  其餘（切到 Contents 視圖、`this.q.focus()`、`cx.notify()`）不變。註解補上「既有查詢只取得焦點，不再搜尋」。
- `mods/orca-files/tree-keys.test.js`：新增一個回歸測試，用既有 fixture 驗證：
  搜尋框有字時只呼叫 `focus()`、不呼叫 `rerun`；搜尋框為空時也不呼叫 `rerun`。

沒有改 `keys.json`、`panel-views.js`、`orca-panel-head`，因為它們只負責「顯示 Explorer 並切到 Contents」，與是否重搜無關。
`orca-files/main.js` 不在 `orca-ui/features/` 的 manifest 裡，也沒有 `shared/` 副本，所以不需要 build 或 sync-shared。

## (2) 從按鍵到實際行為（依序）

1. `keys.json:102` — `"cmd-shift-f": "orca-panel-head.search"`。
2. `mods/orca-panel-head/main.js` 的 `PanelHead.init` 迴圈 `nextCommand()` 收到 `search`，呼叫
3. `mods/orca-panel-head/panel-views.js` 的 `viewCommands("search")`（查 `VIEW_REVEALS.search`），回傳三個命令：
   `layout.show {id:"panel"}`、`layout.select {stack:"panel-body", child:"files"}`、`orca-files.search`；`main.js` 依序 `run()` 它們。
4. `mods/orca-files/main.js` 的 `Files` 建構子中的命令迴圈收到 `search`，呼叫 `this.command(c, cx)`。
5. `Files.command()` 的 `"search"` 分支：設 `this.view = "search"`、`this.q.focus()`、`cx.notify()`。
   修改前：若 `this.q` 有字還會呼叫 `this.rerun(cx)`；修改後不再呼叫。
6. 只有以下情況才會搜尋：`this.q` 的 `change` 事件、Contents 的大小寫/整字/regex 切換、include/exclude 編輯，
   都會經由 `rerun(cx)`（200 ms debounce）→ `search(query)` 執行 `rg --vimgrep`。⌘⇧F 不再走這條路。

## (3) 跑了哪些檢查與結果

- `node --test mods/orca-files`：25/25 通過（含新測試）。
- `node --test mods scripts`：434 個測試，418 通過，16 失敗。16 個失敗全部位於 `scripts/perf-spaces-virtual.test.js`
  （15 個）與 `scripts/titlebar-height.test.js`（1 個），都不引用 `orca-files`，與本次改動無關。
  注意：我沒有在改動前的版本上重跑這兩個檔案做對照；開始時 git status 就顯示 `scripts/titlebar-height.test.js`、`scripts/perf-spaces.py` 已有未提交修改，這些失敗很可能源自那些既有狀態。
- `node scripts/sync-shared.mjs --check`：exit 0。
- `mods/orca-panel-head` 的測試（`panel-views.test.js`、`panel-gating.test.js`）包含在全套測試內，皆通過。
- 未執行 `herdr-app check` / `herdr-app status`（依規定不執行 herdr-app）。
- 未做真機 UI 驗證。

## (4) 不確定的地方

- **真實行為未驗證**：只靠單元測試與程式碼路徑推論，沒有在 Herdr 裡實際按 ⌘⇧F 確認焦點與畫面。
- **新測試未證明能抓到舊 bug**：沒有在舊程式碼上確認它會失敗（只做了邏輯推導）。
- **跨 worktree 的邊緣情況**：`refresh()` 切換 worktree 時會把 `this.hits` 設為 `null`，但不清空 `this.q`。
  因此切換後搜尋框仍有舊字，按 ⌘⇧F 現在只會聚焦，結果區是空白（既沒有舊結果，也不會自動搜尋），
  要改字才會搜尋。這符合「不要自動重新搜尋」的字面要求，但使用者可能想要的是另一種行為，需要確認。
- **live 設定未同步**：`herdr-app-dev-sync` skill 要求把改動複製到 `~/.config/herdr-app/mods/orca-files/`。
  依你的指示我沒有碰該目錄，所以目前 live 仍是舊行為。需要的話再由你決定是否同步。
- 沒有 commit。
