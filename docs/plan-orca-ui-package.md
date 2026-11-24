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
