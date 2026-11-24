# 移除右面板 Ports 按鈕與 ⌘⇧I 快捷鍵

## (1) 改了哪些檔案、為什麼

- `mods/orca-panel-head/main.js`：從 `ITEMS` 移除 `ports` 那一行。這個陣列就是右面板標題列 view switcher 的按鈕來源，移除後按鈕不再畫出。
- `mods/orca-panel-head/plug.svg`（刪除）：只有這個 Ports 按鈕使用。`orca-panel-gap` 有自己的 `plug.svg` 副本，不受影響。
- `keys.json`：移除 `"cmd-shift-i": "orca-panel-head.ports"`（`layout:orca` 範圍）。
- `mods/orca-panel-head/panel-views.js`：移除 `VIEW_REVEALS.ports`。沒有快捷鍵或按鈕會呼叫它，留著只會是死資料。
- `mods/orca-panel-head/panel-views.test.js`：Ports 的斷言改為 `viewCommands("ports") === null`；「bridged keys」的數量下限從 4 改為 3（現在只剩 files、search、changes 三個）。
- `mods/keys.test.js`：刪除 `cmd-shift-i` 的斷言與註解中的 `sidebar.ports.toggle Mod+Shift+I`。
- `orca-ui/app.mjs`：註解中的「ports」字樣刪除，讓描述與實際相符。

沒有動的：`layouts/orca.json` 與 `layouts/orca-unified.json` 裡的 `ports` stack child，以及 `mods/orca-panel-gap/`（右面板內容區的 Ports 頁）。`panel-gating.js` 的 `sshOnly` 通用邏輯也保留，它的測試仍使用自己的 ITEMS。

## (2) 按鈕與快捷鍵的定義位置

- 按鈕：`mods/orca-panel-head/main.js` 第 52 行的 `ITEMS` 陣列（icon `plug`，title `Ports`，`gating: "sshOnly"`）。按鈕由 `render()` 依 `ITEMS` 繪製。
- 快捷鍵：`keys.json` 的 `layout:orca` 範圍，`cmd-shift-i` 對應到 `orca-panel-head.ports`。橋接邏輯在 `mods/orca-panel-head/main.js` 的 `init()` 與 `panel-views.js` 的 `viewCommands()`。

## (3) 跑了哪些檢查與結果

- `node --test mods/orca-panel-head/*.test.js mods/keys.test.js`：13/13 通過。
- `node scripts/sync-shared.mjs --check`：通過（exit 0）。
- `node --test mods scripts`：433 項，417 通過，16 失敗。失敗的全部在 `scripts/perf-spaces-virtual.test.js`（15 個，虛擬列表效能測試）和 `scripts/titlebar-height.test.js`（1 個，`ReferenceError: unified is not defined`）。
  - 已核對無關：`perf-spaces-virtual.test.js` 只讀寫 `mods/orca-spaces/` 與 `scripts/perf-spaces-virtual.py`；`titlebar-height.test.js` 讀 `layouts/orca.json`、`mods/orca-tabs/main.js` 與 `scripts/titlebar-height.py`。兩者都不碰 `keys.json`、`orca-panel-head`、`panel-views` 或 `orca-ui/app.mjs`，本次改動也沒有改到它們讀的檔案。
  - 我沒有在未改動的基線上重跑對照（規定只能在此資料夾內操作，無法另開乾淨副本），所以「既有失敗」的結論是依上述 import 關係推斷。
- 殘留搜尋（`mods layouts shared orca-ui scripts keys.json programs.json settings.json`，不做截斷）：找不到其他 Ports 按鈕或 ⌘⇧I 的消費者。剩下的 `ports` 字樣只有 layout 內的 Ports 內容頁、`orca-panel-gap` 的占位頁，以及 `panel-gating` 的通用測試，都按要求保留。
- 沒有做的：沒有執行 `herdr-app check`、沒有開 app 目視確認（依規定不執行 herdr-app 與 hc）。沒有 commit。沒有碰 `~/.config/herdr-app`。

## (4) 不確定的地方

1. **live 設定尚未同步。** `herdr-app-dev-sync` skill 要求改 mods 時也要同步到 `~/.config/herdr-app/`。依你的規則我沒有碰那裡，所以目前 live app 仍會顯示 Ports 按鈕與 ⌘⇧I，要等你決定同步。
2. **Ports 內容頁實際上會變得無法到達。** 沒有按鈕與快捷鍵後，沒有入口能切到 `ports`。另外，若 layout 的 `panel-body` 目前 active 是 `ports`，`panel-head` 的 `fallbackChild` 會因為 `ports` 已不在 `ITEMS` 中而把它切回 `files`。內容頁本身保留，但事實上不再顯示。如果你要的是「頁面保留、仍可從別處進入」，需要另外決定入口。
3. 沒有在真實 app 中驗證視覺結果（標題列按鈕間距、icon 移除後的排列），只依測試與程式碼推斷。
4. **快捷鍵解除綁定後，Herdr 內建是否有 `cmd-shift-i` 預設值，未驗證。** 移除 `layout:orca` 的覆寫後，若 Herdr 本身對 ⌘⇧I 有預設綁定，就會生效。要確認需要讀 `~/.config/herdr-app` 下的 Herdr 文件，依規定我沒有讀。
