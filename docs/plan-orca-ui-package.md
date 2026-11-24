# Orca UI 單一原始碼套件實作計畫

## 目的與完成條件

讓第一次接手的 AI 從一個入口看懂整套 Orca UI，拿到修改需求時能指出正確來源、受影響的畫面和驗證方式。**完成遷移後，日常功能開發從 `orca-ui/app.mjs` 開始。AI 沿來源中的連結改程式、跑測試，不必搜尋或打開已生成的 `mods/` 才能知道怎麼改。** Herdr 和產物測試仍讀取這些檔案。

本節到「實施順序與驗收」是現行計畫。本文只規劃遷移；目前 checkout 的多數實作仍在 `mods/`，已有的建置工具是 [sync-shared.mjs](../scripts/sync-shared.mjs)。文末保留原提案和署名審查供追溯。遇到基準、來源位置或執行順序差異，以現行計畫為準。

## AI 從哪裡讀、在哪裡改

遷移第一批時，在 repo README 的開發段落放上 `orca-ui/app.mjs` 的連結。這個入口按畫面組合兩套 layout，並連到選單、快捷鍵和其他方式才會開啟的功能。每個功能從入口可追到實際來源、它提供或呼叫的跨 mod 動作、發布路徑與相關測試。優先用真實的 import、layout 節點與建置對應表示關係；例如快捷鍵直接連到根目錄 `keys.json` 的區段，避免另外手抄一份鍵表。Builder 使用同一份組合與輸出對應。

| 修改需求 | 從入口往哪裡讀 | 要辨認的行為 |
|---|---|---|
| 左側欄 `sidebar` | 側欄組合連到導覽、spaces 清單和頁尾；⌘B 的處理連到 tabs 功能 | `orca` 直接切換 `sidebar`；`orca-unified` 的 tabs 收到 `motion: "native"`，驅動 drawer。三個側欄 view 讀取寬度來排版。 |
| 右面板 `panel` | 面板標題列連到 `panel-body` 的各頁，以及接收命令的功能 | 在 `orca`，⌘⇧F 經 `orca-panel-head.search` 展開面板、選到 Files，再送 `orca-files.search` 切換 Contents。改按鍵、改開啟順序、改搜尋畫面各有自己的來源。 |
| 中央工作區、分頁與工作頁 | 從 `work-body` 找終端機、pane header、Landing、Agents、Providers、Tasks；從 tabs 找分頁互動 | 終端機由 Herdr 提供，標題列由 `orca-pane` 提供。Tasks 頁面位於中央，啟動排程的程式位於側欄頁尾。 |
| 選單、對話框、浮層、狀態列 | 從呼叫端的 command、overlay、pane 或外部腳本入口連到實作 | 例如 Changes 可在 pane 開啟 Diff，New Menu 可開 Worktree 對話框。單看 layout 的 `children` 會漏掉這些路徑。 |

**每個路徑只有一個可編輯來源。** 第一批就讓入口標出哪些路徑已交給 builder、哪些仍由現行檔案負責；同一個 mod 可能同時含手寫入口與已生成的共用 helper，所以對應要精確到檔案。

**Feature 是檔案所有權的單位，不是畫面。** 畫面的分組只存在於 `app.mjs`；一個受管產物檔只能有一個 feature 宣告為 owner，跨 mod 共用碼（例如 `sidebar-frame.js`）由宣告它的 feature 連到發佈路徑。同一個畫面下的多個 mod 仍是多個 feature。（buffy deepseek-v4.1-flash high）

