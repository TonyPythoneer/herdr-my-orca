# Orca UI 單一原始碼套件實作計畫

截至 2026-11-24，第一批已在 `2d38b99`、`9b9e22a` 提交。`orca-panel-head` 已遷入 [orca-ui/features/panel/head/](../orca-ui/features/panel/head/)，builder 可生成 12 個檔案，`where-error` 可反查現有 feature 和共用副本。下一步依序做步驟 2a、2b、3a。3a 驗收後執行 B／C 檢查點，再依結果決定是否啟動 3b。

第一條分隔線以前是現行計畫。分隔線起保留歷史。處置依據見 [實作準備度報告](../egm/implementation_readiness_report.md)、[Codex 顧問建議](../egm/codex_advice.md)、[Intermediate Zoom Out](../egm/intermediate_zoom_out_report.md)、[本輪決議](../egm/critic_report.md)、[Codex 第二輪審查](../egm/codex_review_round2.md)、[前輪處置](../egm/stage5-6_resolution.md)、[Zoom Out](../egm/zoom_out_report.md) 與 [Comprehension](../egm/comprehension_report.md)。本輪計畫提交包含 `egm/` 與 [3b 規格筆記](plan-orca-ui-3b-notes.md)。

## 問題

第一次接手的 AI 從 layout 的 `children` 只能找到直接掛載的 mod。跨 mod command、overlay、pane、背景 runner 和 `shared()` 狀態的接收端散在各檔。例如在 `orca` 按 ⌘⇧F 會先經 panel-head 展開右面板並選中 Files，再交給 Files 切換 Contents。搬入來源套件後，同一份 JS 又可能同時出現在來源端與 Herdr 讀取的副本。現有 builder 會直接覆寫較新的副本，`--check` 會漏掉未宣告的檔案，builder 與錯誤反查也各有自己的掃描邏輯。相關入口見 [app.mjs](../orca-ui/app.mjs)、[builder](../scripts/build-orca-ui.mjs)、[where-error](../scripts/where-error.mjs) 與 [panel-views.js](../orca-ui/features/panel/head/panel-views.js)。

## 目標與非目標

- 讓第一次接手的 AI 從 [README](../README.md) 進入 [app.mjs](../orca-ui/app.mjs)，沿畫面、快捷鍵和命令找到唯一的可編輯來源、受影響的 layout 與測試。對有 mod frame 的載入與 render 錯誤，從報錯直接找來源座標。
- 每個交付路徑只有一個所有者和寫入者。先讓 builder 與反查共用磁碟掃描結果，加入遞迴漂移檢查及寫入前的 mtime 預檢，再由 builder 接管共用 JS 副本，最後用實驗決定 feature 是否繼續遷移。
- 遷移保留兩套 layout 的行為。修正標準版 ⌘B、補上 `layout:orca-unified` 快捷鍵或調整 UI 行為都屬於另外的功能變更。24 個 mod 的入口須能查到，是否全部搬家由檢查點決定。
- 本計畫的建置範圍是複製或生成 Herdr 交付檔。使用者的既有設定、runtime 資料、外部 CLI 與安裝流程留在各自的維護入口。

## 名詞表

