# Orca UI 單一原始碼套件實作計畫

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