| 範圍 | 編輯位置與讀取時機 |
|---|---|
| 已遷移的 Orca mod、layout、主題、資產與腳本 | 從 `orca-ui/` 修改並重新生成。`mods/`、`layouts/` 和 `themes/` 下對應的受管檔案是 Herdr 的交付格式。只有定位載入錯誤、資產缺失或 repo／live 漂移時，開啟報錯的產物，比對後回到對應來源修正。 |
| 尚未遷移的路徑 | 入口暫時指向現有手寫檔或 `shared/` 原件；本批完成後一併換成新來源。現有八個共用 JS 依 `sync-shared.mjs` 的 `USES` 逐項交接，每個目的檔同時只由一支工具寫入。 |
| 快捷鍵與全域預設 | `keys.json`、`settings.json`、`programs.json` 保留在 repo 根目錄，從功能入口連到相關設定；它們是 seed-once／merge-only，不是 builder 產物。`layout:<name>` 只對同名 layout 生效，因此 `layout:orca` 的 35 條在 `orca-unified` 不生效，unified 只繼承 `global`、`terminal`。安裝與回復須保留使用者的 live 覆寫。 |
| 本機工具與執行期資料 | `mods/skillshare/` 是 repo 自有的 mod，是使用者本機 skillshare 工具的介面，和其他 Orca mod 一樣遷移；它呼叫的本機工具不在 repo 內，不屬於 builder 產物。Herdr 內建項目由 host 提供；`tasks.json`、`layouts/.state/` 等使用者資料留在 app home。 |

## 實作形狀與工具

以下路徑是要實作的介面。第一批先移交右面板標題列，其餘功能在入口中指向當時的權威來源。

```text
orca-ui/app.mjs                         組合入口，連結兩套 layout、功能與發布對應
orca-ui/features/panel/head/            第一批，orca-panel-head 的程式、圖示、測試
orca-ui/features/sidebar/               後續，左側欄組合與共用 sidebarFrame
orca-ui/layouts/                        後續，兩套 layout 的組合來源（存放形式於移交時定案）
orca-ui/themes/                         後續，主題來源（同上）
scripts/build-orca-ui.mjs               Node.js 建置工具
mods/orca-panel-head/                   第一批輸出，Herdr 從這裡載入 main.js
```

**開發時**用 JavaScript ES modules 編寫功能，以既有的 `herdr`、`gpui-kit`、`gpui-base` API 繪製原生畫面。**建置時**由 Node.js 標準函式庫讀取組合，複製 JS、SVG、PNG、manifest 與腳本，保留執行位元，並在 layout 移交後輸出 JSON。**執行時** Herdr 依 `content.mod` 或 command／overlay 選擇已安裝的 mod，由 `content.props` 指定角色。每個 mod 以相對 import 載入同目錄內的程式；跨 mod 的動態狀態沿用 `shared()`、`setShared()`。這條路徑只需要 Node.js builder，無須另設前端 bundler。

**不引入 bundler 有實測依據。** 用 `vite-plus@1.7.0` 的 `vp pack`（tsdown 0.23.4／rolldown 1.2.19）打包 `orca-panel-gap`、`orca-agents`：runtime JS 從 35,680 bytes 降到 19,824（未壓縮）或 14,232（壓縮），但節省大半來自刪掉註解；連同外部 map，發布量從 39,341 增到約 75–79 KB（僅測 2 個 mod，未量啟動時間）。Herdr（herdr-app 0.1.17，QuickJS）不讀外部 source map；inline map 只在 `check` 做過一次單點測試，同樣被忽略。`check` 與視窗錯誤卡片只報產物座標，打包後必須另做離線解碼才能回到原始碼。解碼時要先把 Herdr 回報的 UTF-8 byte 欄換成 UTF-16 欄，否則含非 ASCII 的長行（例如壓縮後的單行 bundle）會解到錯誤位置：`orca-agents` 壓縮版實測解成第 459 行，真值是 457。依現行規則 mod 只能 import 自己資料夾（見 `sync-shared.mjs`），打包仍把共用 helper 內嵌到每個 mod，不會去重。因此維持複製式 builder。評估規格見 [plan-orca-bundler-evaluation.md](plan-orca-bundler-evaluation.md)，證據與 `replay.sh` 在本機 `artifacts/orca-bundler/20261123T160756Z/`（不入版控）。（Opus 5.5 審查，Sonnet 5.5 high 實測）

