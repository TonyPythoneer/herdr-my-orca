# 1. 判定

**READY WITH FIXES**。第二批可沿用複製式 builder，但先補齊逐檔所有權、寫入前的漂移檢查、側欄快捷鍵基準與產物測試。現有第一批只有單一 mod 的對應，直接擴大會讓 20 份共用副本的遷移、錯誤反查及部分接管目錄的驗收各自採用不同規則。兩套 layout 與其餘 mod 可逐批移交，每批應先通過自己的入口與回復驗收。

## 2. 第二批開工前須修正

1. **讓入口、builder 和報錯反查讀同一份逐檔對應。**
   > 「一個受管產物檔只能有一個 feature 宣告為 owner」（第 22 行）
   > 「八個共用 JS 與側欄同批移交 builder」（第 74 行）

   現有 manifest 一份只對應一個 `output`，且來源與目的共用檔名。八個 helper 現有 20 個目的檔，分布在 13 個 mod，包含本批仍保留手寫入口的 mod。反查優先讀 `USES`，保留舊表會繼續導向 `shared/`，直接刪腳本則會讓反查與測試載入失敗。見 `scripts/build-orca-ui.mjs:34,68–79`、`scripts/sync-shared.mjs:10–19`、`scripts/where-error.mjs:9,29–44`。

   把 `app.mjs` 的 manifest 引用定為唯一清單。沿用單目錄 `files` 的簡寫，補上單一來源發往多個精確目的路徑的表示，並在建置前拒絕重複目的路徑。以現有 `USES` 的 20 個目的檔做交接斷言，另列 `sidebar-frame.js` 的三個目的檔。反查讀同一份對應，對每份 helper 副本保留行號與 UTF-8 byte 欄，列出 owner、消費端、兩端的相關測試與畫面。只有明列為尚未移交的路徑可回報原地編輯，未知檔案應回報找不到來源。交接時移除舊寫入邏輯，並同步修正 `scripts/sync-shared.test.mjs:3–11`、`scripts/opencode-launch.test.mjs:6–7`、README 與 dev-sync 的舊流程。驗收需含同一個 mod 內的受管 helper 與手寫 `main.js` 兩種報錯。

2. **開寫前先擋住無法解釋的差異。**
   > 「寫入 repo 前若發現目的檔有來源無法解釋的修改，列印該 diff 並中止寫入」（第 70 行）
   > 「刻意漏檔、多出未宣告檔案、篡改內容或移除執行位元時，檢查必須失敗」（第 84 行）

   現行寫入分支會直接覆蓋，`--check` 只巡訪已宣告目的檔，測試也沒有多檔、重複 owner 或寫入中止案例。第二批開始出現同目錄內的手寫檔與生成檔，目錄級判斷會誤報或漏報。見 `scripts/build-orca-ui.mjs:68–97`、`scripts/build-orca-ui.test.js:12–52`。

   先展開所有目的檔再一併檢查。寫 repo 時，現檔應符合新來源或明定的 Git 基準版本與模式，否則列出來源、目的及 diff，全批中止。空 staging 驗完整檔案集合及執行位元。repo 內全移交目錄驗未宣告檔，部分移交目錄明列仍手寫的範圍，排除 `gpui-kit.d.ts` 與 `jsconfig.json`。先加一個本批情境，讓第二個目的檔帶手改，確認失敗時第一個也原封不動。首次移交以父提交逐檔比對，另列允許的側欄抽取與生成註解差異。

