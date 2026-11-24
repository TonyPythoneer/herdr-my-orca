# ANSWER: ⌘⇧F 在 Contents 已有搜尋字時不自動重搜

## (1) 改了哪些檔案、為什麼

- `mods/orca-files/main.js`（`command()` 的 `search` 分支）：刪掉 `if (this.q.value().trim()) this.rerun(cx);`。
  原本 ⌘⇧F 進來時，只要搜尋框有字就會再跑一次 rg 搜尋；現在只切到 Contents、把焦點放到搜尋框，既有結果保留。註解補了一句說明這個行為。
- `mods/orca-files/tree-keys.test.js`（末尾新增一個測試）：用既有的 `fixture()` 呼叫 `command("search")`，斷言 `view` 變成 `"search"`、`q.focus()` 被呼叫一次、`rerun` 0 次。
  這是單純的刪除，但屬於行為變更，所以補一個回歸測試。

其他檔案未改動。`git commit` 沒有執行。

## (2) 按鍵到實際行為的路徑（依序）

1. `keys.json:102`：`"cmd-shift-f": "orca-panel-head.search"`（`layout:orca` 區段）。
2. `mods/orca-panel-head/main.js` `init()`：常駐迴圈 `nextCommand()` 收到 `search`，交給 `viewCommands()`。
3. `mods/orca-panel-head/panel-views.js` `viewCommands("search")`：回傳三個指令：
   `layout.show {id:"panel"}`、`layout.select {stack:"panel-body", child:"files"}`、`orca-files.search`。`run()` 依序執行。
4. `mods/orca-files/main.js` `init()` 的命令迴圈（約第 259–263 行）：`nextCommand()` 收到 `search`，呼叫 `this.command(c, cx)`。
5. `mods/orca-files/main.js` `command()`（約第 728 行）`c === "search"`：設 `this.view = "search"`、`this.q.focus()`、`cx.notify()`。
   此處原本的 `rerun(cx)`（`rerun` 約第 754 行）就是自動重搜的來源，已刪除。
6. 畫面：`render` 的 Names/Contents 切換與查詢列（約第 1151–1173 行，`queryRow`），結果區讀 `this.hits`（約第 1340–1358 行）。
   `hits` 不在切換時清空，所以有字時顯示的是上次的結果。

使用者在搜尋框打字時仍會觸發 `q.on("change")` → `rerun`（約第 247–249 行），這條路徑沒有改。

## (3) 跑了哪些檢查與結果

- `node --test mods/orca-files/tree-keys.test.js`：9/9 通過（含新測試）。
- 新測試在舊程式碼上會失敗（在 scratchpad 的副本中，把那一行加回去後跑，確認 `reruns` 斷言失敗）。
- `node --test mods scripts`：434 個測試，418 通過，16 失敗。
  同一份 HEAD 基線（scratchpad 副本，只還原 orca-files 的兩個檔案）也是同樣 16 個失敗，所以不是這次改動造成的。
  失敗原因多為 `scripts/perf-spaces*.py` 的探針字串過時（`AssertionError: Probe needs updating`）以及相關的 virtual-list/titlebar 測試。
- `node scripts/sync-shared.mjs --check`：exit 0。
- 未執行：`herdr-app check`（依規則不執行 herdr-app），也沒有在實際 app 裡操作驗證。

## (4) 不確定的地方

- 實際 app 行為未驗證。焦點與畫面更新是從程式碼推斷的，沒有在 GPUI 裡實際按 ⌘⇧F 看過。
- **邊緣情況**：切換 worktree 時 `refresh()`（約第 305 行）會清掉 `hits`，但不會清搜尋框文字 `q`。
  所以可能出現「搜尋框有字、結果區是空的」的狀態。舊版 ⌘⇧F 會順便重搜，現在不會。
  這符合「不要自動重新搜尋」的字面要求，但可能需要你決定：是要在 worktree 切換時也清 `q`，還是在 `hits` 為 null 時才重搜。我沒有改。
- **live 設定沒有同步**：`herdr-app-dev-sync` 規範要求每次改 `mods/` 都要同步到 `~/.config/herdr-app/`。
  你要求不碰那個目錄，所以只改了這份副本。live 的 `orca-files/main.js` 仍是舊行為，需要你自己同步。
- 我只改了 `mods/orca-files`，沒有動 `orca-ui/`。`orca-ui/app.mjs` 只是把畫面區域對應到檔案，不含這段行為。