**從 Herdr 報錯回到來源。** 以 herdr-app 0.1.17、hc 0.1.22 實測於隔離測試實例，Herdr 升版後要重驗（`artifacts/orca-bundler/20261123T160823Z-window/`）：

| 錯誤時機 | 哪裡看得到 | 回報內容 |
|---|---|---|
| 載入（模組頂層 throw） | `herdr-app check`、`herdr-app status` 的 errors、整個視窗的紅字 | `…/mods/<mod>/main.js?v=1:行:欄`，行精確；欄是 UTF-8 byte 位置，指向出錯的詞（`new X` 的 X、被呼叫的函式名、讀屬性失敗的物件、未定義的變數），不是 `throw`；丟出非 Error 的值沒有座標 |
| render | `herdr-app check` 與視窗內錯誤卡片（含 Copy details）；**`status` 的 errors 是空的** | 完整 stack，例如 `panel-motion.js?v=1:23:13` → `main.js?v=1:40:37` |
| 點擊等事件 | 未驗證：`herdr-app commands` 沒有能合成點擊的指令 | 未知 |

回報路徑都是已部署的產物。AI 不打開它：把錯誤文字交給 `node scripts/where-error.mjs`（例如 `herdr-app check mods/<mod> 2>&1 | node scripts/where-error.mjs`），它依 manifest 與 `sync-shared.mjs` 的 `USES` 印出要改的來源檔與行，以及擁有它的 `app.mjs` 條目、測試、layout 與下一跳；`sync-shared.mjs` 已把生成檔頭移到副本最後一行，共用 helper 副本的行號與 `shared/` 原件相同；未遷移的 mod 會標明「原地修改」。`app.mjs` 開頭與 README 都寫明這個入口，之後每批新增 manifest 就自動涵蓋，無須另維護對照表。實測：codex（gpt-6-luna，low）在暫存副本模擬載入、共用 helper render、已遷移功能三種錯誤，`where-error.mjs` 都指到正確的來源檔、行與欄（`artifacts/orca-bundler/20261123T162528Z-retest/codex-where-error-2/`）。（Opus 5.5 審查，Sonnet 5.5 high、Haiku 5.5 medium 實測）

例如左側欄移交後，builder 將一份 `features/sidebar/sidebar-frame.js` 發到 `mods/orca-nav/sidebar-frame.js`、`mods/orca-spaces/sidebar-frame.js`、`mods/orca-chrome/sidebar-frame.js`。三個執行期入口各自 `import { sidebarFrame } from "./sidebar-frame.js"`。AI 改共用外框只需編輯一份來源；若改的是展開動畫，則沿側欄組合連到 tabs 的 native drawer。

以下命令已隨第一批實作，從 repo 根目錄執行。

```sh
staging=$(mktemp -d)
node scripts/build-orca-ui.mjs --out "$staging"   # 在空目錄重建本批產物
node scripts/build-orca-ui.mjs --out .            # 更新 repo 內本批受管產物
node scripts/build-orca-ui.mjs --check --out .    # 唯讀比較，漂移時列出來源及目的檔並回傳非零
```

產物由來源單向生成。在空目錄建置時，builder 必須能在已遷移的 `mods/` 產物完全缺席時重建它們。`--check` 才需讀既有產物來核對路徑集合、內容與 Git 檔案模式。寫入 repo 前若發現目的檔有來源無法解釋的修改，列印該 diff 並中止寫入，由人移植後重跑。（mimo-2.6-pro high）建置只寫指定的暫存目錄或 repo；同步到使用中的 `~/.config/herdr-app/` 是另一步，依 dev-sync 逐檔核對。

