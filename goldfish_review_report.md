# Goldfish 審查報告：`docs/plan-orca-ui-package.md`

- 審查對象：`docs/plan-orca-ui-package.md`（套用前 131 行；本文所有行號均指套用前的版本，套用後為 146 行，commit 未指定、以工作區現檔為準）
- 審查者：buffy（DeepSeek V4.1 Flash, high）
- 審查方式：**single-context approximation**。此 CLI 沒有可用的 subagent 工具，無法獨立開代理；以下兩趟由同一 context 依序完成，並未由不同代理交叉驗證。
  - Pass A（readiness）：只讀計畫本身，檢查可執行性、缺步驟、未定義介面、驗收矛盾。
  - Pass B（codebase）：逐條回到 repo 檔案核對計畫對現況的描述。
- 未執行任何計畫內容；未修改任何原始碼或計畫。
- 經使用者授權（「你來讀」）讀取專案外的 `~/.config/herdr-app/AGENTS.md` 與 live `keys.json`／`layouts/`，只用來裁決 E1；沒有改動任何 live 檔案。

## 已驗證成立（不列為 finding）

| 計畫主張 | 驗證方式 | 結果 |
|---|---|---|
| 24 個 mod、24 個 `mod.json` | `ls mods/*/mod.json \| wc -l` | 24 |
| 24 個 `main.js` 合計約 15,352 行 | `wc -l mods/*/main.js` | 15,352 |
| Herdr App 0.1.16 可做 `check`／`status` | `herdr-app --version`、`--help` | 相符 |
| `⌘⇧F` 經 `orca-panel-head.search` 開面板並切到 Files | `keys.json:102` → `panel-views.js` → `orca-files/main.js` | 相符 |
| Tasks 由側欄頁尾啟動 | `mods/orca-chrome/main.js:86` `layout.select main-tasks` | 相符 |
| 三個 `sidebarFrame` 目前完全相同 | 抽出三個函式本體比對 | 三段皆 1,014 字元、逐位元組相同 |
| render snapshot 只在 3 個 mod | grep `snapshot` | `agent-config`、`orca-agent-manager`、`orca-spaces` |
| 2 空格序列化：`orca.json` 不變、`orca-unified.json` 9,307→9,342 | 實測重序列化 | 相符 |
| 基準測試 408／424 | 隔離 HOME + `herdr-app` 替身重跑 | 16 個唯一失敗：15 個效能探針（`scripts/perf-spaces.py:80`）＋1 個 titlebar（`scripts/titlebar-height.test.js:36`） |
| `layout:<name>` 只對同名 layout 生效 | `~/.config/herdr-app/AGENTS.md:523-525` | 相符：`layout:orca` 不套用到 `orca-unified` |
| live `keys.json` 的 scope | 讀 live 檔（授權後） | 只有 `global`、`terminal`、`layout:orca`；live `layouts/` 已有 `orca-unified.json` |

## 無法從 repo 驗證（不臆測）

- `herdr-app check` 是否寫入 `gpui-kit.d.ts`／`jsconfig.json`（CLI 無唯讀模式；以 repo 內 skill 記述為據）。
- 真實視窗行為（未開視窗，僅用替身與既有測試）。E1 的結論由 host 的 `AGENTS.md` 條文推得，未實際按鍵驗證。

---

## ESCALATE（1 條，已讀 host 文件解決）

### E1 — `layout:orca` 只對 `orca.json` 生效，unified 沒有那 35 條 Orca 綁定（Major，已證實）

