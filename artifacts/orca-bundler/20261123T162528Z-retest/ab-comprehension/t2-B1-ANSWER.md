# 移除右面板 Ports 按鈕與 ⌘⇧I 快捷鍵

## (1) 改了哪些檔案、為什麼

- `orca-ui/features/panel/head/main.js`：從 `ITEMS`（view switcher 的清單）刪掉 `ports` 那一行，按鈕就不再畫出。這是原始碼，README 規定要改這裡。
- `orca-ui/features/panel/head/panel-views.js`：刪掉 `VIEW_REVEALS` 裡的 `ports` 對應。它只服務快捷鍵，快捷鍵移除後就沒有呼叫者。
- `orca-ui/features/panel/head/panel-views.test.js`：刪掉 `viewCommands("ports")` 的斷言；`bridged.length >= 4` 改成 `>= 3`，因為 layout:orca 現在只剩 files、search、changes 三個橋接鍵。
- `keys.json`：刪掉 `"cmd-shift-i": "orca-panel-head.ports"`。
- `mods/keys.test.js`：原本斷言 `cmd-shift-i` 必須綁到 `orca-panel-head.ports`，改成斷言它未綁定；註解同步更新。
- `orca-ui/app.mjs`：註解裡列舉的 view 去掉 ports。
- `mods/orca-panel-head/main.js`、`mods/orca-panel-head/panel-views.js`：由 `node scripts/build-orca-ui.mjs --out .` 重新產生（交付格式，不手改）。

刻意保留的：
- `layouts/orca.json`、`layouts/orca-unified.json` 裡 `panel-body` 的 `ports` 子頁，右面板內容區的 Ports 頁不動。
- `mods/orca-panel-gap/main.js` 的 Ports 空狀態說明。
- `orca-ui/features/panel/head/panel-gating.test.js` 裡的 `ports` 是通用 `sshOnly` 規則的測試假資料，不是按鈕本身，沒改。

## (2) 按鈕與快捷鍵定義位置

- 按鈕：`orca-ui/features/panel/head/main.js` 的 `ITEMS`（它是 `mods/orca-panel-head/main.js` 的來源）。原本 gating 是 `sshOnly`，所以只有 SSH host 上才看得到。
- 快捷鍵：`keys.json` 的 `layout:orca` 區段，`cmd-shift-i` → `orca-panel-head.ports`。`orca-panel-head` 的 `init` 會接住這個指令，經 `panel-views.js` 的 `VIEW_REVEALS` 轉成 `layout.show` + `layout.select`。
- 內容頁：`layouts/orca.json`、`layouts/orca-unified.json` 的 `panel-body` 子頁 `ports`（保留）。

## (3) 跑了哪些檢查與結果

- `node --test mods scripts orca-ui/features`：修改前 437 pass / 0 fail；修改後 437 pass / 0 fail。
- `node scripts/build-orca-ui.mjs --check --out .`：12 個 managed file 相符（exit 0）。
- `node scripts/sync-shared.mjs --check`：exit 0。
- `keys.json` 可正常解析為 JSON。
- 沒有執行 `herdr-app check`、`herdr-app status` 或 `hc`，也沒有碰 `~/.config/herdr-app`，依規定。沒有 git commit。

## (4) 還不確定的地方

- 沒有在實際 App 裡看過畫面。Ports 按鈕只在 SSH host 上出現，而測試沒有覆蓋 `onSshHost` 為真時的 header 渲染，所以「按鈕確實消失」只由原始碼推得，未經實機驗證。
- `mods/keys.test.js` 的「未綁定」斷言只保證 `cmd-shift-i` 不在 keys.json 裡，沒有驗證 Herdr 執行期對它的實際行為。
- `ports` 的 reveal 機制已移除，如果其他地方（目前搜尋沒找到）以 `orca-panel-head.ports` 呼叫，會變成 no-op。