**受管範圍由 manifest 決定。** 每批的 manifest 列出受管產物檔、來源、測試路徑與 layout slots；空目錄建置只產生 manifest 內的檔案，其餘 mod、兩套 layout 與設定仍由現行手寫檔負責。builder 的 descriptor 至少宣告 mod 名稱、輸出清單、資產來源、測試路徑、layout slots 與 commands／shared keys，並定義 `--check` 退出碼（0 相符、1 漂移或模式不符、2 用法錯誤）。（buffy deepseek-v4.1-flash high）

八個共用 JS 與側欄同批移交 builder，`sync-shared.mjs` 於該提交改為呼叫 builder 或移除，`mods/` 不得同時有兩個寫入者；在移交前它們仍由 `sync-shared.mjs` 寫入，builder 的 manifest 不得列出這些目的檔。三個設定檔是 seed-once／merge-only：builder 只讀，安裝器只在檔案不存在或使用者同意合併時寫入，不得覆蓋已編輯的檔案，也不得把 `--dangerously-*` 旗標寫進原本沒有的設定。`herdr-app check` 會寫出 `gpui-kit.d.ts`／`jsconfig.json`，因此排在 `--check` 之後，或只在暫存副本執行。（buffy deepseek-v4.1-flash high）

## 實施順序與驗收

1. **建立基準與隔離。** 用盤點清單（歷史 Task 1）涵蓋 24 個 mod，區分 Orca、第三方與 host 入口。歷史版本 `f2736b9` 留作參照，每批對照已整合當時 main 的父提交。在第一次執行 Node 測試前攔截 statusline 的 Herdr CLI；視窗測試另用空任務清單、暫存 HOME，先確認控制指令及 core 指向測試實例。實測可行的做法是 `env -i` 加暫存 `HOME`／`HERDR_APP_HOME` 與獨立 `HC_SESSION`，再用 `lsof` 確認 app 與 core 的 socket 都在暫存目錄。兩個已知漏洞：暫存 HOME 內沒有 core 時，app 不會自動安裝（只對 `releases.herdr.dev/app/latest.json` 做一次版本檢查），視窗也不回應指令，所以要先把已安裝的 core 複製進暫存 HOME；core 經 launchd 啟動後仍是真實 `HOME`，不帶 `OMP_`／`PI_` 變數，所以 mod 的 `exec` 子程序沒有憑證隔離，會呼叫 `exec` 的 mod（如 `orca-agents`）不得掛進測試實例，直到 core 環境也能隔離。`herdr-app check` 同樣會真的執行 mod 的 `exec`（子程序拿到傳給 `check` 的 HOME），且 `check` 結束時不等子程序跑完，對這類 mod 也要用暫存 HOME，不能靠 `check` 提早結束來擋。（Opus 5.5 審查，Sonnet 5.5 high 實測）記錄測試名稱與失敗原因，納入 [Stage 9 實測結果](../implementation_readiness_report.md)。

   盤點 `keys.json` 時逐條記錄 scope 與生效 layout：`layout:<name>` 只對同名 layout 生效，`layout:orca` 的 35 條在 `orca-unified` 不生效，unified 只繼承 `global`、`terminal`。隔離清單沿用 Review notes 的 P0：暫存 `HOME`、cache 與 Git fixtures，以假 executable／固定資料取代網路與本機 CLI，停用真實排程，跑完斷言測試根目錄外沒有檔案或 repo 被改動。基準原本有 16 個既有失敗（15 個效能探針、1 個 `titlebar-height.test.js` 的 `ReferenceError`），已修成全綠（現為 428／428），expected-failure 清單目前為空；每批跑 `node --test mods scripts orca-ui/features` 時，數量與名稱不得增加。（buffy deepseek-v4.1-flash high）
