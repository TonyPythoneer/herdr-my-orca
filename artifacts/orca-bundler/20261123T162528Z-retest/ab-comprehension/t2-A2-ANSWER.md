# 移除右面板 Ports 按鈕與 ⌘⇧I

## (1) 改了哪些檔案、為什麼

- `mods/orca-panel-head/main.js`：從 `ITEMS` 移除 `ports` 項目。這就是右面板標題列 view switcher 的按鈕（含圖示、tooltip、gating）。
- `mods/orca-panel-head/panel-views.js`：移除 `VIEW_REVEALS.ports`。它只服務 ⌘⇧I 的 reveal 橋接，快捷鍵移除後變成無人呼叫的程式碼。
- `mods/orca-panel-head/panel-views.test.js`：`ports` 從「已知 reveal」改成「未知 view 回傳 null」；「每個 bridged key 都有 reveal」的下限從 `>= 4` 改成 `>= 3`（bridged key 現在是 files、search、changes）。
- `keys.json`：移除 `"cmd-shift-i": "orca-panel-head.ports"`（layout:orca 範圍）。
- `mods/keys.test.js`：原本斷言 `cmd-shift-i` 指向 ports，改成斷言它未綁定；註解同步更新。

刻意沒動：
- `layouts/orca.json`（:264）、`layouts/orca-unified.json`（:280）的 `ports` stack child：這是右面板內容區的 Ports 頁，需求要保留。
- `mods/orca-panel-head/plug.svg`：刪除（按鈕的圖示，移除後沒有引用）。Ports 內容頁的空狀態用的是 `mods/orca-panel-gap/plug.svg`（`mods/orca-panel-gap/main.js:47` 以 `mods/orca-panel-gap/${gap.icon}.svg` 解析），與這個檔案無關，所以保留。
- `mods/orca-panel-head/panel-gating.js` 與其測試：`sshOnly` 是通用 gating 規則，測試用的是自己的 fixture。現在沒有 production 項目使用 `sshOnly`，但規則本身不影響其他 view，所以不刪。

## (2) 按鈕與快捷鍵的定義位置

- 按鈕：`mods/orca-panel-head/main.js` 的 `ITEMS`（原第 52 行），圖示原為 `mods/orca-panel-head/plug.svg`（已刪）。`orca-unified` 與 `orca` 兩個 layout 都用這個 mod，所以兩者都受影響。
- ⌘⇧I 快捷鍵：`keys.json`（原第 104 行）→ `mods/orca-panel-head/panel-views.js`（`VIEW_REVEALS.ports`）→ `mods/orca-panel-head/main.js` 的 `init` 橋接。
- 測試：`mods/keys.test.js`、`mods/orca-panel-head/panel-views.test.js`。
- 右面板內容頁（保留）：`layouts/orca.json:264`、`layouts/orca-unified.json:280`、`mods/orca-panel-gap/main.js`。

## (3) 跑了哪些檢查與結果

- `node --test mods scripts`：433 項，417 通過、16 失敗。改動前的基線也是 417 / 16，失敗清單完全相同（都在 orca-spaces 虛擬列表與 orca-tabs 的 tab padding 測試）。這 16 項與本次改動無關，我沒有查根因。
- `node --test mods/orca-panel-head mods/keys.test.js`：13 項全部通過。
- `node scripts/sync-shared.mjs --check`：通過（exit 0）。
- `keys.json`：JSON 可解析。
- `mods/orca-panel-head/main.js`：以 `node --input-type=module --check` 通過語法檢查。
- 刪除 `plug.svg` 後全套測試結果不變（417 / 16，失敗清單相同）。
- 沒有執行：`herdr-app check`、`herdr-app status`、實際在 Herdr 內目視確認（依規則不執行 herdr-app 與 hc）。

## (4) 不確定的地方

- 還沒有在真實 Herdr 畫面確認 switcher 的排版（少一個按鈕後的間距）與快捷鍵實際失效，只有測試與語法檢查。
- 這份副本的改動沒有同步到 `~/.config/herdr-app`。`herdr-app-dev-sync` 規則要求 repo 與 live config 同步，但你禁止碰 live config，所以 live 版本目前仍會顯示 Ports 按鈕並響應 ⌘⇧I，直到同步為止。
- 16 個既有測試失敗的原因未查。
- 行為副作用：`ports` 已不在 `ITEMS`，`fallbackChild` 會把仍停在 `ports` 的 active child 視為被 gate 掉，panel-head 立刻 `layout.select` 到第一個可見 view。所以 Ports 內容頁仍存在於兩個 layout 中，但 UI 上已無路徑可到達；已存的 layout 狀態若停在 `ports` 會自動跳走。這是符合「內容頁保留」的結果，未另外改程式。
- `sshOnly` gating 現在沒有 production 使用者，保留未刪（見 (1)）。
- 沒有 commit。