- **位置**：計畫第 15 行（左側欄表格）、第 26 行（「快捷鍵與全域預設」）、第 97 行（Task 5 驗收）。
- **證據**：
  - `~/.config/herdr-app/AGENTS.md:523-525`：「Sections: `global`, `layout:<name>` (while `layouts/<name>.json` shows), `terminal` …, `mod:<name>`. The more specific section wins: `layout:terminals` over `global`, `terminal` over both.」scope 名稱就是 layout 檔名，沒有家族或前綴匹配。
  - live `~/.config/herdr-app/layouts/` 同時有 `orca.json` 與 `orca-unified.json`；live `keys.json` 只有 `global`、`terminal`、`layout:orca`。
  - 因此顯示 `orca-unified.json` 時，`layout:orca` 不生效：`⌘⇧F`（repo `keys.json:102`）、`⌘L`（100）、`⌘⇧G`（103）、`⌘⇧I`（104）等 35 條全部失效；只有 `global` 的 `⌘B`（37）等 57 條可用。
  - repo 內沒有任何程式產生 `layout:orca-unified`：grep 只命中 `mods/orca-tabs/main.js:1041` 的註解與 layouts 檔；`mods/keys.test.js:9-14` 也只斷言 `keys["layout:orca"]`。
- **影響**：Task 5 的「在 `orca` 用 ⌘⇧F」正確，但「在兩套 layout 用按鈕與 ⌘B 切換側欄」之所以成立，只是因為 `⌘B` 是 global。計畫從未寫出「unified 沒有 Orca 快捷鍵」這個事實，Task 1 的盤點不會抓到，Task 3 產生 unified 時也不會處理。
- **決議：PROPOSE FIX（A／B 二選一，需你定產品意圖）**
  - **A（最小，只補文件）**：Task 1 加「記錄每條 Orca 綁定的 scope 與生效 layout，標明 unified 只繼承 `global`／`terminal`」；Task 5 加 unified 的預期結果。
  - **B（產品變更）**：Task 2／3 一併產生並安裝 `layout:orca-unified`（可鏡射 `layout:orca`），Task 5 驗兩套 layout 的同一組快捷鍵。
- **狀態**：verified（host `AGENTS.md` ＋ live 檔案）；B 的產品意圖未定，A 不依賴意圖。

---

## BLOCKER

### B1 — 「feature」的單位與檔案所有權未定義，Task 2 無法據此寫生成器（Blocker）

- **位置**：第 11 行（「入口按畫面組合兩套 layout」）、第 35 行（`features/panel/head/`）、第 43 行（`features/sidebar/sidebar-frame.js` 發到三個 mod）、第 79 行（「依畫面列出側欄、分頁…各功能的…放在對應的 `features/` 子目錄」）、第 85 行（抽出相同 `work-body`）。
- **證據**：
  - `layouts/orca.json` 的掛載是 mod 對畫面多對多：`orca-panel-gap` 4 個掛載點、`orca-chrome` 2 個（`footer` 與管理頁 `page`）、`orca-agent-manager` 2 個；右面板 `panel-body` 的 8 個子項分屬 8 個不同 mod。
  - 反方向也不成立：同一個畫面（側欄）由 `orca-chrome`、`orca-nav`、`orca-spaces`、`orca-tabs` 四個 mod 合組；同一個 mod（`orca-tabs`）同時提供分頁、側欄 drawer、面板切換與終端機選單（`mods/orca-tabs/main.js:422-429`）。
  - 第 43 行又要求「側欄功能」擁有一份要發佈到三個 mod 的 `sidebar-frame.js`，等於承認 feature 可以跨 mod，卻仍要 builder 產出完整的 `mods/<名稱>/main.js`。
- **為什麼是 Blocker**：若 feature＝畫面，一個 mod 的 `main.js` 由多個 feature 拼成，計畫沒說拼接規則、也沒說哪個 feature 擁有該檔；若 feature＝mod，則第 25 行「依畫面列出」與第 43 行「側欄功能」都得改寫。兩種讀法產生不同的 `features/` 目錄樹與不同的 builder，Task 2 第一步就卡住。
- **建議修正**：明確定義 feature 為「所有權單位」（預設一 feature 對一 mod 或多個 mod），畫面只是 `app.mjs` 上的分組視圖；跨 mod 共用碼（如 `sidebar-frame.js`）視為 helper，宣告「哪些 feature 依賴它、發佈到哪些路徑」。並加一條可檢查規則：「每個受管產物檔只有一個 feature 宣告為 owner」。
- **狀態**：verified（結構事實）＋ inference（計畫歧義）。

