# Agent Settings / Start-menu 整合交接

這份文件是給下一個 AI 的實作與驗證交接，不是新的需求文件。先讀本檔，再讀
`README.md`、`AGENTS.md`、`mods/orca-agent-manager/`、`mods/orca-new-menu/` 與
`mods/new-menu/`。

## 0. 目前快照

- 工作目錄：`/Users/tonyyang/git/herdr-my-orca.worktrees/wt-orca-settings`
- 分支：`feature/wt-orca-settings`
- 程式 commit：`5b0fe8f Add agent settings controls and safe CLI install management`
- 前一個相關 commit：`119e0ff Fix agent availability and launch-menu data flow`
- 本交接文件可能另有一個 docs commit；實際 HEAD 以 `git log --oneline -3` 為準。
- 尚未 push，也尚未開 PR；使用者要求 push 前先問。
- `fix-plan.md` 是**舊的** 9 項缺陷清單，那些問題已在 `119e0ff` 修完，不要再照著重做。
- 倉庫內已有一個 tracked 的 `handoff.md`，那是**另一份** prompt-eval 相關交接，和本任務無關；不要覆蓋它。本檔是 `agent-settings-handoff.md`。
- 目前工作樹除了可能未追蹤的 `fix-plan.md` 外，應該沒有未提交變更。

目前實機狀態（Herdr 在這台機器上的 `knownAgents()` 結果；版本不同時數量會變）：

- 已安裝：Claude Code、Codex、Pi、OpenCode（4 個）
- 可安裝：18 個
- FreeBuff：`/opt/homebrew/bin/freebuff`，可在 Orca Start menu 的 `Unofficial` 區塊看到
- Copilot 目前**沒有**安裝；曾有一次舊 inventory 誤顯示為已安裝，按 Refresh 後已修正
- Qoder 的假 stub 已刪除，現在在 Available to install

重要：不要把「目前 4 個」寫死。`knownAgents()` 會隨 Herdr 版本、`programs.json`、PATH 改變；
測試應用 fixture，不要依賴這台機器的數量。

## 1. 需求目標（已實作的部分）

目標是讓 Agent Settings 成為 agent 可用性的唯一來源，Orca 的 Start an agent menu 只讀這份狀態：

1. 區分 **Supported / Installed / Enabled / Launch command**。
2. Start menu 的可見條件：`officiallySupported && installed && enabled`。
3. 不在選單顯示未安裝或已停用的 agent；不要灰掉列出。
4. 已安裝但被停用的 agent 仍留在 Settings 的 Installed 群組。
5. 未安裝的 agent 不能啟用；不可從 enabled 反推 installed。
6. 沒有任何官方可用 agent，且 FreeBuff 也不存在時，選單只顯示一個可操作列：
   **Open Agent Settings**，導向 `main-agents`。
7. FreeBuff 是唯一 unofficial integration：偵測到才在官方清單後加分隔線、`Unofficial`
   標題與 FreeBuff 列；不存在時整個區塊消失。使用現有的 FreeBuff 啟動 / 偵測方式。
8. Settings 使用**單一垂直捲動容器**：Installed 後接 Available to install，約 5.5 列高，
   有半列提示、共用 header/row 高度、即時 count、不要巢狀 scrollbar、不要分頁。
9. 官方 CLI 安裝/解除安裝：
   - 只用已查證的 npm package 或官方文件，不發明命令。
   - 明確的使用者操作、進度/成功/失敗回饋、完成後重新偵測並換群組。
   - 解除安裝要確認、不得刪除無關資料/credentials/session、處理執行中的 session。
   - 用 argv array，不經 shell 字串；allowlist installer；不要偷偷改使用者的 custom command/flags。
10. 深色主題、保留 icon/排序/Customized 標示/switch、可用鍵盤操作。

## 2. 架構與資料流

### 2.1 檔案責任

- `mods/orca-agent-manager/state.js`
  - 純邏輯，沒有 UI / filesystem。
  - agent 預設命令 `BUILTIN_DEFAULTS`、官方首頁 `HOMEPAGES`。
  - `programs.json` 的 `run` 讀寫、CAS 更新、參數無損轉換。
  - `agent-manager.json` parse/serialize。
  - inventory split、fresh install probe script/parse。
  - 固定列高與 viewport 計算（`LIST_ROW_HEIGHT`、`LIST_HEADER_HEIGHT`、
    `LIST_VISIBLE_ROWS`、`listViewportHeight`）。
- `mods/orca-agent-manager/install.js`
  - `NPM_INSTALLS` allowlist：claude、codex、gemini、copilot、opencode、pi、amp。
  - `installMethodFor`、`installCommand`、`uninstallCommand`，只產生 argv。
  - `npmManaged`、`resolveLinkTarget`。
  - `activeSessions`：用 `programs` 的 key 與 argv executable 判斷執行中的 session。