2. **移交第一個功能。** 把 `orca-panel-head` 的現有檔案逐檔對應到 `features/panel/head/`。首次保留該 mod 交付給 Herdr 的檔案位元組與 Git 模式；測試去向見下段，搬動時另列允許差異（只限路徑常數），並驗證搬前搬後跑的是同一組案例。（mimo-2.6-pro high）追蹤搜尋的最後一步時，入口暫時連到仍手寫的 `mods/orca-files/main.js`。同一提交更新 README、dev-sync skill 與測試發現路徑，讓下一位 AI 一開始就走對流程。

   測試去向在本批就定案：來源測試搬到 `features/panel/head/` 並改寫由 `mods/<mod>/` 出發的相對定位（現為 `./panel-views.js`、`../scripts/gpui-stub-loader.mjs`、`../../keys.json` 這類路徑），或留在 `mods/` 產物旁由產物側測試執行；README 提供單一指令（例如 `node --test mods scripts orca-ui/features`），並註明產物側測試從暫存安裝樹跑。`mods/keys.test.js` 不屬於任何 mod，隨 `keys.json` 留在 repo 根目錄或移到 `orca-ui/`，不得被「一 mod 一目錄」默默漏掉。（buffy deepseek-v4.1-flash high）
3. **驗證 builder，再逐批擴大。** 從兩個空目錄獨立建置，逐檔比對；刻意漏檔、多出未宣告檔案、篡改內容或移除執行位元時，檢查必須失敗。host 寫入的 `gpui-kit.d.ts`、`jsconfig.json` 不入版控，也不列入路徑集合比對。`herdr-app check` 排在比對之後，或只在另一份一次性副本執行。（mimo-2.6-pro high）兩套 layout 初次移交保留原始位元組，改由程式組合時才允許這兩檔改排版，解析後分別與父提交的整棵樹全等。同步移交 `titlebar-height.py` 的寫入責任。每批在實際產物跑受影響的 unit／render 測試，缺快照須失敗。過期探針的修復範圍含 `titlebar-height.test.js` 的 tab-padding 案例（擷取的運算式含未綁定的 `unified`）與效能 `replace_once` 針（與 `render(cx) → renderBody` 重構脫節）；兩者已修成全綠，任一回歸都算這批退化，不是基準瑕疵。（mimo-2.6-pro high）

   Layout 差異即規格，逐項指定由哪個組合參數產生：`cloned_from`、`under` wrapper、側欄 `min`（220／0）與背景（`chrome`／`surface`）、unified 無 `brand`、tabs 的 `unified`／`motion`／`pinSidebarTerminal`；`scripts/layout.test.js` 同時斷言兩套 layout 的節點集合、順序與否定條件（unified 不得出現 `brand`）。`titlebar-height.py` 在 layout 移交前先改成依 layout 使用不同期望節點集（unified 無 `brand`），提供 `--check`／`--root`，預設不寫 live。（buffy deepseek-v4.1-flash high）