### B2 — Task 2 要求空目錄重建「原路徑的 mods/<名稱>」，與「第一批只移交 panel-head」衝突（Blocker）

- **位置**：第 59 行（Task 2：第一批或 `orca-panel-head` 逐檔對應）、第 80 行（「先在空目錄生成原路徑的 `mods/<名稱>/{mod.json,main.js}`、相依檔案、layout 與設定」）。
- **證據**：第 80 行沒有範圍限定詞；緊接的第 41 行說建置時要複製 manifest、JS、SVG、PNG、腳本並「在 layout 移交後輸出 JSON」。實際排序是 Task 2（mod）→ Task 3（layout）→ Task 4（sidebar 收斂）→ Task 5（驗收），全部 24 個 mod 從未在單一批次被要求移交。若 Task 2 真的要在空目錄重建全部 24 個 mod 與 layout，第一批就等於整批遷移，與 kimi 的垂直切片建議及第 59 行互相矛盾。
- **建議修正**：第 80 行改為「在空目錄生成**本批已移交**的 `mods/<名稱>/…`；其餘 mod 與兩套 layout 仍由現行手寫檔負責，未在本批 manifest 內」，並要求 manifest 明確列出「本批受管檔案」清單（同時解掉 kimi P0 的 managed-file manifest）。
- **狀態**：verified（文字衝突）。

---

## MAJOR

### M1 — 「沿用 `sync-shared.mjs` 現有複製規則」誇大現有工具能力；且 `mods/` 將有兩個寫入者（Major）

- **位置**：第 80 行（「用 Node 標準函式庫及 `scripts/sync-shared.mjs` 現有的複製規則」）、第 20 行（「每個路徑只有一個可編輯來源」）、第 25 行（「每個目的檔同時只由一支工具寫入」）。
- **證據**：`scripts/sync-shared.mjs` 的 `USES`（第 10–19 行）只列 8 個 `shared/*.js`；`copies()`（第 22–29 行）只讀 `shared/<name>`、加 JS 註解標頭、寫到 `mods/<mod>/<name>`；`stale()`（第 31–37 行）只比對這 8 類目的檔。它不處理 `mod.json`、`main.js`、SVG／PNG、layout、`settings.json`，也不保留執行位元。第 80 行把它當成可延伸的複製機制，會讓實作者低估工作量；真正可重用的只有「shared → mods、加標頭、`--check`」這個模式。
- **第二個問題**：新的 `scripts/build-orca-ui.mjs` 要寫 `mods/`，而 `sync-shared.mjs` 已經在寫 `mods/`。第 20／25 行只說「每個路徑只有一個可編輯來源」「每個目的檔同時只由一支工具寫入」，但沒有說 8 個共用 helper 之後歸誰：若 builder 接管，`sync-shared.mjs` 必須退役或改由 builder 呼叫；若不移交，`mods/` 就有兩個 generator，`--check` 會互指漂移。
- **建議修正**：第 80 行改成「重用 `sync-shared.mjs` 的 shared→mods 對應與 `--check` 模式，另寫 manifest／資產／layout 的複製」；第 20 行後補一句「8 個共用 JS 在 Task 2 一併移交給 builder，`sync-shared.mjs` 於同一提交改為呼叫 builder 或移除」。
- **狀態**：verified（讀過 `sync-shared.mjs` 全文，`--check` 目前 exit 0）。

### M2 — 測試搬進 `orca-ui/features/` 後的發現路徑與相對 import 沒有定義（Major）

