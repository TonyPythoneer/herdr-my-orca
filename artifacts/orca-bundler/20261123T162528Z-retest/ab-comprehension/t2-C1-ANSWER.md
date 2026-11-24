# 移除右面板 Ports 按鈕與 ⌘⇧I 快捷鍵

## (1) 改了哪些檔案、為什麼

- `mods/orca-panel-head/main.js`：從 `ITEMS`（view switcher 的清單）刪掉 `{ id: "ports", ... }`。這是按鈕本身；原本它還標 `sshOnly`，所以只在 SSH host 上出現。
- `keys.json`：刪掉 `layout:orca` 裡的 `"cmd-shift-i": "orca-panel-head.ports"`。這是快捷鍵。
- `mods/orca-panel-head/panel-views.js`：刪掉 `VIEW_REVEALS` 的 `ports` 項目。它只為那個快捷鍵的 bridge 服務，快捷鍵移除後變成死碼。
- `mods/orca-panel-head/plug.svg`：刪除。按鈕的圖示。`orca-panel-gap` 有自己的 `plug.svg`（已確認內容不同，與它無關），所以不影響 Ports 內容頁。
- `mods/orca-panel-head/panel-views.test.js`：移除 `viewCommands("ports")` 的斷言，改成在「未知 view」測試裡斷言它回傳 `null`；「快捷鍵都對應到已知 reveal」的下限從 4 改成 3（現在只剩 files、search、changes）。
- `mods/keys.test.js`：原本斷言 `cmd-shift-i` 等於 `orca-panel-head.ports`，改成斷言它不存在；註解同步更新。
- `orca-ui/app.mjs`：註解裡提到的 "ports" 拿掉（純文字）。

沒動：`layouts/orca.json` 與 `layouts/orca-unified.json` 裡 `panel-body` 的 `ports` child（內容頁 `orca-panel-gap` tab `ports`）、`mods/orca-panel-gap/`、`panel-gating.js` 與它的測試（那裡的 `sshOnly` 規則是通用的，測試用的是自己的 fixture）。

## (2) 按鈕與快捷鍵定義在哪裡

- 按鈕：`mods/orca-panel-head/main.js`（`ITEMS` 陣列），圖示原為 `mods/orca-panel-head/plug.svg`。渲染在 `render()` 的 `tools.map(...)`。
- 快捷鍵：`keys.json` 的 `layout:orca` 區段（`cmd-shift-i`），透過 `mods/orca-panel-head/panel-views.js` 的 `viewCommands` 轉成 `layout.show` + `layout.select`。
- 內容頁（保留）：`layouts/orca.json`、`layouts/orca-unified.json` 的 `panel-body` child `ports`。

## (3) 跑了哪些檢查與結果

- `keys.json` 以 `JSON.parse` 驗證：通過。
- `node --test mods/orca-panel-head/ mods/keys.test.js`：13 項全過。
- `node scripts/sync-shared.mjs --check`：exit 0。
- `node --test mods scripts`：433 項，417 過、16 失敗。16 個失敗全部落在 `scripts/perf-spaces-virtual.test.js` 與 `scripts/titlebar-height.test.js` 這兩個檔（兩檔合跑：17 項、16 失敗、1 過）；`mods/orca-spaces` 測試 49/49 全過。這兩個檔都沒有 import 我改的檔案。`docs/plan-tab-cwd.md` 也記錄 virtual-list 與 titlebar-height 的同類失敗在 `main` 上就存在。我沒有另外在未改動的基準上重跑確認。
- 沒有執行 `herdr-app`、`hc`，沒有碰 `~/.config/herdr-app`，沒有 commit。

## (4) 不確定的地方

- 沒有在實際 app 裡看過畫面。以前 Ports 只在 SSH host 上出現，所以一般本機不會看到這個變化；在 SSH host 上按鈕會消失，其他 view 的排列不應受影響，但這只是從程式推斷。
- `panel-gating.js` 的 `sshOnly` 規則目前在正式清單中已沒有任何項目使用。我保留它（有測試覆蓋，且屬於通用規則）。如果你想順便清掉，要連同 `panel-gating.test.js` 的 ssh 案例一起改。
- 內容頁的 `ports` child 仍保留在兩個 layout 裡，但實際上碰不到了：`orca-panel-head` 的 `fallbackChild` 每次 render 都會把不在清單裡的 active tab 重設成第一個可見 view（Explorer）。如果 layout 存的 active tab 是 `ports`，第一次 render 就會被改回 `files`。這在非 SSH host 上原本就是這樣，不是這次造成的。如果之後要讓內容頁真正可用，需要另外處理。
- `docs/designs/right-sidebar-slide-and-zoom.md` 等設計文件仍寫著 orca-panel-head 的舊 view 清單，我沒有去改文件。`README.md` 沒有提到這個 view，不需要改。
- 這個副本的修改沒有同步到 live 設定（我依規則沒有碰 `~/.config/herdr-app`）。要套用到 live，需要照 `herdr-app-dev-sync` 流程另外處理。
