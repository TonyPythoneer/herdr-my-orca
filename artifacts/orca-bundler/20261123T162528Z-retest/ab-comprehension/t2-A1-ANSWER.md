# 移除右面板 Ports 按鈕與 ⌘⇧I 快捷鍵

## (1) 改了哪些檔案、為什麼

- `mods/orca-panel-head/main.js`：刪除 `ITEMS` 裡的 `{ id: "ports", icon: "plug", ... }`。這是右面板標題列 view switcher 的按鈕清單，刪掉這一行即移除按鈕。其他 view 的順序與 gating 不動。
- `keys.json`（`layout:orca` 範圍）：刪除 `"cmd-shift-i": "orca-panel-head.ports"`，移除快捷鍵。
- `mods/orca-panel-head/panel-views.js`：刪除 `VIEW_REVEALS` 裡的 `ports` 對應。它只為快捷鍵服務，快捷鍵移除後沒有其他呼叫者（已用 grep 確認）。
- `mods/orca-panel-head/panel-views.test.js`：`ports` 的斷言改成 `viewCommands("ports") === null`；「每個 bridged key 都有對應 reveal」測試的下限從 `>= 4` 改成 `>= 3`，因為 bridged key 少了一個，原下限會誤報失敗。
- `mods/keys.test.js`：原本斷言 `cmd-shift-i` 指向 `orca-panel-head.ports`，改成斷言它未綁定（`undefined`），並更新註解。

刻意保留、沒有動的部分：
- `layouts/orca.json`、`layouts/orca-unified.json` 裡的 `ports` 區塊（`orca-panel-gap` 的內容頁）。
- `mods/orca-panel-gap/main.js` 的 Ports 內容。
- `mods/orca-panel-head/panel-gating.js` 的 `sshOnly` 規則（通用邏輯，測試用的是自己的 fixture，不依賴真正的 ITEMS）。

## (2) 按鈕與快捷鍵定義在哪裡

- 按鈕：`mods/orca-panel-head/main.js` 的 `ITEMS` 陣列（圖示 `mods/orca-panel-head/plug.svg`）。這個檔案現在沒有任何引用，但我沒有刪除。
- 快捷鍵：`keys.json` 的 `layout:orca` 範圍，`cmd-shift-i` → `orca-panel-head.ports`。它經由 `mods/orca-panel-head/main.js` 的 `init` 橋接，再由 `panel-views.js` 的 `viewCommands` 轉成 `layout.show` + `layout.select` 指令。

## (3) 跑了哪些檢查與結果

- `python3 -c "import json; json.load(open('keys.json'))"`：通過。
- `node --test mods/keys.test.js mods/orca-panel-head/`：13/13 通過。
- `node --test mods scripts`：有失敗，全部在 `scripts/perf-spaces-virtual.test.js`（orca-spaces 虛擬列表）與 `scripts/titlebar-height.test.js`（`unified is not defined`）。這些檔案都沒有引用 `keys.json` 或 `orca-panel-head`。`docs/plan-tab-cwd.md` 第 183 行也記載這兩組是既有失敗。我沒有在改動前的狀態重跑一次做對照，所以這點是依文件推斷，不是我親自比對出來的。
- `node scripts/sync-shared.mjs --check`：exit 0。

沒有執行 `herdr-app` 或 `hc`，沒有碰 `~/.config/herdr-app`，沒有 commit。

## (4) 不確定或沒做的地方

- **live config 尚未同步**。`~/.config/herdr-app` 仍有 Ports 按鈕與 ⌘⇧I。依 repo 的 `herdr-app-dev-sync` 規則，改動需要同時落到 live config。這次依你的指示沒有碰它，需要之後另外同步 `mods/orca-panel-head/` 與 `keys.json`。
- **沒有實機驗證**。沒有渲染標題列，也沒有實際按鍵測試，只跑了單元測試與 JSON 檢查。
- **右面板的 Ports 內容頁目前沒有任何 UI 入口可以選到**，因為按鈕和快捷鍵都移除了。你說要保留內容頁，我照做了，但如果預期它還能從別處打開，需要另外確認。
- 沒有刪除 `sshOnly` gating 規則與 `plug.svg`，因為它們是通用邏輯或未引用資產，刪除不在這次範圍內。
- 風險：這次改動只影響 Ports 的按鈕與快捷鍵，其他 view 的 ITEMS 與快捷鍵沒有被碰到。