- **位置**：第 106 行（Review note：「`node --test mods scripts` 不會自動涵蓋新的 `orca-ui` 測試」）、第 59 行（「遷入來源的測試調整對 repo 設定的定位時，另列允許差異」）。
- **證據**：repo 共 72 個測試檔，其中 67 個在 `mods/` 下（66 個 `mods/*/*.test.js` ＋ 1 個 root 的 `mods/keys.test.js`），5 個在 `scripts/`。既有 mod 測試直接以相對路徑載入受測檔與 stub：`./main.js`、`../../scripts/gpui-stub-loader.mjs`、`../keys.json`。搬到 `orca-ui/features/panel/head/` 後，這些相對路徑全部失效；而 `orca-ui/features/` 不在 `node --test mods scripts` 的參數內，也沒有任何自動發現機制會把它們納入。
- **計畫缺口**：只說「另列允許差異」，沒說 (a) 測試是「留在 `mods/` 產物旁」還是「搬到 features 並改寫 import」；(b) 搬走後誰負責在產物上再跑一次（kimi P1 要求產物側測試）；(c) 新的單一驗收指令長什麼樣。
- **建議修正**：Task 2 明確二者之一，並在 README／dev-sync 指定單一指令，例如 `node --test mods scripts orca-ui/features` 加上「產物側測試一律從暫存安裝樹跑」，同時列出需要改寫的 import 清單（`gpui-stub-loader`、`keys.json` 定位）。
- **狀態**：verified（檔案計數與 import 實際內容）。

### M3 — builder 只有三條命令，沒有輸入契約、descriptor schema、退出碼與 manifest 格式（Major）

- **位置**：第 45–51 行（預定命令）、第 34–38 行（介面路徑）、第 80 行。
- **證據**：計畫指定了 `--out`、`--check` 與「漂移時回傳非零」，但沒有說：`app.mjs` 要 export 什麼（kimi 建議 descriptor，但現行計畫未採納）、每個 feature 目錄的必要檔案與命名、`--check` 的退出碼語意（1＝漂移？2＝用法錯誤？）、是否支援 `--only <feature>`、manifest 檔名與排序、資產 hash 的基準。
- **影響**：Task 3 的「故意漏檔、篡改內容或移除執行位元，檢查必須失敗」無法寫成測試，因為「檢查」的行為未定義；Task 4 也無法說「只有預期的 mod 產物改變」。
- **建議修正**：在 Task 2 增列 descriptor 最小 schema（mod 名、輸出路徑清單、資產來源、測試路徑、layout slots、commands／shared keys）與 `--check` 的退出碼表；把這些放進 `implementation_readiness_report.md` 或計畫附錄，而不是只留三行 shell。
- **狀態**：verified（計畫缺漏）。

### M4 — 兩套 layout 的實質差異沒有列進 Task 3，生成器會漏掉 metadata 與 wrapper（Major）

- **位置**：第 85 行（「從兩套 layout 抽出相同的 `work-body`」）、第 87 行（Task 3 validation）。
- **證據**（逐節點比對）：
  - `layouts/orca.json:3-6` 有 `cloned_from {name:"main",version:"0.1.10"}`；`orca-unified.json` 沒有。
  - 側欄 `min`：orca 220、unified 0；側欄背景：orca `chrome`、unified `surface`。
  - unified 把 `sidebar` 與 `work-body` 包進額外的 `under` 節點，`tabs` 在其上；orca 沒有 `under`。
  - unified 沒有 `brand` 節點；`tabs` 多了 `unified`、`motion:"native"`、`pinSidebarTerminal`。
  - 這些都是「同一份組合、兩套輸出」必須表達的差異，但第 85 行只提到 `work-body`、`panel-body` 與標題列／側欄排列。
- **建議修正**：Task 3 加一段「差異清單即規格」：`cloned_from` 是否保留、`under` wrapper、`min`／背景、`brand` 缺席、tabs props，逐項指定由哪個組合參數產生；並要求 Task 3 的結構比對同時斷言「unified 不應出現 `brand`」這類否定條件。
- **狀態**：verified（兩個 JSON 實際內容）。

### M5 — `orca-unified.json` 目前零自動覆蓋，計畫卻沒有要求補（Major）

- **位置**：第 60 行（Task 3 validation 只說人工切換）、第 87 行。
- **證據**：`scripts/layout.test.js:5` 只讀 `../layouts/orca.json`；全 repo 沒有其他測試讀 `orca-unified.json`（grep 無命中）。`titlebar-height.py` 同理只處理 `orca.json`（第 21 行）。也就是說，unified 的結構一旦在生成時走鐘，現有測試全部不會紅。
- **建議修正**：Task 3 明列「新增 `scripts/layout.test.js` 對兩套 layout 的結構斷言（節點集合、順序、tabs props、`under` 包覆）並納入 CI／驗收指令」，而不是只靠 Task 5 的人工切換。
- **狀態**：verified。