- `mods/orca-agent-manager/main.js`
  - Settings-style 頁面（`main-agents` stack child）。
  - 讀 `programs.json` / `agent-manager.json` / `knownAgents()`。
  - Refresh、poll、editor、install/uninstall、banner、keyboard、shared inventory。
  - `shareInventory()` 會 `setShared("agent-manager.inventory", { at, agents, disabled })`。
- `mods/orca-new-menu/rows.js`
  - `installedEnabledAgents()`（`offeredAgents` 是同義 export）。
  - `freebuffVisible()`、`freebuffRun()`、`emptyAgentState()`、`mergeInventory()`。
- `mods/orca-new-menu/freebuff.js`
  - `FREEBUFF_RUN = ["zsh", "-lic", "exec freebuff"]`。
  - `detectFreebuff()`：本地用登入 shell probe；remote 不回傳本地結果。
- `mods/orca-new-menu/main.js`
  - Orca 的 Start an agent menu。
  - 每次 render/action 透過 `currentState()` 重新讀 shared inventory + disabled list。
  - 只列 installed + enabled 的官方 agent；FreeBuff 條件式列；空狀態列。
  - 啟動前再次檢查目前 state。
- `mods/new-menu/main.js`
  - Herdr 內建選單的同版本邏輯；有 local `officialAgents()` / `currentState()`，
    不 import 跨 mod 檔案。
- `mods/agent-config/main.js`
  - 啟動前會擋掉 `agent-manager.json` 中停用的 agent（本機）。
- `mods/orca-chrome/main.js`、`layouts/orca.json`
  - sidebar 的 Agents 按鈕與 `main/main-agents` entry。

### 2.2 狀態來源

1. `knownAgents()` 提供 Herdr 偵測到的 agent catalog 與 cached installed 狀態。
2. Settings 用 `readRunOverride` 把 `programs.json` 的 `run` merge 上去；這是 launch command
   的真正來源，不另建 agent registry。
3. `agent-manager.json` 只存：
   ```json
   { "version": 1, "disabled": [] }
   ```
   它是 enabled/disabled 的來源；不是 installed 的來源。
4. Settings 計算 `installed = known/probe`、`enabled = installed && !disabled`。
5. Settings 用 `setShared("agent-manager.inventory", ...)` 發佈 `{ at, agents, disabled }`。
6. `orca-new-menu` / `new-menu` 讀 shared inventory；沒有 shared 資料時才退回 `knownAgents()`。
7. remote machine 不繼承本機的 disabled list 或本機 `programs.json` run override。

### 2.3 Install / uninstall

- `NPM_INSTALLS` 的 package 名稱已對 npm registry 查證；沒有查證的 CLI 不應加入。
- `kimi`、`oh-my-pi` 在 npm 是 404（當時查證），所以沒有自動安裝，只能開官方文件。
- `installCommand`：`npm install -g <package>@latest`。
- `uninstallCommand`：`npm uninstall -g <package>`。
- 一律 `exec(npm, args)`，不是 shell string；有 10 分鐘 timeout。
- 安裝流程：
  1. 使用者按 Install。
  2. 找 login shell 的 npm。
  3. 執行 npm。
  4. `recheckAgent()` 重新 probe 有效命令。
  5. 成功/失敗/警告 banner；成功後由 `splitInventory` 移到 Installed。
- 解除安裝流程：
  1. 先檢查 `activeSessions`；有 session 就拒絕。
  2. `commandPath` 找 executable；`npmRoot` 找 global root；`npmManaged` 確認 real target
     在 npm global root 底下。
  3. 不是 npm-managed（例如 Claude 用 Cask、Codex/Pi/OpenCode standalone）就拒絕猜測，
     顯示官方 guide。
  4. 顯示 confirm；再次檢查 session；執行 `npm uninstall -g`。
  5. 重新 probe；若仍偵測到，顯示 warning，不假裝成功。
- 解除安裝只移除 npm package；不改 `programs.json` 的 custom run、不刪 settings/session/
  credentials。

## 3. 已完成的驗證

- `node --test`：**219 passed / 0 failed**。
- `herdr-app check` 通過：
  - `mods/orca-agent-manager`
  - `mods/orca-new-menu`
  - `mods/new-menu`
  - `mods/agent-config`