3. **先把側欄範圍與 ⌘B 的實際基準寫清楚。**
   > 「`orca` 直接切換 `sidebar`」（第 15 行）
   > 「用按鈕與 ⌘B 切換側欄」（歷史驗收第 137 行）

   ⌘B 送 `orca-tabs.toggle-sidebar`。標準 `orca` 的命令接收端在記下切換意圖前就被 `unified` guard 擋掉。直接呼叫 `toggleSidebar()` 才會走 `layout.toggle`，而標準版的畫面按鈕另走 `layout.hide/show`。用兩套實際 layout props 和同一條命令做過唯讀重播，`orca` 排入 0 次，unified 排入 1 次並分派到 native。見 `keys.json:37`、`mods/orca-tabs/main.js:402–413,556–560,1444–1455`、`mods/orca-chrome/main.js:22–24,115`。

   在切批表鎖定本批搬 `orca-nav`、`orca-spaces`、`orca-chrome` 及共用檔，三份 `sidebarFrame` 函式已核對逐位元組相同。`orca-tabs`、`drawer.js`、兩套 layout 保留原地來源，由 `app.mjs` 精確連到掛載節點、按鍵與按鈕、`sidebar.openPx` 的發布及消費端，也連到側欄開啟的畫面與跨 mod 命令，例如 Options 的 Refresh 送 `orca-spaces.refresh`。保留父提交行為，記錄標準版 ⌘B 在接收端被略過，若要修正另立行為變更。驗收從命令入口測兩套 layout，另測標準版按鈕與 unified 反轉、PTY 寬度還原，以及三個 view 的共用 frame。unified 動畫題應指向 `sidebar-native-clock` 和 `drawer.js`。見 `mods/orca-nav/main.js:135`、`mods/orca-spaces/main.js:32`、`mods/orca-chrome/main.js:31`、`mods/orca-nav/refresh.test.js:20–30`、`mods/orca-tabs/main.js:298–312,1391–1395,1416–1418`、`mods/orca-tabs/sidebar-native.test.js:9–45`。

4. **把 staging 驗收指令及側欄隔離方式定案。**
   > 「每批在實際產物跑受影響的 unit／render 測試，缺快照須失敗」（第 84 行）

   只建本批檔案的空樹缺少其餘 mod、layout、測試與 fixtures。Spaces 的快照測試缺檔會自行寫入，而且只畫卡片，未走 sidebar frame。效能探針預設複製 repo 的 Spaces，OpenCode 測試則同時讀 `shared/` 和現行 mod。見 `mods/orca-spaces/render.test.js:10–14,47–52`、`scripts/perf-spaces.py:17–33`、`scripts/perf-spaces-virtual.test.js:9–16`、`scripts/opencode-launch.test.mjs:5–7`。

   定一條驗收流程：先獨立檢查空 staging 的完整輸出，再以指定父版的未移交檔及 fixture 補成驗收樹，載入本次生成的 JS 跑產物測試。Spaces 快照缺失直接失敗，將重錄留給明確操作，效能探針指定本批產物路徑。保留 `mods/keys.test.js` 的發現範圍，記錄搬動前後案例名稱與數量。完整 Node suite 先隔離 statusline 的 Herdr CLI。Spaces 會跑 `git`／`gh`，Chrome footer 會啟動可執行 shell 的 runner，依第 78、93 行先用 stub 與 fixture 驗收，記錄哪些入口尚未實機驗證。見 `mods/orca-status/claude-statusline.sh:101–102`、`mods/orca-spaces/main.js:428–474`、`mods/orca-chrome/main.js:55–60`、`mods/orca-chrome/runner.js:23–28,83–88`。

## 3. 可延後的缺口