### M6 — `settings.json`／`programs.json`／`keys.json` 被列為「設定」產物，但它們是全域且機器相關（Major）

- **位置**：第 26 行（「快捷鍵與全域預設」保留在 repo 根目錄）、第 80 行（生成「layout 與設定」）。
- **證據**：
  - `settings.json:9` `worktrees.directory: "~/git/herdr-my-orca.worktrees"` 是這台機器的路徑。
  - `programs.json:12` codex 帶 `--dangerously-bypass-approvals-and-sandbox`；第 15 行 claude 帶 `--dangerously-skip-permissions`。
  - `keys.json` 的 57 條 `global` 綁定會影響其他 layout；Orca 專屬的 35 條在 `layout:orca`。
- **問題**：第 26 行說「保留在 repo 根目錄」，第 80 行卻把它們列進「先在空目錄生成」的清單。若 builder 真的生成它們，就會用 repo 預設覆蓋使用者的 live 覆寫；kimi P0 已點出這點，但 Task 2 的文字沒有反映。另見 M8：`keys.json` 有自己的升級規則。
- **建議修正**：把這三個檔從「生成產物」移到「seed-once／merge-only」：builder 只讀不寫，或在首次安裝且檔案不存在時才寫；`--check` 只比對「repo 版」與 manifest 記錄的版本，不檢查 live。並在 Task 2 加註「不得把 `--dangerously-*` 旗標寫入原本沒有的使用者設定」。
- **狀態**：verified。

### M7 — `titlebar-height.py` 不能只「指向新來源」：unified 沒有 `brand`，斷言會直接丟例外（Major）

- **位置**：第 98 行（「將 `titlebar-height.py` 等會改寫產物的工具指向新來源」）、第 60 行（「同步移交 `titlebar-height.py` 的寫入責任」）。
- **證據**：`scripts/titlebar-height.py:21` 只掃 repo 的 `orca.json` 與 live `orca.json`；第 31–32 行對 `brand`／`tabs`／`panel-head` 做 assert。unified 沒有 `brand` 節點，改成掃兩套 layout 會在第一套就 `AssertionError`。它同時直接寫 live `~/.config/herdr-app`，與 kimi P1「一般執行與 `--check` 都要能指定 root」重疊但更嚴重：不是加參數就好，是斷言集本身要依 layout 分支。
- **建議修正**：Task 5 改成「依 layout 提供不同的期望節點集（unified 無 `brand`），新增 `--check`／`--root`，預設不寫 live；在 Task 3 移交 layout 前先讓它在 unified 上跑得過」。
- **狀態**：verified（腳本內容與 unified 結構）。

### M8 — `keys.json` 的交付方式與 Herdr 的升級規則衝突（Major）

- **位置**：第 26 行（「保留在 repo 根目錄」、保留 live 覆寫）、第 80 行（生成「layout 與設定」）。
- **證據**：`~/.config/herdr-app/AGENTS.md:512-515`：「On upgrade, an untouched keys file from an earlier release gets the current shortcuts. Any edit, even whitespace, keeps the entire file as yours; new default shortcuts must then be added by hand.」Herdr 本身把 `keys.json` 當使用者檔案，只有完全未改過才補新預設。
- **問題**：installer 若用 repo 的 `keys.json` 覆蓋 live，會抹掉使用者任何編輯（連空白都算），直接違反第 26 行；若遵守 Herdr 規則只在使用者未改過時覆蓋，那麼本計畫新增的 Orca 綁定（含 E1 選項 B 的 `layout:orca-unified`）永遠到不了已編輯過的使用者，而計畫沒有 merge 或提示步驟。
- **建議修正**：Task 2 明寫 `keys.json` 為 seed-once；Task 5 的升級 fixture 加入「已編輯的 `keys.json`」，斷言不被覆蓋，並要求 installer 列出缺少的 Orca 綁定供使用者自行加入（或提供可審核的 merge），不得靜默覆蓋。
- **狀態**：verified（host 文件）。