- `herdr-app status`：`errors []`、`overlays []`、layout `orca`。
- 實機截圖（當時）：
  - `/tmp/manager-now.png`：Settings，Installed 4、Available 18、單一 5.5 列 viewport。
  - `/tmp/orca-menu-4.png`：Orca Start menu，4 個官方 + FreeBuff，無未安裝/停用項目。
  - `/tmp/stock-5.png`：Herdr 內建 menu 的同一策略。
  - 其他舊截圖可能含已修正的假陽性，不要拿來當現況。
- 已驗證 FreeBuff 真實存在時顯示；不存在時的邏輯由 `rows.test.js` 覆蓋。
- 已驗證空狀態的純邏輯（`emptyAgentState`），但**尚未用真實 UI 畫面驗證**（見下一節）。

## 4. 尚未完成 / 下一個 AI 應做的事

以下按優先順序排列。

### P0：實際 install/uninstall 的隔離環境 E2E

目前只驗證了 command 生成、allowlist、npmManaged、session guard 與 UI 狀態；**沒有真的在
使用者機器上執行 npm install/uninstall**。下一個 AI 應在可丟棄的 macOS user/VM 或容器中：

1. 準備乾淨的 npm global prefix 與 PATH。
2. 驗證一個 allowlist package 的 install → re-detect → Settings 換到 Installed → menu 出現。
3. 驗證 uninstall confirm → session guard → npm uninstall → re-detect → 回到 Available。
4. 驗證 custom `run` 在 install/uninstall 後仍完整保留。
5. 驗證非 npm-managed executable（Cask / standalone）只顯示 guide，不執行 uninstall。
6. 驗證 npm 失敗、timeout、install 成功但仍偵測不到 executable 的 banner。

不要在目前這台機器直接跑會改動 `/opt/homebrew` 或使用者 global packages 的命令。

### P1：空狀態與 FreeBuff 的 UI 驗證

用隔離的 `HERDR_APP_HOME`（或可丟棄的 Herdr config）準備：

- 沒有官方 installed + 沒有 FreeBuff → 選單剛好一列 `Open Agent Settings`。
- 沒有官方 installed + FreeBuff 存在 → 只有 Unofficial divider + FreeBuff。
- 只有 disabled official + FreeBuff 不存在 → 空狀態。
- FreeBuff 執行中 / 不存在 / probe 失敗。

確認 `Open Agent Settings` 真的導向 `main/main-agents`。

### P2：inventory 新鮮度策略

目前 shared inventory **沒有 TTL**：Settings 的 snapshot 被視為權威，即使 timestamp 已經幾分鐘。
這是為了避免 Herdr `knownAgents()` 的 1 分鐘 cache 讓已安裝 agent 消失；但外部手動
install/uninstall 後，若 Settings 沒有重新整理，選單可能顯示舊狀態。

需要決定並實作其中一種：

- 在 Settings 增加定期 heartbeat（例如每 60 秒重新 publish；不需要每次重新 probe），或
- 在 menu 開啟時若 inventory 太舊就要求 Settings refresh，或
- 顯示 `Last checked` 並讓使用者知道需要按 Refresh。

不要直接恢復很短的 30 秒 TTL；先前就是因為 TTL 太短而讓 Copilot 從選單消失。

### P3：UI 細節 / 邊界

- 目前 Available 列的 `Install` 按鈕對沒有 npm method 的 CLI（例如 Cursor）也會出現，
  按下去只是展開 editor 顯示官方 guide。語意上可能應改成 `Details` 或依
  `installMethodFor(row.key)` 顯示；這是 UX polish，不是資料流 bug。
- 窄視窗（< 400px）的 row：已把 name 的 min-width 調到 100，但仍需實際窄螢幕截圖確認
  Install/switch/chevron 不互相擠壓。
- `LIST_VISIBLE_ROWS = 5.5` 是固定 viewport；editor 展開時會暫停固定高度。需確認「單一外層
  scroll、不要巢狀 scrollbar」仍成立。
- 確認 keyboard：Space 切換 enabled、Enter 開 editor、方向鍵移動、Escape 收合；
  Install 按鈕的 keyboard 路徑也要實際測。
- `FreeBuff` 固定用 `zsh -lic`；fish 或其他 shell 的 FreeBuff 偵測尚未測。

### P4：清理與交付

- 清理舊 runtime cache：`~/.config/herdr-app/data/orca-agent-manager*/store*.json` 內可能
  還有舊的 Copilot/Qoder `installed:true`；Settings 重新整理後會蓋掉，但下一個 AI 應先確認。
  不要刪除使用者的 `programs.json` / `agent-manager.json`。
- 依 `AGENTS.md` 使用 `writeTextFile` 的 expected-text CAS；malformed `programs.json`
  只能報錯，不能重寫。