4. **用新 AI 驗收可讀性。** 給未參與遷移的 AI 兩題：「改 Orca 的 Contents 搜尋快捷鍵」與「只改 unified 左側欄的原生動畫」。只給 README 作為起點，讓它沿組合與來源指出設定、發送端、接收端、layout 差異、該跑的測試及預期變動的產物。用實際建置差異及產物測試核對答案。第一批容許入口明示的未遷移來源；完整遷移後，任何一題若仍須翻找生成的 `mods/` 或猜測動作的接收端，就回頭修正入口。回復演練在暫存樹進行，第一批用父提交原檔，後續用對應版本的 builder。

   第一批已做小型對照（Haiku 5.5 medium，每格 2 次，證據在 `artifacts/orca-bundler/20261123T162528Z-retest/ab-comprehension/`）：A 為 main、B 為本分支、C 為 main 加一份只指向 `mods/` 原地檔案的 `app.mjs` 地圖。兩題（⌘⇧F 改成只聚焦、移除 Ports 按鈕與 ⌘⇧I）12 次全部改對，B 也都改 `orca-ui/` 來源並重建、`--check` 通過。B 用時最短（兩題平均 90／115 秒，A 為 148／142，C 為 130／183），但 A、C 基準帶 16 個既有失敗測試會拖慢它們，樣本也太小，只能說「新結構沒有讓 AI 改錯，也沒有明顯變慢」，還不能證明更好懂。完整遷移後用更難、跨多個未遷移 mod 的題目重做，並讓三組基準的測試狀態一致。（Opus 5.5 審查，Haiku 5.5 medium 實測）

   升級路徑另設 fixture：額外 mod、執行期資料與已修改的 `keys.json`、`settings.json`、`programs.json`，斷言自訂內容保留或進人工 diff，不得被 repo 預設覆蓋。快捷鍵驗收寫出預期結果：`orca` 的 ⌘⇧F 等 `layout:orca` 綁定在 unified 不生效，unified 只有 `global` 的 ⌘B 等可用。回復演練擴成「上一版安裝樹 → 新版 → 回上一版」，過程中確認使用者設定與執行期資料未被刪除或覆蓋。（buffy deepseek-v4.1-flash high）

   每批在測試實例執行受影響入口的冒煙案例（快捷鍵、按鈕、選單、overlay 各一），與基準比較 `herdr-app status` 的錯誤差異。render 錯誤不會出現在 `status`，所以每個受影響 mod 另跑 `herdr-app check`（在暫存副本），退出碼非 0 即判失敗（render 時丟出錯誤實測回傳 1）。`check` 只用預設 props 畫一次，依 props 或狀態才走到的畫面另存 `shot`，確認沒有「This view could not be rendered」卡片；點擊類動作在找到可合成點擊的方式前，由人手動點一次並記錄結果。完整遷移後通過 24-mod 入口矩陣（歷史 Review notes 的 P1 併入此步），每個 mod 至少驗證實際掛載或由指令／overlay／pane 開啟、主要動作與關閉。（mimo-2.6-pro high）會呼叫 `exec` 的 mod 在 core 環境能隔離前不掛進測試實例（見步驟 1），矩陣中這些列改用暫存 HOME 的 `herdr-app check` 加 fixture 資料的 render 測試驗收，並標明「未在視窗驗證」。（Opus 5.5 審查，Sonnet 5.5 high 實測）

## 補審紀錄與待決事項（mimo-2.6-pro high）

本輪 goldfish 審查由兩個獨立上下文的唯讀審查者分頭進行（實作準備度、程式碼核對），合併報告見 [`goldfish_review_report-2.md`](../goldfish_review_report-2.md)；DeepSeek（buffy）的 single-context 補審見 [`goldfish_review_report.md`](../goldfish_review_report.md)。本輪驗證補充：`node --test mods scripts orca-ui/features` 實跑 428／428 全綠（以 PATH 替身攔截 `herdr-app`，仍攔到 3 次 `do orca-status.refresh`，故 Task 1 的隔離必須早於第一次跑測試）。

- **已修正（本輪）**　手改處置改為列印 diff 並中止；`--check` 補上多出未宣告檔案的失敗案例，`gpui-kit.d.ts`／`jsconfig.json` 不入比對；測試搬動的允許差異限定路徑常數；形狀清單補上 layout 與主題來源；探針修復範圍補上 `titlebar-height.test.js` 的 tab-padding 案例；每批入口冒煙與 24-mod 入口矩陣併入驗收；「Task 1」的懸空引用改指歷史任務。
- **已決：`skillshare` 的性質。**　擁有者確認它是本機 app 上的工具介面，屬 repo 自有 mod，沒有 vendored 上游；與 README、dev-sync skill 的記載一致。遷移時與其他 Orca mod 同等處理，「保留上游來源」與歷史 Task 1 的「保留第三方來源」不再適用。
- **已決：`layout:orca-unified` 先不補建快捷鍵區段（A 案）。**　遷移的驗收是「產物與基準行為相同」，途中新增 unified 快捷鍵會改變行為，讓差異無法歸因。遷移期間只文件化 `layout:orca` 的 35 條不作用於 unified；全部遷移並通過驗收後，再以獨立功能變更補建 `layout:orca-unified`（B 案），屆時單獨驗收快捷鍵。（Opus 5.5 代擁有者決定）

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