### M9 — Task 1／Task 5 沒有吸收 Review notes 的 P0，也沒有安裝／升級／回復步驟（Major）

- **位置**：第 58 行（Task 1：只用暫存 HOME＋攔截 CLI）、第 97 行（Task 5：只用暫存 `HERDR_APP_HOME`）、第 103–104 行（kimi P0 要求暫存 HOME、cache、Git fixtures、managed manifest）。
- **證據**：Task 1 說「視窗測試另用空任務清單、暫存 HOME」，但 Task 5 的操作段落只提 `HERDR_APP_HOME`；Tasks 全文沒有任何一節在做「安裝到 live／升級／rollback 不覆蓋使用者設定」的驗收（kimi P0 第二項）。Task 5 的回復演練只在暫存樹重建，沒有驗證「升級既有安裝」這條路徑。
- **建議修正**：Task 1 直接引用 P0 的隔離清單；Task 5 新增一段「升級 fixture：額外 mod、執行期資料、已修改的三個設定檔，斷言保留或進人工 diff」，並把回復演練擴成「上一版安裝樹 → 新版 → 回上一版」。
- **狀態**：verified（Tasks 與 Review notes 文字）。

---

## NIT

### N1 — `herdr-app check` 會寫 `gpui-kit.d.ts`／`jsconfig.json`，時序要指定（Nit）

- **位置**：第 60 行（「對輸出副本執行 `herdr-app check`」）。
- **證據**：`.agents/skills/herdr-app-dev-sync/SKILL.md:16` 明說這兩個檔由 `herdr-app check` 寫出。若在 hash／`--check` 之前跑，會多出未宣告檔案。
- **建議**：指定順序「先 `--check` 比對，再 `check` 載入驗證」，或在暫存副本跑；`--check` 的白名單要排除這兩個檔。
- **狀態**：verified（skill 文件），host 行為未實測。

### N2 — `mods/keys.test.js` 在「一 mod 一目錄」模型下沒有家（Nit）

- **位置**：第 79 行（feature 子目錄對應 mod）。
- **證據**：`mods/keys.test.js` 是 root 層測試，讀 `../keys.json`，不屬於任何 mod；24 個 mod 目錄都沒有它。
- **建議**：在 Task 2 指定它隨 `keys.json` 留在 repo 根目錄或移到 `orca-ui/`，不要讓「每個 mod 一個目錄」的規則默默漏掉它。
- **狀態**：verified。

### N3 — 基準的 16 個既有失敗沒有寫成 expected-failure baseline（Nit）

- **位置**：第 58 行（Task 1 記錄測試結果）、第 93 行（Task 4 跑 `node --test mods scripts`）。
- **證據**：基準 408／424，16 個唯一失敗：15 個效能案例卡在 `scripts/perf-spaces.py:80` 的 fixture 斷言（`Probe needs updating`），1 個 `scripts/titlebar-height.test.js:36` `ReferenceError: unified is not defined`。計畫只說「記錄測試名稱與失敗原因」，Task 4 卻把同一條命令當成通過條件。
- **建議**：Task 4 明寫「允許的既有失敗清單見 Stage 9；數量與名稱不得增加」，或先把這 16 個修掉再當 gate。
- **狀態**：verified（實跑）。

### N4 — 沒有 LICENSE／NOTICE，與「skillshare 保留第三方來源」的假設綁在一起（Nit）

- **位置**：第 27 行（第三方與執行期資料）。
- **證據**：repo 根目錄無 `LICENSE`／`NOTICE`；`mods/skillshare/` 的來源與授權只存在註解與 git 歷史。kimi 已建議補 pinned vendor 來源與 NOTICE，計畫正文未採納。
- **決議**：**DECLINE** — 這是 kimi 已提出的建議，屬「是否要做授權合規」的產品決策，不是本計畫的實作缺口；硬加進 Task 2 會擴大範圍。若你要做，另開一張 task。
- **狀態**：verified（檔案不存在）＋ 刻意不修。