- Orca 是本 repo 在 Herdr 中維護的介面，由 24 個 mod、兩套 layout、主題與設定組成。`orca` 是標準版，左上有 `brand`。`orca-unified` 把標題列併入側欄，是擁有者的日常版。兩者掛載同一組 mod，節點結構與 props 有差異。見 [orca.json](../layouts/orca.json) 與 [orca-unified.json](../layouts/orca-unified.json)。
- `herdr-app` 是載入 mod 並畫視窗的 app，mod JS 在 QuickJS 執行。`hc` 是終端機與 core 的命令入口。實測程序另有 launchd 啟動的 core 與 `herdr-core connect`，app、connect 與 core 各有自己的執行環境。`herdr-app check <mod>` 載入並嘗試 render，`status` 讀視窗狀態，`shot` 擷取畫面。見 [視窗實測](../artifacts/orca-bundler/20261123T162528Z-retest/window/RESULT.md)。
- frame 是 Herdr 錯誤文字中指向 mod 檔案的座標，包含檔案路徑、行號與選填的 byte 欄。
- feature 是 `orca-ui/features/<區域>/<名稱>/` 下的一組來源，映射到一個 mod 目錄。feature 的 `manifest.json` 逐檔宣告 runtime 產物、測試與 layout slots。slot 是 layout JSON 的節點 ID。共用來源有自己的 manifest，可跨 mod 發出副本。Herdr 的 `mod.json` 是 runtime 檔案，由 builder 原樣複製。
- `herdr` 提供宿主 API，`gpui-kit` 和 `gpui-base` 提供宿主 UI。mod 的相對 JS import 限於自己的資料夾，跨 mod 的執行期狀態走 `shared()`／`setShared()`。Node 測試用 [gpui-stub-loader.mjs](../scripts/gpui-stub-loader.mjs) 代替宿主模組。
- dev-sync 是 [herdr-app-dev-sync/SKILL.md](../.agents/skills/herdr-app-dev-sync/SKILL.md) 的交付流程。repo 先改好，再以每檔一個 `cp` 同步本次涉及的檔案到 live app home `~/.config/herdr-app/`。repo 的刪除與 rename 要列出給擁有者處理。
- Claude Code 的 statusline 回呼 wrapper 由 [claude-statusline.sh](../mods/orca-status/claude-statusline.sh) 接收 JSON、更新快取並轉交原 statusline。`orca-agents` 搜尋 OMP session 時，依序取非空的 `OMP_CODING_AGENT_DIR`、`PI_CODING_AGENT_DIR`、實際子程序的 `$HOME/.omp/agent`。見 [README 的 statusline 說明](../README.md) 與 [orca-agents/main.js](../mods/orca-agents/main.js#L149-L166)。

## 架構與編輯入口

[app.mjs](../orca-ui/app.mjs) 是閱讀地圖，從 2a 起單向 import manifest，並補上面向讀者的畫面分組、說明與 `next`。builder 與 where-error 共用 loader 從磁碟建立的逐檔對應表，建置與定位只依賴磁碟 manifest，反查 CLI 可從 `app.mjs` 補上 `next`。登記與磁碟發現結果由 `node --test` 核對。Node.js 用標準函式庫複製 JS、SVG、PNG、`mod.json` 和腳本，保留檔案模式。Herdr 依 layout 的 `content.mod`、`content.props` 或 command／overlay 選擇入口。下列是地圖須能串起的典型路徑。

| 畫面 | 導覽路徑 |
|---|---|
| 左側欄 | Nav、Spaces、Chrome → Tabs |
| 右面板 | panel-head → panel-body → 目標頁 |
| 中央工作區 | work-body → 終端機、pane header、工作頁 |
| 選單與浮層 | command／overlay／pane → 開啟與關閉端 |

Tasks 開在中央，Chrome 的 runner 位於側欄頁尾。Changes 可開 Diff pane，New Menu 可開 Worktree 對話框。這些入口與畫面節點一起收錄在地圖。見 [orca layout](../layouts/orca.json)、[Changes](../mods/orca-changes/main.js#L492-L504)、[New Menu](../mods/orca-new-menu/main.js#L215-L217) 與 [Chrome runner](../mods/orca-chrome/runner.js)。

| 範圍 | 編輯位置 |
|---|---|
| 已遷移的 feature | `orca-ui/features/` |
| 未遷移的 mod、layout、theme | 各自原目錄 |
| 共用 JS，至步驟 2b 為止 | [shared/](../shared/) |
| 共用 JS，3a 起 | `orca-ui/shared/` |
| 全域設定 | repo 根目錄 |

已受管的產物由 [builder](../scripts/build-orca-ui.mjs) 寫入。3a 以前，共用 JS 副本由 [sync-shared.mjs](../scripts/sync-shared.mjs) 依 `USES` 寫入。測試跟 feature 放在來源旁，使用 runtime 產物的測試須明確載入 `mods/<mod>/`。現有 [mods/keys.test.js](../mods/keys.test.js) 原地保留。

[keys.json](../keys.json)、[settings.json](../settings.json)、[programs.json](../programs.json) 由 builder 排除，遷移及回復都保留已存在的 live 設定。README 有手動首次安裝的複製範例，Agent Manager 在執行期會寫 live `programs.json`。`layout:<name>` 只對同名 layout 生效，`orca` 有 35 項 `layout:orca` 鍵位，`orca-unified` 現有 `global` 57 項與 `terminal` 10 項。repo 自有的 [skillshare mod](../mods/skillshare/) 依相同規則管理，呼叫的本機 CLI 由擁有者管理。`tasks.json` 與 `layouts/.state/` 是 app home 的 runtime 資料。見 [Agent Manager 寫入](../mods/orca-agent-manager/main.js#L859-L870)、[README 安裝](../README.md#setup) 與 [skillshare CLI 呼叫](../mods/skillshare/jobs.js#L43-L48)。

[scripts/titlebar-height.py](../scripts/titlebar-height.py) 調整兩套 layout 的指定節點，基準高度為 32 px，`panel-head` 為 31 px，同時設定 `titlebar` 與 `traffic_lights`。預設寫入此 repo 的 `layouts/<name>.json`。`--root DIR` 改用指定根目錄，`--check` 唯讀比對且有差異時退出 1，`--write-live` 額外選入 live layout 路徑，與 `--check` 併用時也只讀。layout 批次移交時，這支工具改寫來源、保留 `--root`／`--check` 語意並停用 `--write-live`，live 交由 dev-sync。

## 替代方案

| 方案 | 主要收益 | 代價 |
|---|---|---|
| bundler | 壓縮 JS、合併模組 | 反查成本、map 體積 |
| 只做地圖 | 原地編輯、少一層產物 | 來源分散 |
| 延用 sync-shared | 沿用現有複製與測試 | 維護兩支寫入工具 |
| 從 manifest 生成 app.mjs | 自動列出檔案映射 | 額外生成入口 |
| 雜湊記錄（寫入保護） | 可驗證上次寫入的內容 | 因需維護隱藏狀態而拒絕 |
| 安裝器 | 可封裝首次安裝 | 要處理既有設定與刪除 |

Vite+ 的兩個 mod 樣本中，含 map 的發布量約為原始複製的兩倍，每個 mod 仍持有自己的共用 JS。在 herdr-app 0.1.17，外部與 inline source map 探針都只回報產物座標。採原檔複製，讓 stack 行與 byte 欄可直接沿用。見 [評估](plan-orca-bundler-evaluation.md)、[發布量觀察](../artifacts/orca-bundler/20261123T160756Z/observations.md)、[外部 map](../artifacts/orca-bundler/20261123T162528Z-retest/map-ext/RESULT.md) 與 [inline map](../artifacts/orca-bundler/20261123T162528Z-retest/map-inline/RESULT.md)。

只做地圖是 3a 後的對照方案。共用 JS 在兩組都交給 builder，以免兩個寫入工具各自維護所有權、漂移和反查。手寫入口直接 import manifest，可保留跨 command、overlay 與 shared key 的人工導覽，並以測試查出遺漏的登記。現有手動安裝加 dev-sync 已涵蓋交付需求，省去安裝器的設定合併與 live 清理規則。

## 風險與限制

| herdr-app 0.1.17 探針 | 可觀察結果 |
|---|---|
| 模組載入錯誤 | `check` 退出 1、`status` errors、視窗錯誤 |
| render 錯誤 | `check` 退出 1、視窗錯誤卡片、`status` errors 為空 |
| 點擊事件錯誤 | 尚未驗證 |

已測 `check` stack 的行與欄從 1 開始。欄是 UTF-8 byte 座標，例如 `new Error` 指到 `Error`，直接保留回報值。非 Error 的 throw 可能沒有 frame。測過的命令清單沒有合成點擊的命令。Herdr 升版後重跑評估的第 0 節及受影響的載入、render 探針。見 [載入](../artifacts/orca-bundler/20261123T162528Z-retest/load/RESULT.md)、[render](../artifacts/orca-bundler/20261123T162528Z-retest/render/RESULT.md)、[欄位](../artifacts/orca-bundler/20261123T162528Z-retest/column-semantics/RESULT.md) 與 [視窗實測](../artifacts/orca-bundler/20261123T162528Z-retest/window/RESULT.md)。

用獨立 socket 與 `HERDR_APP_HOME` 驗證測試視窗的連線目標。launchd 啟動的 core 仍取登入帳號的 HOME，`check` 啟動的 `exec` 子程序也可能在 `check` 結束後繼續執行。步驟 1 用無憑證的 macOS 測試帳號隔離這些宿主程序。見 [視窗隔離](../artifacts/orca-bundler/20261123T162528Z-retest/window/RESULT.md#isolation-proof) 與 [exec 探針](../artifacts/orca-bundler/20261123T162528Z-retest/exec/RESULT.md)。

mtime 預檢的已知限制與處理方式見 [步驟 2b](#步驟-2b寫入前的-mtime-預檢)。

## 實作預設值

依下列契約實作。偏離預設值時，在提交訊息寫明理由。

- **Loader API**。將兩支腳本的 `manifests()` 走訪集中到 `scripts/orca-ui-manifests.mjs`，匯出 `ROOT`、`ManifestError` 與同步 `loadManifests({ root = ROOT, uses })`。回傳 `{ table, features, shared }`。`features` 是以 repo 相對 manifest 路徑為鍵的 Map，值為解析後的 feature manifest。`shared` 從 3a 起為共用 manifest，之前為 `null`。無效宣告或衝突拋出 `ManifestError(message, path)`，`path` 是涉事 manifest 的 repo 相對路徑。
- **逐檔表**。`table` 為 `Map<repo 相對目的路徑, { kind: "feature" | "shared", id, source, mode, consumers, tests, layoutSlots }>`。`source` 與 `tests` 使用 repo 相對路徑，`mode` 為來源的 `stat.mode & 0o777`，`layoutSlots` 沿用 manifest 的 layout 至 ID 陣列對應。feature 的 `id` 是 feature ID，`consumers` 只含其 mod。共用列的 `id` 是來源 basename，`consumers` 列全部消費 mod，`tests`、`layoutSlots` 取該列目的 mod 的 feature manifest，缺少時分別為 `[]`、`{}`。3a 前的 `uses` 為 `{ [name]: string[] }`，省略時為空物件，用檔名及 mod 名展開舊共用列，來源為 `shared/<name>`，builder 將這些列視為唯讀允許項。3a 移除 `uses`，由共用 manifest 提供共用列。
- **測試根目錄**。builder 的 `--root <dir>` 只供測試，預設 `ROOT`，用來讀取 repo 來源、宣告、layout 與 `keys.json`。`--out <dir>` 指定獨立的目的根。相對的 CLI 目錄參數以當前工作目錄解析。
- **`app.mjs`**。匯出 `features = [{ manifest, area, description, next }]`，每個 `manifest` 用 `import … with { type: "json" }` 取得。首批 `area` 為 `"panel"`，`description` 為文字，`next` 為存在的 repo 相對檔案陣列，無連結時填 `[]`。3a 的共用條目只有一個，用同一格式：`area: "shared"`，`description` 為 `"Shared helpers copied into each mod that imports them; edit orca-ui/shared/<name>, never the copies."`，`next: []`。CLI 對應規則：`kind: "feature"` 的列取 `manifest.feature === row.id` 的條目；`kind: "shared"` 的列一律取唯一 `area: "shared"` 的條目。移除 `id`、`source`、`output`、`layouts`、`shortcuts`，由 manifest 推得，保留 `settings` 與 `build` exports。`scripts/orca-ui-manifests.test.js` 逐一 import 磁碟發現的 JSON，依 import 物件身分核對登記全等且各一次，並驗 `next`；由 `node --test mods scripts orca-ui/features` 執行。
- **where-error**。`locate(text, table)` 回傳 `[{ frame, edit, kind, note }]`，沿輸入順序保留重複 frame，忽略行號 0。`frame` 去掉絕對前綴與 `?v=N`，以 `mods/<mod>/<file>:<line>[:<col>]` 表示，行與 byte 欄保留原值。判斷順序固定：路徑越界一律 `unknown`；其次查表，命中就用來源座標（即使該產物在 repo 輸出樹已不存在）；未命中時，repo 中存在的 mod 一般檔是 `in-place`，缺少對應 `mod.json` 或檔案不存在是 `unknown`。`in-place` 與 `unknown` 的 `edit` 都沿用 repo 相對 frame 座標。
- 每個 frame 在 stdout 印兩行。第一行固定為 `<edit>`（`path:line[:col]`）。第二行是兩個前導空格、`from <frame>; ` 和 `note`，完整格式如下。

  | kind | 第二行 |
  |---|---|
  | feature | `  from <frame>; feature "<id>"; tests <…>; layouts <…>` |
  | shared | `  from <frame>; shared helper, copied into <consumer mods>` |
  | in-place | `  from <frame>; not in app.mjs yet: edit this file in place` |
  | unknown | `  from <frame>; unknown path: no such mod in this repo` |

- 清單用 `, ` 分隔。依宣告順序列出。測試列 repo 相對路徑，slots 用 `<layout>#<id>`，空清單顯示 `-`。shared 列全部消費 mod（含報錯的 mod），只有該目的 mod 有 feature manifest 時才加 `; tests <…>; layouts <…>`。CLI 對 feature 和已登記的 shared 條目讀取 `next`，非空時在第二行加 `; next <…>`，載入失敗時仍照常定位及退出。
- manifest 無效或衝突時，stderr 印 `<path>: <message>`，回 2。輸入讀取失敗時 stderr 印 `cannot read input: <message>`，回 2。無 frame 時 stderr 印 `no mods/<mod>/<file>:<line> frame found in the input`，回 1。有 frame 則回 0，包含 `unknown`。
- **檔案清單**。
  - **2a** 新增 `scripts/orca-ui-manifests.mjs`、`scripts/orca-ui-manifests.test.js`。修改 `scripts/build-orca-ui.mjs`、`scripts/build-orca-ui.test.js`、`scripts/where-error.mjs`、`scripts/where-error.test.js`、`orca-ui/app.mjs`、`orca-ui/features/panel/head/manifest.json`、`README.md`、`.agents/skills/herdr-app-dev-sync/SKILL.md`。
  - **2b** 修改 `scripts/build-orca-ui.mjs`、`scripts/build-orca-ui.test.js`、`README.md`、`.agents/skills/herdr-app-dev-sync/SKILL.md`。
  - **3a** 將步驟 3a 表中的八份 `shared/*.js` 搬入 `orca-ui/shared/`，新增 `orca-ui/shared/manifest.json`，重建表中的 20 份 `mods/` 副本，刪除 `scripts/sync-shared.mjs`。修改 `orca-ui/app.mjs`、`scripts/orca-ui-manifests.mjs`、`scripts/orca-ui-manifests.test.js`、`scripts/build-orca-ui.mjs`、`scripts/where-error.mjs`、`README.md`、`.agents/skills/herdr-app-dev-sync/SKILL.md` 及 3a「受影響的測試」表所列檔案。

## 步驟 1：基準與隔離

- 提交 `9b9e22a` 的隔離 Node 測試共 440 個且全數通過，Node 版本與 PATH 替身的驗證見 [基準輸出](../egm/codex_rewrite_notes.md#基準輸出)。
- 每批記錄自己的父提交 SHA，在隔離環境各跑一次父版與候選版。保留測試名稱、所在的 suite、結果和數量，以名稱逐項比對。搬檔只改路徑，必要的改名逐項登記舊名與新名。新增案例須通過，既有案例掉測、重跑成重複案例、skip 或新增失敗均不通過。基準的 expected-failure 清單為空。
- 所有真視窗測試一律在沒有 agent、GH 等真實憑證、Keychain token 或 session 的 macOS 測試帳號進行。由擁有者建立帳號。帳號尚未就緒時，視窗及需要該隔離環境的 `check` 標「待驗」，用 Node fixtures 驗證可離線重現的行為。
- 跑 Node suite 前建立暫存 `HOME` 和 `HERDR_APP_HOME`，把放有可執行 `herdr-app` 替身的暫存目錄加到 PATH 最前面。替身只接受兩個參數 `do orca-status.refresh`，將呼叫逐行寫入暫存 log 並回 0，其餘呼叫回 1。以 `command -v herdr-app` 確認解析到替身的絕對路徑。真視窗與宿主 `check` 採用測試帳號、獨立 app home、同版本 core 與 fixture，驗證 socket、實際子程序環境及替身歸屬。見 [Node 基準](../egm/codex_rewrite_notes.md#基準輸出)、[statusline 測試](../mods/orca-status/claude-statusline.test.js)、[視窗隔離程序](../artifacts/orca-bundler/20261123T162528Z-retest/window/RESULT.md#isolation-proof) 與 [exec 探針](../artifacts/orca-bundler/20261123T162528Z-retest/exec/RESULT.md)。
- 實際呼叫 Herdr `exec` 的 15 個 mod 為 `agent-config`、`orca-agent-manager`、`orca-agents`、`orca-changes`、`orca-chrome`、`orca-diff`、`orca-files`、`orca-handoff`、`orca-menu`、`orca-new-menu`、`orca-panel-head`、`orca-spaces`、`orca-status`、`orca-worktree`、`skillshare`。入口矩陣逐項列出可能的副作用。Agents、Handoff、Status 涉及 session 或憑證。Chrome 即使任務清單空白仍可能探測 Claude／Codex。Spaces 有 `gh`、`curl`，Changes 有 `gh`，Files 可啟動外部 app。見 [Chrome 的 Tasks runner](../mods/orca-chrome/runner.js)、[Spaces](../mods/orca-spaces/main.js)、[Changes](../mods/orca-changes/main.js) 與 [Files](../mods/orca-files/main.js)。
- `check` 可能在受檢目錄寫入 `gpui-kit.d.ts`、`jsconfig.json`。需要宿主驗收的批次在 builder `--check` 後，對隔離的驗收樹副本執行。保留退出碼與畫面證據，點擊類動作由人在測試視窗手動操作一次。
- **Repo 驗收完成**。當批產物、唯讀檢查及 Node suite 通過對應的驗收表，父版與候選版測試名稱及結果比對完成。宿主項目可以記為「待驗」。
- **Live 交付完成**。依當批更新的 dev-sync 指引逐檔同步，將需刪除或 rename 的路徑交給擁有者。宿主 `herdr-app check` 只在隔離樹執行，不對 live 路徑執行，因為交付終端的環境變數（例如 `OMP_CODING_AGENT_DIR`）可能和 app 不同，`check` 會讓 `orca-agents` 等 mod 的子程序改讀個人 session，且子程序可能在 `check` 結束後才完成。live 核對只做逐檔 `cmp` 與擁有者視窗的 `herdr-app status` 無新錯誤。測試帳號未就緒時，交付狀態記為「live 已同步、宿主 check 待驗」。3a 同一提交把 dev-sync 第 3 點的「對每個改動的 live mod 執行 `check`」改成這條規則，並把 `.agents/skills/herdr-app-dev-sync/SKILL.md` 列入 3a 的檔案清單。

| 步驟 1 案例 | 必驗結果 |
|---|---|
| Node 隔離 | `command -v` 指向暫存替身，statusline 測試的 `do orca-status.refresh` 呼叫記入暫存 log 並回 0；替身收到其他參數時回 1。 |

## 步驟 2a：磁碟 loader、漂移檢查與反查

保留 panel-head 的 12 個輸出。採用[實作預設值](#實作預設值)的 loader、登記格式、反查契約與檔案清單。

1. 遞迴讀取磁碟上的 `orca-ui/features/**/manifest.json`，以 repo 相對路徑排序。Feature manifest 為 `{feature, mod, source, output, files, handwritten?, tests, layoutSlots, keys}`。`feature` 為唯一 ID，`source` 為 manifest 所在的 repo 相對目錄，`mod` 是單一目錄名，`output` 為 `mods/<mod>`。`files` 與 `tests` 是 source 相對路徑，前者逐檔同名輸出，後者列出留在來源的測試及 fixture。`handwritten` 由作者明列 output 相對檔案，省略時用空陣列。移除 `commands`、`shared`。
2. 以正規化的 repo 相對路徑判重。來源檔及測試須為一般檔案，宣告與實際解析的路徑都須在宣告的來源目錄內，來源目錄也須在 repo 內。每個目的檔須在其 `mods/<mod>/` 內。手寫檔、共用副本、Herdr 保留檔（mod 根的 `gpui-kit.d.ts`、`jsconfig.json`）與 feature 產物逐檔互斥，包含 3a 接手後的共用副本。
3. 遞迴核對 feature 來源恰為 `manifest.json`、`files`、`tests` 的聯集，拒絕缺檔、漏列、重複與欄位型別錯誤。遞迴掃描一律忽略 `.DS_Store`。`layoutSlots` 讀取 repo 的 `layouts/<name>.json`，走訪所有物件（含陣列內物件），每個宣告的 ID 須在指定 layout 唯一且該物件的 `content.mod` 相符。`keys` 每項須為 repo `keys.json` 自有的頂層區段。
4. `node scripts/build-orca-ui.mjs --out <dir> [--check] [--root <dir>]` 的旗標各最多一次，`--out` 必填。參數或宣告錯誤列診斷並回 2，漂移或輸出 I/O 失敗列路徑並回 1，成功回 0。按 `--out` 重定位後，整批檢查每個受管目的路徑。用 `lstat` 驗所有已存在的路徑元件（含輸出根及目的檔），遇 symlink（含斷鏈）即整批拒絕，`--force` 也適用。非法目的檔是目錄、symlink 或任何非一般檔案，視為輸出錯誤。
5. `--check` 唯讀，逐檔核對 builder 產物的存在、bytes 與模式，再遞迴掃描有 feature manifest 的目的 mod。掃描允許清單包含 feature 產物、共用副本、`handwritten` 與 Herdr 保留檔。其他 mod 只查 builder 受管檔。空目錄 build 只建立 builder 負責的產物並保留來源模式；build 不刪產物。
6. `node scripts/where-error.mjs '<錯誤文字>'` 或 stdin 接受任意絕對前綴的 `mods/<mod>/<file>`，支援子目錄、選填 `?v=N`、正整數行號與選填的正整數 byte 欄。按[實作預設值](#實作預設值)用同一份 loader 表定位；宿主探針標「待驗」，目前定位證據可重跑 [where-error.test.js](../scripts/where-error.test.js)。見 [宿主探針](../artifacts/orca-bundler/20261123T162528Z-retest/codex-where-error/RESULT.md)。
7. README 的開發入口改為相對連結，說明 skillshare 是 repo 自有 mod、共用副本應改來源且行號相同，以及 bundler 評估的版本與樣本範圍。README、dev-sync 與 `app.mjs` 的 builder 檢查指引採用 `--check --out .`。

新建暫存 repo fixture，依現行 `USES` 放入對應的 `shared/<name>` 來源。builder 測試用 `--root` 指向該 repo，以另一個暫存目錄的實體路徑作 `--out`；反查 CLI 測試把腳本與其相依檔複製到 fixture 的 `scripts/`，讓 `ROOT` 指向 fixture。各失敗案例只變動被測條件。

| 2a 案例 | 必驗結果 |
|---|---|
| 登記與引用 | 核對 JSON import 及條目格式。漏登、重複、多登與失效 `next` 各失敗；缺少 `app.mjs` 時建置和反查仍成功，只省略 `next`。 |
| Loader、來源與宣告 | 驗回傳表的正規化鍵及 metadata。巢狀資產輸出、測試與 fixture 留來源、`.DS_Store` 被忽略；缺檔、漏列、重複、錯型別、來源 symlink 指向同 repo 其他來源目錄、目的越出 mod、非一般來源檔各回 2，loader 拋出含路徑的 `ManifestError`。 |
| Layout 與 key | 巢狀 slot 和 key 通過；錯誤或重複的 ID、`content.mod` 不符、缺 key 各回 2。只在輸出根放正確 layout，repo 的 layout 不符時仍回 2。 |
| 所有權 | 重複 feature ID、經正規化後的重複目的地、產物與各保留類別相撞、`handwritten` 與 `USES` 認領同檔各回 2。 |
| 建置與漂移 | 空輸出精確 12 檔且 bytes／模式同父版；允許的附加檔與 `.DS_Store` 存在仍回 0。巢狀多檔、缺檔、bytes 或模式不同、非法目的檔各回 1 且零寫入；無 feature 的 mod 中無關檔案不影響結果。 |
| 目的 symlink | 在同一輸出根內，把某個待建置 mod 的父目錄做成 symlink，分別驗指向同根內目錄及斷鏈皆回 1，其他產物與連結目標皆無寫入。 |
| CLI 錯誤 | 無效參數或壞 manifest 回 2；輸出 I/O 失敗報路徑並回 1。 |
| 反查 | 用 argv 和 stdin 驗相同的混合輸入。逐字核對四種二行輸出、`next`、子目錄、版本後綴、無欄、行號 0 被跳過及重複 frame 保留；包含未知路徑仍回 0。共用結果有 consumer feature 時附 tests／slots，沒有時省略。另逐字核對無 frame 回 1、宣告衝突與輸入讀取失敗回 2 的 stderr 格式。 |
| 文件與回歸 | README 與 app 範例可執行，`node scripts/build-orca-ui.mjs --check --out .`、`node scripts/sync-shared.mjs --check` 與步驟 1 完整測試通過並附名稱差異。 |

## 步驟 2b：寫入前的 mtime 預檢

檔案範圍見[實作預設值](#實作預設值)。先通過 2a 的宣告與目的路徑檢查，再比較每個目的檔的預期 bytes（3a 起含共用尾行）及 `mode & 0o777`。兩者都相同時直接跳過 mtime 與寫入。只對 bytes 或模式需要更新的現存目的檔查 mtime，目的嚴格晚於來源才視為手改。整批預檢通過後才寫入，缺失的目的檔一律列為待建立。若擋下，將所有被擋的 repo 相對目的路徑逐行印到 stderr，回 1 且整批零寫入。

`--force` 只略過 mtime，其他檢查及相符檔跳過規則照常。與 `--check` 併用回 2。將旗標寫進 USAGE、README 與 dev-sync。

先手改副本再存來源，可能因來源較新而漏擋。只做 `chmod` 也可能漏擋，因為 mtime 維持原值。開始編輯前先跑 `--check` 可找出既有漂移。`git checkout` 可能讓有差異的目的檔因 mtime 較新被擋，核對差異後可用 `--force`。

| 2b 案例 | 必驗結果 |
|---|---|
| 同一輸出樹重建 | 用 fixture 固定 mtime，只改一份來源並令來源和其舊副本的 mtime 相等。第二次 build 成功更新該檔；其餘 bytes／模式相符的資產即使比來源新，mtime 也保持原值。 |
| 整批預檢與補檔 | 同時放入晚於來源的內容差異、只差模式的較新檔及一個缺檔。回 1、stderr 列出兩個被擋路徑，整批零寫入。用 `--force` 更新兩檔並建立缺檔。 |
| `--force` 邊界 | 2a 的同根 symlink 案例加 `--force` 仍回 1；與 `--check` 併用回 2。 |

## 步驟 3a：搬家並切換來源的提交

依[實作預設值](#實作預設值)限定檔案範圍，獨立提交。將 [shared/](../shared/) 八份 JS 的原始 bytes 與 Git 模式搬到 `orca-ui/shared/`，依下表填入 `orca-ui/shared/manifest.json` 並由 `app.mjs` import 登記。manifest 格式為 `{files:[{source,outputs:[…]}]}`，路徑都相對 repo 根。每個來源是 `orca-ui/shared/<name>`，目的為每個消費 mod 下同名檔案。loader 從磁碟讀取此固定位置，沿用 2a 的路徑和所有權規則，另查來源目錄恰為 manifest 與列出的 JS，每個來源只宣告一次，`outputs` 是消費端 `mods/<mod>/<name>` 的非空陣列。共用 manifest 的登記依實作預設值。

| 來源 basename | 消費 mod |
|---|---|
| `clip.js` | `orca-changes`、`orca-files`、`orca-handoff`、`orca-menu` |
| `transcript.js` | `orca-handoff`、`orca-menu` |
| `review-store.js` | `orca-spaces` |
| `codex-provider.js` | `agent-config`、`orca-agent-manager` |
| `agent-flyout.js` | `agent-config`、`orca-new-menu` |
| `list-viewport.js` | `agent-config`、`orca-agent-manager` |
| `tasks.js` | `orca-chrome`、`orca-tasks` |
| `panel-motion.js` | `orca-files`、`orca-changes`、`orca-agents`、`orca-panel-gap`、`skillshare` |

在 builder 新增共用展開，讀取 `orca-ui/shared/manifest.json`，將每份來源展開到所有目的地並保留模式。來源缺結尾 LF 時先補 LF，再附上固定說明行與最後的 LF。`<name>` 含 `.js`。

```text
// Generated from orca-ui/shared/<name> by scripts/build-orca-ui.mjs. Edit that file, not this copy.
```

八份來源原樣搬移，保留 `agent-flyout.js`、`codex-provider.js`、`list-viewport.js`、`tasks.js` 提到 `sync-shared.mjs` 的四處註解。20 個副本只允許最後一行說明文字改成上列格式。其餘 bytes、換行、路徑與 Git 模式逐檔同父提交，12 個既有 feature 產物及其餘 runtime 檔的 Git blob 和模式也同父版。共用 manifest 接手全部 13 個消費 mod 的 20 條路徑，同一提交刪除 `shared/`、`scripts/sync-shared.mjs` 及 loader 的 `USES` 相依。只接管共用 JS 的 mod 逐檔核對 builder 產物，其他檔案維持原地管理；有 feature manifest 的 mod 將共用目的檔納入遞迴允許清單。反查沿用實作預設值的契約。更新 `app.mjs`、README 與 dev-sync 的來源、建置、`--check` 和逐檔交付指引。

### 受影響的測試

以 `rg -n 'sync-shared|shared/' scripts mods orca-ui shared -g '*test*'` 核對。表列需更新的既有測試，包含命中舊共用路徑或 API 的案例與 builder 的產物檢查。`mods/keys.test.js` 命中的 `src/shared/keybindings/` 是上游 Orca 路徑。

| 測試 | 3a 變更 |
|---|---|
| [build-orca-ui.test.js](../scripts/build-orca-ui.test.js) | 沿用空輸出案例名稱，由四檔抽查改為兩個空輸出樹的 32 檔全集與逐檔 bytes／模式比對 |
| [sync-shared.test.mjs](../scripts/sync-shared.test.mjs) | 切換到 loader、manifest 與 builder `--check` |
| [opencode-launch.test.mjs](../scripts/opencode-launch.test.mjs) | `SPECS` 改 import `../orca-ui/shared/agent-flyout.js` |
| [where-error.test.js](../scripts/where-error.test.js) | 更新 shared、同 mod 手寫、feature 與 CLI 斷言 |
| [agent-flyout.test.js](../mods/agent-config/agent-flyout.test.js) | 更新來源註解，繼續測副本 |
| [codex-provider.test.js](../mods/agent-config/codex-provider.test.js) | 更新來源註解，繼續測副本 |

`sync-shared.test.mjs` 保留檔名和兩個案例的涵蓋範圍，以共用 manifest 驗每份副本及唯一目的路徑。`where-error.test.js` 中的 `panel-motion.js?v=1:22:13` 應指到 `orca-ui/shared/panel-motion.js:22:13` 並列全部消費 mod。`orca-panel-gap/main.js:40:37` 仍是同 mod 內已知手寫。遷移 feature 的座標、入口與無 frame 的退出碼維持原驗收語意。步驟 2a 的 fixtures 改用共用 manifest。只測 feature 時用 `{ "files": [] }`，共管案例列出共用來源與目的，繼續測重複認領及共管允許清單。測試名稱如因寫入者或路徑更名而改動，記錄一對一對應。純讀取 runtime 副本的測試照原路徑執行。

### 步驟 3a 驗收測試

依序在 repo 根執行以下指令，套用步驟 1 的 Node 替身。以 3a 的直接父提交作比對，先確認目前的 20 份副本與父提交的 bytes／Git 模式一致，且父提交的每份副本等於父版來源（缺結尾 LF 時先補上）加父版 `sync-shared.mjs` 的說明行。通過才首次建置；若只因 mtime 被擋，按 2b 加 `--force` 重跑一次。以下驗收指令成功時均回 0。

```sh
node scripts/build-orca-ui.mjs --out .
node scripts/build-orca-ui.mjs --check --out .
node --test mods scripts orca-ui/features
orca_staging="$(mktemp -d)"
orca_staging="$(cd "$orca_staging" && pwd -P)"
node scripts/build-orca-ui.mjs --out "$orca_staging"
node scripts/build-orca-ui.mjs --check --out "$orca_staging"
```

| 案例 | 必驗結果 |
|---|---|
| 交接與產物 | 八份來源的 blob／模式同父版，含四處保留註解；首次 build 前逐檔通過父提交副本的舊尾行、bytes／模式核對，共用 manifest 登記相符且接管 13 個 mod 的 20 個唯一目的檔；比對父版 blob 驗複本只改精確尾行（另以無結尾 LF 的 fixture 驗補 LF），Git 模式、12 個 feature 產物與其餘 runtime 檔同父版；舊來源、腳本及 `USES` 相依已移除，入口與交付文件指向新流程 |
| 共用宣告與掃描 | 缺檔、未列來源、重複宣告、空 `outputs` 或與 feature 共用目的地各回 2；有 feature 的 mod 允許共用副本，只接管共用 JS 的 mod 保留原地 `main.js`，受管副本缺失或漂移回 1 |
| 建置與回歸 | repo 和空輸出均可 build、check，空輸出精確 32 檔且與 repo 逐檔等 bytes／模式；共用副本套用 2b 預檢；完整 suite 依步驟 1 比對名稱與結果 |
| 反查 | 共用副本回新來源、原有行／欄及消費端，同 mod 手寫仍回原地座標，feature 與錯誤輸入維持 2a 契約 |

Repo 驗收及 live 交付各依步驟 1 的完成條件。

## 3a 之後、3b 之前：B／C 檢查點

### 固定題目與預期 diff

給模型同一題。

> 將 unified 右面板收窄時的額外滑移從 28px 改為 16px，內容寬度、淡出和 drawer 時序照舊。在標準版 `orca`，⌘⇧F 保持立即展開右面板、選到 Files 並聚焦 Contents，且保留已有查詢與搜尋結果，按下時不重新查詢。原有 `orca-files.search` command 保留原本行為。請修改並測試。

驗收者預先保存以下預期 diff，測試時只給模型上面的題目和 README 入口。

- panel-head 的 `panel-views.js` 將 `search` reveal 的第三個 command 改成 `orca-files.focus-search`，保留前兩步 `layout.show(panel)` → `layout.select(panel-body, files)`。對應的 `panel-views.test.js` 驗完整順序。`keys.json` 和兩套 layout 應相同。
- `orca-ui/shared/panel-motion.js` 的 `panelFrame` 以 16 取代 28，更新相應說明。由 builder 更新五份副本。既有 [panel-motion.test.js](../mods/orca-panel-gap/panel-motion.test.js) 的 `open=350, px=175` fixture 驗位移從 `-161` 到 `-167`、內容寬度仍為 350、cover 仍是 `#17171796`，overlay 和全開時直通。drawer 控制端應相同。
- [orca-files/main.js](../mods/orca-files/main.js#L723-L733) 由同一段既有搜尋命令處理新增的 `focus-search`。兩個命令都切換 `view`、focus、notify，只有既有 `search` 在查詢非空時呼叫 `rerun`。用 GPUI stub 對實際 `command()` 驗 focus、notify、查詢及結果仍在、`focus-search` 不執行 `rerun`、`search` 行為相同。其餘快捷鍵、入口、render snapshot 及無關 runtime 檔維持基準。

### 兩組材料

- B 使用通過驗收的 3a 提交，panel-head 來源、共用 manifest、builder 和反查照常。
- 從同一個 3a 提交派生 C。在暫存副本先 build 確認 12 個 panel-head 產物，保留其 bytes／模式，將它們轉為 `mods/orca-panel-head/` 的手寫來源。兩個 feature 測試搬回該 mod，`panel-views.test.js` 的 `keys.json` 相對路徑改為 `../../keys.json`。移除該 feature 的 manifest、登記和來源目錄，保留 `orca-ui/features/` 作測試入口。在 `app.mjs` 的註解補上等資訊的地圖項，包含原地來源、同一組 layout slots、鍵位、測試及 `next`。C 的 builder 仍使用同一份共用 manifest 管理 20 份副本。
- 固定同一版 README、題目、Node、CLI 替身、工具權限和模型設定。README 統一指向 `app.mjs`，說明 feature 依地圖判讀來源。兩組用同一份 builder fixture 測試。反查對 panel-head 的整合測試按各組所有權驗預期路徑，維持測試名稱與數量。兩組預跑完整 suite 及 `--check`，確認名稱、基準結果相同。C 的 runtime 起始樹與 B 比對 bytes／模式全等。
- 每次從各自的乾淨暫存副本開始，用獨立 context。向模型提供相同起始 README，隱去計畫、審查、舊實驗、另一組和答案。兩組暫存 Git 歷史只留各自的起始快照，C 在還原快照後建立空的 `orca-ui/features/` 給測試指令，關閉會帶到原 repo 或其他組的專案記憶。

### 計分與去留

使用同一個沒有參與計畫、遷移或審查的模型，按 B、C 交錯各跑 3 次。每次保存 diff、測試輸出、工具呼叫紀錄和耗時。「改對」須同時符合預期行為（用 Node fixtures 驗）、完整測試通過及 `--check` 0，且工具紀錄沒有直接手改任何當組受管產物。允許透過 builder 寫入副本。每組報正確次數／3，工具呼叫數取三次的中位數，失敗場次也採計。耗時與直接改產物次數一併記錄供追查。

- B 改對率較高，或改對率相同且 B 的工具數中位數至多為 C 的 80%，啟動 3b 的批次規格，再依批次交付。C 的工具數中位數為 0 時，效率條件視為未達成。
- 其餘結果停止搬家。保留 panel-head、共用 JS builder、`app.mjs` 和 `where-error`。其餘 mod 原地維護，在 `app.mjs` 補齊地圖條目，不啟動 3b 或之後的遷移批次。

第一批 Haiku 對照的 A 組是 main，每格 n=2，合計 12 次全對。A、C 有 16 個既有測試失敗，觀察差異落在雜訊內。B／C 檢查點依本輪新結果判定。見 [第一批 A／B／C](../artifacts/orca-bundler/20261123T162528Z-retest/ab-comprehension/RESULT.md)。

檢查點通過後，依 [3b 規格筆記](plan-orca-ui-3b-notes.md) 撰寫 3b 規格。

## 完成驗收

- 入口矩陣覆蓋 24 個 `mods/*/mod.json`，逐列可追到實際掛載或 command、overlay、pane，附主要動作、關閉方式、驗收證據與隔離狀態。檢查點若選擇停止遷移，原地 mod 也要補齊入口地圖。
- 由第一次接手的 AI 只從 README 出發，定位「調整標準版 Contents 搜尋快捷鍵」與「只調整 unified 左側欄的原生動畫」。前者應連到 `keys.json`、panel-head bridge 及 Files 接收端，後者應連到 Tabs 的 native clock 與 `drawer.js`。有生成對應的路徑可從入口直接找到可編輯來源。
- 以隔離副本重現帶 frame 的載入及 render 錯誤，逐幀連回可編輯檔與原始行、已有的 byte 欄。需宿主測試且帳號尚未就緒的項目標「待驗」。

依下列步驟演練回復。

1. 在暫存 checkout 先回復下游批次，再回復其依賴的批次（如 3b 後 3a）。從回到的提交取完整快照，以該版 builder 和仍存在的 `sync-shared.mjs` 重建其受管檔案。保留同一快照的手寫 runtime 與兩套 layout。
2. 核對回復樹的交付檔路徑、Git blob 與模式符合目標提交，按步驟 1 重跑對應 suite，按入口矩陣核對兩套 layout 的操作或記錄宿主待驗。交付清單須排除使用者的根設定與 runtime 資料。
3. 比對更新前後的逐檔交付清單，將回復後應由擁有者移除的 live 相對路徑逐行寫到暫存驗收根的 `rollback-extra-paths.txt`，即使結果為空也保留檔案。上述比對與測試通過、清單與路徑差集相符即通過演練。Live 回復依 dev-sync 逐檔複製，將清單交給擁有者。

---

## 歷史提案與審查紀錄

以下保留各作者原文。`implementation_readiness_report.md` 引用的計畫行號對應提交 `e66135b` 中的版本。

## Tasks

### 1. 固定相容基準，界定套件負責哪些檔案（gpt-6.2-astra xhigh）

- **a. Actions**　從 Git 版本 `f2736b91efb8b6d374ba8dacb1d5a80b2468d769` 匯出暫存基準，以 Herdr App 0.1.16 記錄現有測試與操作結果。盤點 24 個 mod 的 manifest、layout 掛載點及由指令或 overlay 開啟的入口。（gpt-6.2-astra xhigh）
- 將 `orca-*`、`agent-config`、兩套 Orca layout、主題、圖檔及指令稿納入清單。`skillshare` 保留第三方來源，標出 Orca 接入的 `panel-motion.js`。記錄 `keys.json`、`settings.json`、`programs.json` 的版本庫預設值，使用者的覆寫與 `tasks.json`、`layouts/.state/` 等執行期資料留在使用者的 Herdr 設定目錄。（gpt-6.2-astra xhigh）
- **b. Validations**　從兩套 layout、快捷鍵及程式內呼叫追到實際入口，核對 mod 名稱、指令參數、overlay props 與資產來源。Herdr 內建項目另標為主程式提供。所有比對以 Git 基準為準。（gpt-6.2-astra xhigh）

### 2. 建立一個可讀的組合入口，先重現現有輸出（gpt-6.2-astra xhigh）

- **a. Actions**　新增 `orca-ui/app.mjs` 作為閱讀起點，依畫面列出側欄、分頁、工作區、右面板、狀態列與各自開啟的選單。入口只組合功能，各功能的行為、設定、SVG 與測試放在對應的 `features/` 子目錄。（gpt-6.2-astra xhigh）
- 第一階段逐檔搬入既有實作，用 Node 標準函式庫及 `scripts/sync-shared.mjs` 現有的複製規則，先在空目錄生成原路徑的 `mods/<名稱>/{mod.json,main.js}`、相依檔案、layout 與設定。保留目前的安裝路徑，將產物納入版控並用 `--check` 偵測手改。這一步沿用原始位元組，暫無引入 Vite 的需要。（gpt-6.2-astra xhigh）
- **b. Validations**　在兩個空目錄獨立生成，各自與基準逐檔比對路徑集合、內容及 Git 檔案模式，包含 PNG 與可執行的 `orca-status/claude-statusline.sh`。在輸出副本對每個 mod 跑 `herdr-app check`，確認本地 JS 相依都在該 mod 內，`herdr`、`gpui-kit`、`gpui-base` 仍由 Herdr 提供。（gpt-6.2-astra xhigh）

### 3. 由同一份畫面組合產生兩套 layout，保留每個掛載位置的用途（gpt-6.2-astra xhigh）

- **a. Actions**　從兩套 layout 抽出相同的 `work-body`。右面板共用 `panel-body` 的子項與順序，由 `orca-unified` 為八個子項各加上 `unified: true`。在組合入口直接呈現兩套標題列與側欄的排列差異。（gpt-6.2-astra xhigh）
- Herdr 由 `content.mod` 選擇入口，由每個掛載點的 `content.props` 指定角色，例如 `orca-chrome` 的 `footer` 和管理頁的 `page`。保留節點 ID、stack 預設頁、浮層、`terminal_menu` 與 `content.tab` 指定的原生終端機與 `content.pane.header` 指定的標題列。例如 Tasks 排程仍由側欄頁尾啟動，layout 只宣告掛載位置。（gpt-6.2-astra xhigh）
- **b. Validations**　將生成的兩棵 JSON 樹分別與基準做完整結構比對，涵蓋順序與 props 是否存在。切換兩套 layout，分割終端機並在新 pane 輸入文字，核對 pane header、右鍵選單及工作頁切換。（gpt-6.2-astra xhigh）

### 4. 逐項收斂重複實作，保留狀態圖示與偏好的既有差異（gpt-6.2-astra xhigh）

- **a. Actions**　先把 `orca-chrome`、`orca-nav`、`orca-spaces` 相同的 `sidebarFrame` 收到側欄功能，再處理狀態圖示。相同 SVG 共用來源並發佈到原路徑，卡片、agent 列及 pane 保留各自的圖形、尺寸與配色。（gpt-6.2-astra xhigh）
- 共用程式在建置時放進使用它的 mod。執行時會改變的跨 mod 值繼續透過 Herdr 的 `shared()`、`setShared()` 傳遞，例如 `sidebar.openPx`。沿用 `workspace.options.v1` 等偏好的儲存鍵、預設值及讀寫時機，保留每個 view 實例自己的焦點與編輯狀態。（gpt-6.2-astra xhigh）
- **b. Validations**　每次只抽一項，記錄允許改變的輸出檔。執行既有的 `node --test mods scripts`、遷入功能目錄的測試與相關 render 快照，用同一組狀態確認完成的卡片顯示圓點、agent 列顯示勾號。收合再展開側欄，切換分組後重開測試實例，與基準比對寬度、分組及圖示。（gpt-6.2-astra xhigh）

### 5. 驗收實際操作、修改入口與回復方式（gpt-6.2-astra xhigh）

- **a. Actions**　使用暫存 `HERDR_APP_HOME` 與專用測試終端機，以相同資料各跑一次基準與產物。在 `orca` 用 ⌘⇧F 觸發 `orca-panel-head.search`，確認右面板開到 Contents。在兩套 layout 用按鈕與 ⌘B 切換側欄、右鍵開啟分頁選單、從側欄頁尾開啟 Tasks。記下選取的項目、輸入焦點及 `herdr-app status` 的錯誤差異。（gpt-6.2-astra xhigh）
- 更新 README 的修改、生成與檢查指令，並將 `titlebar-height.py` 等會改寫產物的工具指向新來源。每一批搬移獨立提交，方便用上一版來源重新生成，在測試實例演練回復。（gpt-6.2-astra xhigh）
- **b. Validations**　請後續審查者只從組合入口找出右面板搜尋快捷鍵與側欄動畫各自的來源、動作和測試。在暫存副本修改一處側欄動畫，確認只有預期的 mod 產物改變，再回復並重建到原有結果。建置與回復均只寫入指定測試目錄。（gpt-6.2-astra xhigh）

## Review notes

- **P0：把外部副作用納入測試隔離。**　暫存 `HERDR_APP_HOME` 不能單獨保證安全：`orca-chrome` 的 Tasks runner 可能執行排程，`orca-status` 會讀寫 usage cache、輪詢 OAuth 並跟隨 worktree，Changes／Spaces 等流程會操作 Git。Task 5 應使用暫存 `HOME`、cache 與 Git fixtures，以假的 agent executable／固定資料取代網路與本機 CLI，停用真實排程，並在基準與產物各跑完後斷言測試根目錄以外沒有檔案或 repo 被改動。（kimi-k3.1-pro high）
- **P0：補上安裝／升級的檔案所有權與使用者設定保護。**　空目錄輸出與基準一致，只能證明生成正確，不能證明升級安全。應由 managed-file manifest 限定可新增、更新及刪除的產物；刪除僅限上一份 manifest 擁有且未在手改保護規則內的檔案，不可 mirror 清空目標。驗收 fixture 要包含額外 mod、執行期資料，以及已修改的 `keys.json`、`settings.json`、`programs.json`，明確驗證自訂內容會保留或進入人工 diff，而不是被版本庫預設值直接覆蓋。（kimi-k3.1-pro high）
- **P1：用 24 個 mod 的入口矩陣補齊端到端驗收。**　目前 Task 5 的操作案例只涵蓋少數路徑，應把 Task 1 的清單轉成逐項可勾選矩陣：每個 mod 至少驗證實際掛載或由指令／overlay／pane 開啟、主要動作與關閉，並標示 Herdr 內建依賴。特別補上 New Agent／Agent Manager、Handoff、Files／Changes／Diff、Float、Worktree 與 status wrapper；不能只用靜態 grep 或 `herdr-app check` 取代這些入口的實際冒煙測試。（kimi-k3.1-pro high）
- **P1：測試必須跑在實際發佈產物上，且明確納入搬遷後的測試發現路徑。**　除了 `orca-ui/features/` 的來源測試，每次都應先從乾淨 checkout 生成暫存安裝樹，再對其中的 mod、兩套 layout 與資產跑 unit／render／整合測試，避免來源測試通過但組合規則漏檔。現有 `node --test mods scripts` 不會自動涵蓋新的 `orca-ui` 測試，因此 README 應提供單一驗收指令，明確列出來源與產物測試路徑，最後再跑 `herdr-app check` 與 drift check。（kimi-k3.1-pro high）
- **P1：所有改寫工具都要有唯讀檢查與明確輸出根目錄。**　例如目前的 `scripts/titlebar-height.py` 會同時改寫 repo layout 和 `~/.config/herdr-app`，而且只處理 `orca.json`。遷移時應讓一般執行與 `--check` 都能指定來源／輸出 root、涵蓋兩套 layout，並保證 `--check` 不寫檔、測試模式絕不預設寫入 live config；同時記錄 Node、Python、Herdr App／core 與 OS 版本，讓基準結果可重現。（kimi-k3.1-pro high）
- **P1：回復單位必須是同一份完整產物快照。**　每批遷移應把 feature 來源、組合入口、生成產物、測試與文件放在同一提交，避免回復時混用新來源和舊 mods。Task 5 的回復演練應從該提交重新生成完整暫存樹，再切換兩套 layout 並重跑入口矩陣；同時驗證回復不會刪除或覆蓋使用者的設定與執行期資料。（kimi-k3.1-pro high）

## 架構判斷與實作建議（kimi-k3.1-pro high）

- **我的結論是值得做，但成功指標應是「降低修改風險」，不是「減少行數」。**　目前 24 個 `main.js` 合計約 15,352 行，UI 組合散在兩套 layout、mod imports、字串指令、overlay 呼叫與 shared keys；搬家本身不會自動改善這個問題。應以「改一個畫面只需進一個 feature、能追溯所有產物與測試、生成及回復均安全」作為驗收。若只是建立另一層檔案索引，卻仍要到處找隱性指令與狀態，就不應宣稱完成單一原始碼套件。（kimi-k3.1-pro high）
- **建議 `app.mjs` 成為 build-time 的明確組合圖，而不是只有可讀性的目錄頁。**　每個 feature 用純資料宣告其 mod、layout slots、入口 commands／overlays、跨 mod shared keys、設定檔、資產、輸出檔及測試；`app.mjs` 明確 import 並組合這些 descriptor。相同資料同時供生成器、入口矩陣及完整性檢查使用，以機器檢查重複 node／command、缺少 producer 或 consumer、dangling mod／asset reference 與未宣告輸出。執行期仍使用 Herdr 原生 API，不新增 event bus、DI container、runtime resolver 或 Vite。（kimi-k3.1-pro high）
- **在 Task 4 收斂之前，先補「同輸入、同動作序列、同外部結果」的 differential contract tests。**　現有 render snapshot 只見於 `agent-config`、`orca-agent-manager`、`orca-spaces`，另有 8 個 mod 沒有測試；`gpui-stub-loader` 目前將 `setShared()` 設為 no-op，`openOverlay()` 等 API 也多半是空白 stub，而且 recorder 的 `.when()` 只展開成立分支，無法證明跨 mod 狀態與另一條 UI 分支相容。建議適度擴充現有 loader，記錄 `run`、`openOverlay`、`setShared`、`exec`、檔案與 layout／pane 動作，對基準及產物播放同一組 props、layout、terminals、shared state 與使用者事件，再比較正規化 render、外部動作及持久化結果。這是防止重構漏接線的主要擋板，不應另做大型測試框架。（kimi-k3.1-pro high）
- **遷移應採垂直切片，不要先搬完 24 個 mod 才開始驗證新架構。**　第一切片可選低耦合的 `orca-panel-head`，完成 descriptor、`app.mjs` 組合、資產生成、快捷鍵、panel 開關與測試的整條路；通過後才逐 feature 搬移。其後把高風險的 `orca-tabs`／pane motion、Tasks／status 外部副作用、Files／Changes／Diff 與 worktree／agent 操作分開提交，各自設 go／no-go。未遷移的 mod 先由原相容產物支援，避免一次大爆炸後只能整套成功或整套回復。（kimi-k3.1-pro high）
- **切回舊 layout 不是可靠 rollback。**　`orca` 與 `orca-unified` 使用同名 mods，因此只要新產物的 mod 有 regression，兩套 layout 可能一起壞。實際回復必須切換到完整的上一版安裝樹或獨立 `HERDR_APP_HOME`，而非只執行 `layout.switch orca`。上線順序應是暫存樹 A/B → 專用測試實例 → 保留完整上一版產物的單機 canary；期間凍結無關功能修改，避免基準持續移動而無法判斷差異來源。（kimi-k3.1-pro high）
- **必須劃清 Orca feature 與 process-global 設定的邊界。**　`keys.json` 有 global bindings，`programs.json` 含 agent 啟動參數與高權限 flags，`settings.json` 也不是某個 layout 專屬；把它們視為 UI 套件普通輸出，可能改變其他 layout 或所有 agent 的行為。安裝器應預設保留現有全域設定，只對 Orca 擁有的鍵值做明確、可審核的更新，並至少在兩套 Orca layout 之外驗證快捷鍵不會無效或攔截原功能；不得借遷移之名把 `--dangerously-*` 等預設旗標加入使用者原本沒有的設定。（kimi-k3.1-pro high）
- **只收斂已證明相同的實作，刻意把第三方與高風險動態行為留在邊界後。**　SVG 要以內容 hash 相同為共用前提；sidebar helper 要同時比較 unified／非 unified、收合中途 reversal 與動畫結束後狀態。卡片圓點、agent 勾號、配色與尺寸等相似但不同的視覺不應為去重而抽象化。`skillshare` 建議保留 pinned vendor 來源與 NOTICE／授權，只整理 Orca adapter 和 `panel-motion.js` 接入，避免無謂改寫上游碼造成日後更新困難。（kimi-k3.1-pro high）
- **完成定義應包含效能與生命週期，不只畫面相同。**　對基準與產物比較 mod 實例數、timer／watcher 註冊數、layout switch 後是否重複啟動 runner、sidebar／panel 操作造成的 terminal resize 次數，以及冷啟動與主要頁面切換是否明顯退步。最終 gate 建議是：乾淨 checkout 連續生成兩次無 diff、無未宣告檔案、24-mod 矩陣全過、兩套 layout 的 command／shared contracts 全過、無測試目錄外寫入、完整舊產物回復成功。任何一項缺席都應列為未完成，而不是用「既有測試通過」帶過。（kimi-k3.1-pro high）

## 接續 Opus 的實作判斷（Codex）

**建議先保留現行編輯流程，用一次側欄修改決定是否需要生成器。** 選同一個需求，先用現有 `shared/`、`USES` 和兩套 layout 找出作用位置、改動來源與消費端測試，再用第一個套件切片做同一件事。記下哪些檔需要人同步維護、遺漏哪個消費端時檢查會失敗。若兩條路都只需改一份來源，也能抓到同樣的遺漏，我會先合併共用 helper 與測試，把整批搬遷留待有具體收益時再決定。

- **Task 1 的隔離要早到第一次跑 Node 測試。** 我用只記錄參數的 `herdr-app` 替身跑 statusline 測試，3 項全過，卻攔到 3 次 `do orca-status.refresh`。測試已隔離 cache，仍會透過繼承的 PATH 通知視窗。這支測試保留替身即可。另在開測試視窗前預放 `{"version":1,"tasks":[]}`；空白檔會產生預設任務，僅設 `enabled: false` 的任務仍可被「Run now」執行。真實視窗操作另須驗明目標 core。
- **基準要能看出少跑了哪些斷言。** 隔離重跑後，`f2736b9` 為 408／424 通過，`680be17` 為 416／432 通過。兩版都有 15 個效能案例卡在建 fixture，另 1 個 titlebar 案例失敗。每批比對已發現的測試名稱與失敗原因，允許有說明的增刪或改名。搬到 `orca-spaces` 前先修復探針，讓那 15 個案例真正跑到行為斷言；否則失敗清單完全相同，這批仍可能已經退化。
- **每批的父提交要包含目標分支已合併的行為。** 這個 worktree 的父提交仍是 `f2736b9`。在 `680be17`，「Remove Project from Sidebar」已跨過 `orca-menu`、`trash.svg` 與 `orca-spaces` 的指令接收端。舊分支即使逐檔重現自己的父提交，也可能漏掉整項功能。合併前在預計落入 main 的樹重跑當批比較；這一例應同時驗到選單送出的 repo、接收端移除對應項目，以及另一個專案仍保留。第一批回復直接從整合後的父提交匯出原檔與模式，因為那一版還沒有新生成器。
- **把 layout 比對換規則的時點寫進提交。** Task 2 原樣複製。以同一個兩格縮排的 JSON 序列化器實測，`orca.json` 逐位元組相同，`orca-unified.json` 從 9,307 變成 9,342 bytes。Task 3 首次由程式產生 layout 時，只有這兩檔可改排版；兩棵解析後的樹各自對父提交全等，其他受管檔案照舊比位元組和 Git 模式。同版連續建置兩次仍須逐位元組相同。
- **側欄驗收要改到發佈版確實執行的分支。** 我把兩份 layout 的實際 tabs props 交給 `toggleSidebar()`。一般版送 `layout.toggle`，unified 因 `motion: "native"` 進入 native drawer。只改 `sidebar-motion.js` 的 easing，兩套預設 layout 都不會走到那個呼叫點。Task 5 可在副本改 unified 側欄原生時鐘的 transition，核對生成的 `orca-tabs/main.js`、native 路徑的變化，以及一般版仍送一次 toggle，最後還原來源並驗證產物回到原始位元組。

Stage 9 的兩份補審、程式碼位置與實測條件見[實作準備度報告](../implementation_readiness_report.md)。