- **兩套 layout 的組合形式**可留到 layout 批次。該批先決定 `layouts/orca.svg` 的所有權，讓 `titlebar-height.py` 改操作來源或只做檢查，再逐棵比對父版的完整 JSON，涵蓋巢狀 pane header、`terminal_menu`、stack 順序與 props。現有腳本會重寫兩個目標 JSON，layout 測試只逐項抽查。見 `scripts/titlebar-height.py:38–44,64–74`、`scripts/layout.test.js:9–16,31–39,44–73`、`layouts/orca.json:22–24`、`layouts/orca-unified.json:18–20`。
- **安裝和回復**在首次要求使用生成樹安裝或升級前收斂。README 的整目錄複製流程須改成受管檔逐檔交付，三份根設定走 seed／合併規則；dev-sync 的 repo 優先限本次明確變更的檔案。用額外 mod、已修改的設定與執行期資料驗證升級和回復。狀態列批次須另驗外部 wrapper 的原路徑與 Git 模式 `100755`。見 `README.md:84–94,119–129`、`.agents/skills/herdr-app-dev-sync/SKILL.md:8–17`。
- **24 個 mod 的入口矩陣與可讀性重測**可隨各批補齊，完整遷移驗收前收口。每批至少從 `app.mjs` 走一次跨 mod 題，最後覆蓋 pane、overlay、命令、狀態列，以及跨目錄 SVG 等繞過 layout `children` 的路徑。用測試狀態相同的對照組重做跨功能題，記錄是否翻找受管 `mods/`。Herdr 升版或宣稱完整實機涵蓋前，補驗事件報錯、無座標的診斷方式與尚未隔離的 core 路徑。見 `mods/orca-new-menu/main.js:215–217`、`mods/orca-pane/main.js:348`、`mods/orca-tabs/main.js:1449`。

## 4. 計畫與現況不符

- **第 11、20 行的第一批入口。** README 只有 `app.mjs` 的文字路徑。`app.mjs` 只有 `panel/head`，列兩個 layout 名稱，未連到 layout 檔、側欄或其他暫留來源，builder 也沒有讀它。保留第一批實情，從第二批起要求入口和 builder 共用對應。見 `README.md:101–105`、`orca-ui/app.mjs:7,12–25`、`scripts/build-orca-ui.mjs:23–31,68–69`。
- **第 57 行的反查內容。** `USES` 分支只列出 `shared/` 來源與其他副本，缺 owner、layout、測試及下一跳。欄位原樣輸出，是 Herdr byte 欄。README 的「shared helpers one line up」也已過時。第 26 行寫可打開錯誤產物，第 57 行要求 AI 直接反查，應改成一致的操作指引。見 `scripts/where-error.mjs:26–44`、`scripts/sync-shared.mjs:20–27`、`README.md:106–109`。
- **第 67、70、84、99 行的漂移契約。** 現行 `--check` 只列目的檔及原因，以檔案系統的 `0o777` 比對，沒有檢查 Git 模式或未宣告的目的檔。寫入前也沒有 diff／中止。`app.mjs` 的 `--check` 範例少了必要的 `--out .`，實跑退出 2。見 `scripts/build-orca-ui.mjs:55–88,94–97`、`orca-ui/app.mjs:30–32`。
- **第 15、91、137 行的快捷鍵描述。** 標準版 ⌘B 的實際接收端行為見第 2 節。`keys.json` 有 57 條 `global`、10 條 `terminal`、35 條 `layout:orca`，沒有 `layout:orca-unified`。第 91 行「只有 `global`」漏了 `terminal`。見 `keys.json:2,37,61–73,102`、`mods/orca-tabs/main.js:409–412`。
- **第 86 行的 layout 測試覆蓋。** `ids()` 只收 `children` 的 ID，測試查少數節點存在與缺席，沒有斷言兩套節點的完整集合及順序。見 `scripts/layout.test.js:9–16,44–74`。
- **第 47 行的證據存放。** 標為「不入版控」的 `artifacts/orca-bundler/20261123T160756Z/replay.sh` 已納入 `9b9e22a`。修正計畫敘述即可。

## 5. 最小下一步

先在現行計畫加入一張第二批逐檔交接表。以 `USES` 的 20 個目的檔和 `sidebar-frame.js` 的三個目的檔為起點，列出各自的唯一來源、owner、目的路徑及驗收測試。這張表可直接當 builder 與 `where-error` 的共同測試資料。

本次唯讀執行 25 項 Node 測試，全部通過。builder 的 12 個現有產物、shared 同步與兩套 titlebar 的唯讀檢查均通過。完整 suite 會建立 fixtures 並可能呼叫 Herdr，這次依限制跳過，也未執行 Herdr CLI、操作視窗或驗證 live 安裝。