### N5 — Task 5 的側欄動畫驗收應指明 layout／props（Nit）

- **位置**：第 97 行、第 60 行。
- **證據**：`mods/orca-tabs/main.js` 的 `toggleSidebar()`（573–577）在非 unified 走 `layout.toggle`；unified＋`motion:"native"` 才走 native drawer，`sidebarEase` 只在前者被使用（607）。只改 easing，兩套預設 layout 都不會經過該呼叫點（Codex 已在第 129 行指出）。
- **決議**：**DECLINE** — Codex 的接續判斷已給出更具體的做法（改 unified 原生時鐘 transition），計畫第 129 行已涵蓋；重複列成 finding 只會稀釋。建議把 Codex 那句升格進 Task 5 條文即可（屬編輯，不是新發現）。
- **狀態**：verified，已由他人涵蓋。

---

## 建議的計畫修改（僅提案，尚未套用）

以下文字比照計畫風格，署名標示作者與投入。**已於 2026-11-23 套用**（使用者授權技術細節由 buffy 決定）。

套用時的落點調整：計畫已宣告「本節到實施順序與驗收是現行計畫，文末保留原文」，所以條文改寫進**現行計畫**的對應步驟（原 Task 1→步驟 1、Task 2→步驟 2、Task 3→步驟 3、Task 5→步驟 4）與設定列，**歷史 Tasks 原文未動**，以保留各作者署名。

**E1 選 A**（文件化，不改行為）：遷移計畫不順帶替 unified 新增 35 條快捷鍵；那要另開一張產品變更。

**Task 1（第 75 行後）插入：**

> - 盤點 `keys.json` 時逐條記錄 scope 與生效 layout。`layout:<name>` 只對同名 layout 生效，因此 `layout:orca` 的 35 條在 `orca-unified` 不生效；unified 只繼承 `global`、`terminal`。把這項差異寫進基準，避免把它當成 bug 或漏掉驗收。（buffy deepseek-v4.1-flash high）

**Task 2（第 80 行後）插入：**

> - 明確定義 feature 為檔案所有權單位：一個受管產物檔只有一個 owner；畫面只是 `app.mjs` 的分組視圖。跨 mod 共用碼（如 `sidebar-frame.js`）在 feature 宣告依賴與發佈路徑，不另外建立「畫面 feature」。第一批只生成本批 manifest 內的檔案，其餘 mod 與 layout 仍由手寫檔負責。（buffy deepseek-v4.1-flash high）
> - 在 Task 2 交出 descriptor 最小 schema 與 `--check` 退出碼；`--check` 在漂移、缺檔、模式不符時回傳非零並列出來源與目的檔。（buffy deepseek-v4.1-flash high）
> - 8 個 `shared/` JS 於同一提交移交 builder；`sync-shared.mjs` 改為呼叫 builder 或移除，`mods/` 不得同時有兩個寫入者。（buffy deepseek-v4.1-flash high）
> - `keys.json` 列為 seed-once：只在檔案不存在時寫入，或在使用者同意後合併缺少的 Orca 綁定；不得覆蓋使用者已編輯的檔案（Herdr 對未修改過的檔案才會自動補新預設）。（buffy deepseek-v4.1-flash high）

**Task 3（第 86 行後）插入：**

> - 兩套 layout 的差異即規格，逐項指定來源：`cloned_from`、`under` wrapper、側欄 `min`／背景、unified 無 `brand`、tabs 的 `unified`／`motion`／`pinSidebarTerminal`。`scripts/layout.test.js` 同時斷言兩套 layout 的節點集合、順序與否定條件。（buffy deepseek-v4.1-flash high）

**Task 5（第 97 行後）插入：**

