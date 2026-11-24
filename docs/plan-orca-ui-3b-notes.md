# Orca UI 3b 規格筆記

> 封存：B／C 檢查點的結果是停止搬家，3b 未啟動（見 [B／C 結果](../artifacts/orca-ui-checkpoint/20261124-bc/RESULT.md)）。僅在日後重新評估搬家時使用。

供第一次接手的 AI 在 B／C 檢查點通過後撰寫 3b 及後續批次規格，前置條件與步驟 1 見 [現行計畫](plan-orca-ui-package.md)。

## 3b 與後續的批次規格清單

檢查點通過後，每批開工前先補齊下列規格。一次一個 feature 或一組緊密相關的 mod，每批一個提交。

1. 範圍。列父提交、來源、目的地、所有權、測試與 fixture、共用副本，以及涉及的 layouts、assets 和工具。記錄仍在原地的相依入口。
2. 允許差異。逐檔列新增、刪除、允許的內容差異及 Git 模式。純搬家驗 `--check`、父版 Git blob／模式和完整測試。layout 首次移交驗原始 bytes。日後改由程式組合，兩套各自解析後與父版完整 JSON 全等，包含節點順序及巢狀 pane header。`cloned_from`、`under`、側欄大小及背景、`brand`、各處 unified props 都是差異例子。layout 規格需涵蓋 [layouts/orca.svg](../layouts/orca.svg)、[layout.test.js](../scripts/layout.test.js) 和 titlebar 工具移交。
3. 入口與預期行為。對涉及的每個 mod 列 layout／role 或 command、overlay、pane 入口，列操作、可觀察結果、關閉方式及 exec 副作用。改 runtime 的批次加入受影響的 `check` 退出碼、按鍵與畫面按鈕、適用的選單與 overlay、props 專屬畫面截圖及手動點擊驗收。
4. 驗收樹組法。寫出先 build 到空目錄並驗集合、bytes、模式的命令，再逐清單補父版未接管 runtime、兩套 layout 與根設定，並加入候選版 scripts、orca-ui、測試與 fixtures。禁止覆蓋新產物、遺漏 fixture 或保留已搬測試的父版副本。從驗收根跑完整 suite，按步驟 1 比對測試名稱。規格須寫明測試載入候選產物及快照的確切位置。
5. 隔離需求。列步驟 1 的測試帳號、socket、子程序環境與替身驗證。列出副作用對應的 fixture、`check` 和視窗步驟，以及每項是否待驗。效能探針只從驗收樹產生獨立探針目錄。
6. 回復順序。先回相依批次（若已做 3b，先回 3b 再回 3a），再用回復後版本的 builder 及仍存在的 `sync-shared.mjs` 重建，按 Git blob、模式與測試驗證。依 dev-sync 逐檔複製回復的檔案，列出 live 多出的檔案給擁有者。用包含自訂根設定、runtime 資料及額外 mod 的假 app home 演練升級與回復，以雜湊確認這些檔案保留。

### 3b 規格的已知事實

- Nav、Spaces、Chrome 的三份 `sidebarFrame` 本體逐位元組相同，只有 unified props 時讀 `sidebar.openPx`。收窄時以固定展開寬度包內容，展開時直通。未來的共用測試可沿用同一組 unified、寬度與主題 fixture。見 [Nav](../mods/orca-nav/main.js#L135-L150)、[Spaces](../mods/orca-spaces/main.js#L32-L47)、[Chrome](../mods/orca-chrome/main.js#L31-L46)。
- `keys.json` 的 ⌘B 發 `orca-tabs.toggle-sidebar`。標準版 Tabs 沒有 unified props，命令在 [orca-tabs/main.js 第 409 行](../mods/orca-tabs/main.js#L409) 略過。從開啟初態按 ⌘B，側欄維持開啟。從同一初態驗 Chrome 畫面按鈕可收合，接著用 Tabs 畫面按鈕重開，兩者走 `layout.hide/show`。標準版 Chrome 有 `brand` 與 footer 兩種角色。見 [標準版 layout](../layouts/orca.json)、[Chrome](../mods/orca-chrome/main.js#L22-L24) 與 [Tabs 按鈕](../mods/orca-tabs/main.js#L1444-L1456)。
- `orca-unified` 的 Tabs 帶 `unified` 和 `motion: "native"`。從相同開啟初態分別用 ⌘B 與畫面按鈕觸發 native drawer，驗收合中反向、結束後 `main` 回 `weight:1`，以及 PTY 寬度還原。由 Tabs 發布 `sidebar.openPx`，Nav、Spaces、Chrome 讀取。見 [unified layout](../layouts/orca-unified.json)、[Tabs](../mods/orca-tabs/main.js) 與 [drawer.js](../mods/orca-tabs/drawer.js)。
- Nav 的 Workspace Options → Refresh branches 呼叫 `orca-spaces.refresh`。Spaces 輸出含 [agent-icons/](../mods/orca-spaces/agent-icons/)，其 `review-store.js` 到 3b 時已歸共用 manifest。見 [Nav refresh 測試](../mods/orca-nav/refresh.test.js) 與 [Spaces](../mods/orca-spaces/)。
- Nav 與 Spaces 測試目前用 `../../scripts/` 和 `./main.js`，Spaces 另用同目錄快照及 `../${mod}/review-store.js`。移到來源旁時，宿主 stub 和 runtime JS 從驗收根解析，快照仍取測試旁，缺檔必須失敗。盤點也要涵蓋同目錄 import 和讀取來源文本的案例。見 [Nav refresh](../mods/orca-nav/refresh.test.js)、[Spaces render](../mods/orca-spaces/render.test.js)、[review-store](../mods/orca-spaces/review-store.test.js)、[card-agents](../mods/orca-spaces/card-agents.test.js) 與 [retained-row](../mods/orca-spaces/retained-row.test.js)。
- 兩支效能探針從腳本所在樹找 Spaces。若批次使用它們，從驗收樹的 `scripts/` 取腳本，只傳新的探針輸出目錄，省略 Git ref。見 [perf-spaces.py](../scripts/perf-spaces.py) 與 [perf-spaces-virtual.py](../scripts/perf-spaces-virtual.py)。
