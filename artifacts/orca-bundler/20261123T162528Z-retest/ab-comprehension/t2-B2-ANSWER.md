# ANSWER: 移除右面板 Ports 按鈕與 ⌘⇧I 快捷鍵

## (1) 改了哪些檔案、為什麼

- `orca-ui/features/panel/head/main.js`: 從 `ITEMS`（view switcher 的按鈕清單）刪除 `ports` 那一行。這就是標題列按鈕的來源。
- `orca-ui/features/panel/head/panel-views.js`: 刪除 `VIEW_REVEALS.ports`。它只服務 ⌘⇧I 的 `orca-panel-head.ports` 橋接，快捷鍵移除後沒有呼叫者。
- `orca-ui/features/panel/head/panel-views.test.js`: `ports` 改為斷言 `viewCommands("ports")` 為 `null`；「每個 bridged key 都有對應 reveal」的下限從 4 改為 3（剩 files、search、changes 三個）。
- `keys.json`: 刪除 `"cmd-shift-i": "orca-panel-head.ports"`（layout:orca scope）。
- `mods/keys.test.js`: 原本斷言 `cmd-shift-i` 等於 `orca-panel-head.ports`，改為斷言它未綁定。
- `mods/orca-panel-head/main.js`、`mods/orca-panel-head/panel-views.js`: 由 `node scripts/build-orca-ui.mjs --out .` 重新產生（交付格式，不手改）。

刻意保留：`layouts/orca.json` 與 `layouts/orca-unified.json` 中 `panel-body` stack 的 `ports` 子頁，以及 `mods/orca-panel-gap/main.js` 的 Ports 空狀態內容，符合「右面板內容區的 Ports 頁保留」。

## (2) 按鈕與快捷鍵的定義位置

- 按鈕：`orca-ui/features/panel/head/main.js`（`ITEMS`）→ 產生到 `mods/orca-panel-head/main.js`。按鈕由 `ITEMS` 迴圈畫出，icon 為 `plug.svg`。
- 快捷鍵：`keys.json`（`layout:orca`）→ `orca-panel-head.ports` → `orca-ui/features/panel/head/panel-views.js`（`VIEW_REVEALS`）→ `main.js` 的 `init` 迴圈執行 `layout.show` + `layout.select`。
- 同一個 `sshOnly` 閘控規則仍在 `panel-gating.js`，目前沒有任何項目使用它（見 4）。

## (3) 跑了哪些檢查與結果

- 改前基準：`node --test mods scripts orca-ui/features` 為 437 pass / 0 fail。
- 改後：同一指令 437 pass / 0 fail（第一次跑有 1 個失敗，即 `bridged.length >= 4`，已依 (1) 修正）。
- `node scripts/build-orca-ui.mjs --check --out .`：12 個 managed file 相符。
- `node scripts/sync-shared.mjs --check`：exit 0。
- `keys.json` 以 `JSON.parse` 驗證通過。
- 未執行 `herdr-app check` 與 `herdr-app status`（依規定不執行 herdr-app）。
- 未 git commit；未碰 `~/.config/herdr-app`。

## (4) 不確定的地方

- 未在實際 Herdr 中驗證：按鈕是否從標題列消失、⌘⇧I 是否無動作、Ports 頁是否仍能從其他路徑打開。目前只有 node 測試與 build 檢查。
- 若 `panel-body` 的已存 active 子頁是 `ports`，`fallbackChild` 會因 ports 已不在可見清單而切回 `files`，理論上正確，但未實測。
- live 設定 `~/.config/herdr-app` 沒有同步（依規定不能碰）。repo 的 `.agents/skills/herdr-app-dev-sync` 要求 UI 變更同時落到 live config，所以實際執行前需要另外同步 `keys.json` 與 `mods/orca-panel-head/`。
- `sshOnly` 閘控與 `panel-gating.test.js` 的 ports 測資保留（它們是通用的閘控邏輯）。現在沒有項目使用 sshOnly，若要徹底清掉可再刪，這次沒做以免超出範圍。