> - 升級 fixture 要含額外 mod、執行期資料與已修改的 `keys.json`、`settings.json`、`programs.json`；斷言自訂內容保留或進人工 diff，不得被 repo 預設覆蓋。這三個檔列為 seed-once／merge-only，不列入 builder 產物。（buffy deepseek-v4.1-flash high）
> - `titlebar-height.py` 依 layout 使用不同期望節點集（unified 無 `brand`），提供 `--check`／`--root`，預設不寫 live。（buffy deepseek-v4.1-flash high）
> - unified 的快捷鍵驗收要寫出預期結果：`layout:orca` 的 `⌘⇧F` 等不生效，只有 `global` 的 `⌘B` 等可用；若採 B 案新增 `layout:orca-unified`，則兩套 layout 跑同一組按鍵。（buffy deepseek-v4.1-flash high）

---

## 處置結果（2026-11-23，已套用）

| ID | 決議 | 落點（`docs/plan-orca-ui-package.md`） |
|---|---|---|
| E1 | PROPOSE FIX，採 A | 「快捷鍵與全域預設」列、步驟 1 第二段、步驟 4 第二段 |
| B1 | PROPOSE FIX | 「Feature 是檔案所有權的單位」段 |
| B2 | PROPOSE FIX | 「受管範圍由 manifest 決定」段 |
| M1 | PROPOSE FIX | 同段之後的「八個共用 JS…」段 |
| M2 | PROPOSE FIX | 步驟 2 第二段 |
| M3 | PROPOSE FIX | manifest／descriptor 段（含 `--check` 退出碼） |
| M4 | PROPOSE FIX | 步驟 3 第二段 |
| M5 | PROPOSE FIX | 步驟 3 第二段（`layout.test.js` 斷言兩套） |
| M6 | PROPOSE FIX | 設定列 ＋ seed-once／merge-only 段 |
| M7 | PROPOSE FIX | 步驟 3 第二段（`--check`／`--root`、unified 無 `brand`） |
| M8 | PROPOSE FIX | 設定列、seed-once 段、步驟 4 第二段（已編輯 `keys.json` fixture） |
| M9 | PROPOSE FIX | 步驟 1 第二段（P0 隔離清單）、步驟 4 第二段（升級／回復） |
| N1 | PROPOSE FIX | seed-once 段末（`herdr-app check` 排在 `--check` 之後） |
| N2 | PROPOSE FIX | 步驟 2 第二段（`mods/keys.test.js` 去向） |
| N3 | PROPOSE FIX | 步驟 1 第二段（16 個 expected failure） |
| N4 | DECLINE | 無（授權合規是獨立產品決策） |
| N5 | DECLINE | 無（Codex 段已涵蓋；屬編輯而非新發現） |

未做：歷史 Tasks 原文、Review notes 原文、`implementation_readiness_report.md`。若要把 E1 的 B 案（新增 `layout:orca-unified`）付諸實作，應另開一張產品變更，因為它會改變 unified 的操作行為，並需要 M8 的可審核 merge。

## 後續落地（2026-11-23）

審查後的第一批實作，把計畫前三個步驟變成可跑的東西：

- 基準從 408/424 修成 428/428。`scripts/perf-spaces.py` 的 render 錨點跟上 `render` → `renderBody` 拆分；`titlebar-height.test.js` 補上程式已依賴的 `unified` 參數，並新增 unified 分支案例。
- `scripts/build-orca-ui.mjs`：讀 `orca-ui/features/**/manifest.json`，空目錄只產生 manifest 列出的檔案，`--check` 比對位元組與檔案模式，退出碼 0 相符、1 漂移、2 用法錯誤；未列進 manifest 的來源檔會直接報錯。
- `orca-ui/features/panel/head/` 與 `orca-ui/app.mjs`：右面板標題列是第一個受管 feature，`mods/orca-panel-head/` 由 builder 逐位元組重建；兩個測試搬到來源旁並改寫 `keys.json` 的相對定位。
- `scripts/layout.test.js` 改為同時斷言兩套 layout（unified 無 `brand`、有 `under`、`min` 0、`surface`、tabs props）；`scripts/titlebar-height.py` 依 layout 分支節點集，新增 `--root`／`--write-live`，預設不寫 live。
- README 與 dev-sync skill 補上「manifest 內的 `mods/` 檔案從 `orca-ui/` 改，build 後再同步」的規則。