- 執行完 `herdr-app check` 後刪除 gitignored 的 `gpui-kit.d.ts` / `jsconfig.json`：
  ```bash
  rm -f mods/*/gpui-kit.d.ts mods/*/jsconfig.json
  ```
- 若要交付：先確認 `git status`、測試、check、截圖，再問使用者是否 push / 開 PR。

## 5. 重要不變量（不要破壞）

1. **`run` 是 argv array**：executable 與每個 argument 分開；空格、引號、反斜線都是字面值。
   不要 shell split，不要 `shell: true`。
2. 寫 `programs.json` 只改該 agent 的 `run`；保留其他欄位、entry、key order。Reset 只移除
   `run`，若 entry 變空才移除 entry。
3. 必須用 `writeTextFile(path, text, expected)` 做 optimistic concurrency；外部修改不能被
   舊草稿無聲覆寫。`programs.json` parse 失敗要報告，不能重寫。
4. `agent-manager.json` 壞掉要 **fail open**（不能因此隱藏所有 agent）；它只存 disabled，
   不要把它當 installed 來源。
5. **不要 uninstall/stop agent** 只因為使用者把它 disable；disable 不是 uninstall。
6. 未安裝不能 enabled；enabled 不能反推 installed。
7. 不要在 mod 之間 import 上一層檔案：Herdr 的 `herdr-app check` 會拒絕
   `../other-mod/...`。共用邏輯請留在同 mod，或在各 mod 內保留小型 local helper。
8. `knownAgents()` 有大約 1 分鐘 cache，且 API 沒有 force 選項；Refresh 的真正新鮮檢查是
   login-shell `command -v` probe。probe 失敗時保留 cached 答案並警告，不要把全部標成未安裝。
9. `knownAgents()` 的 `command -v` 會被 `~/.local/bin` 的假 stub 騙；不要建立永久 stub。
10. mod view 可能重用同一個 instance；Herdr 沒有可靠的 UI test harness，資料流請用
    `node --test` + 手動截圖，不要假設 deep-link 一定能建立新 view。
11. `Link` 從 `gpui-base` import，不是 `gpui-kit`。
12. 文件/commit message 用英文；回報使用者用中文。

## 6. 檔案清單（本任務相關）

```text
mods/orca-agent-manager/main.js
mods/orca-agent-manager/state.js
mods/orca-agent-manager/state.test.js
mods/orca-agent-manager/install.js
mods/orca-agent-manager/install.test.js
mods/orca-agent-manager/mod.json
mods/orca-agent-manager/*.svg

mods/orca-new-menu/main.js
mods/orca-new-menu/rows.js
mods/orca-new-menu/rows.test.js
mods/orca-new-menu/freebuff.js
mods/orca-new-menu/freebuff.png

mods/new-menu/main.js
mods/agent-config/main.js

layouts/orca.json
mods/orca-chrome/main.js + bot.svg
README.md
```

Live config（手動測試時才同步；不要預設覆蓋使用者資料）：

```text
~/.config/herdr-app/mods/orca-agent-manager/
~/.config/herdr-app/mods/orca-new-menu/
~/.config/herdr-app/mods/new-menu/main.js
~/.config/herdr-app/programs.json
~/.config/herdr-app/agent-manager.json
```

## 7. 快速開始

```bash
cd /Users/tonyyang/git/herdr-my-orca.worktrees/wt-orca-settings

node --test

for m in orca-agent-manager orca-new-menu new-menu agent-config; do
  herdr-app check "mods/$m"
done
rm -f mods/*/gpui-kit.d.ts mods/*/jsconfig.json

herdr-app status
herdr-app do layout.select --stack main --child main-agents
```

若要看其中一個選單：

```bash
herdr-app do mod.open --name orca-new-menu
# 或
herdr-app do mod.open --name new-menu
herdr-app shot /tmp/handoff-menu.png
herdr-app do overlay.close
```

## 8. 已知限制

- 沒有原生 Herdr Settings hook；Agent Manager 是 `main` stack 裡的 mod page。
- 沒有跨 mod import；`new-menu` 的 filtering 是刻意的小型 duplicate。
- npm 自動安裝只涵蓋 allowlist；其他 CLI 一律 guide fallback。
- npm 自動解除安裝只處理 npm global root 內的 executable；Cask/standalone 一律不猜。
- `npm install` 使用 `@latest`，因此安裝結果可能隨 upstream 變動；不要把版本寫死成目前已查到的版本。
- 目前實機 Copilot 未安裝；任何顯示 Copilot 已安裝的舊截圖/cache 都應視為 stale。
- FreeBuff 目前是真的存在，但測試 FreeBuff 不存在情境時不要把真實 binary 刪掉；用隔離
  config / PATH stub 測試，測試後移除 stub。
