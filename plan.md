# Herdr ↔ Orca UI 操作與元素一致性計畫

## 2026-11-20 修復與交付補記

真實 GitHub 驗證：已在獨立私人測試 repo 對已推送分支建立 draft PR，驗證 repository ID、head、base 與 draft 狀態；沒有使用 Herdr 的實際 dialog。測試 repo 因原 gh token 缺少 delete_repo scope 曾遇到 403；完成臨時授權後已刪除，GitHub 以 404 確認，臨時登入檔已清除。

合併預演：將目前 Orca 程式碼與必要測試放入臨時 Git index，與 main 進行隔離合併後，178/178 測試及 orca-changes、orca-files、orca-worktree 模組檢查通過。此預演未修改分支或現有 index；不包含臨時 HTML、stock worktree 修改及未追蹤文件。Create PR 真實送出、UI 焦點／滾動、Push 與 worktree 安全移除仍未完成，因此尚未提交合併。

驗證補記：`node --test` 181/181、`git diff --check` 與 10 個 mod 載入檢查通過；Herdr 目前畫面可見 Explorer 且 status 無錯誤。Create PR 在隔離本地 repo 中以真實 Git/gh 對現有 GitHub 分支做唯讀確認，head、default base 和 repository ID 取得成功；預設分支正確拒絕。另在臨時 Git repo 實際製造衝突，執行 resolveConflict 成功 stage；未建立真實 PR，亦未驗證 Herdr 實際鍵盤焦點／捲動與遠端 mutation。

- Duplicate 建立目標失敗時不再刪除目標；複製失敗可能留下不完整檔案。
- Worktree remove 的 ignored 檔案檢查與刪除之間仍可能競態，因此目前在介面及底層停用移除；建立 worktree 不受影響。
- Explorer 改用 `VirtualListScrollHandle`，將焦點與鍵盤事件移至容器；模組載入檢查通過，實際視窗互動尚未驗證。
- Create PR 已重新實作：僅 GitHub.com、非 fork、同 repo 已推送的 upstream branch，使用 GitHub repository ID 和已確認的 default base；尚未做真實 GitHub 建立 PR 或視窗互動驗證。Push 等仍停用；這不是 Orca UI 全面對齊或 HTML 外觀的實作。其他非原子檔案操作、遠端與 editor 草稿限制仍待驗證。
- Orca 的 worktree 對話框改用 `orca-worktree`，避免覆蓋 Herdr 重啟時會還原的內建 mod。衝突解決固定 workspace/host 並停用會強制刪檔的 keep-deletion。


> 更新註記：本次新增／修正的調查與工作項目標示為 `created from <gpt-6.1-terra::high>`。這是規劃來源，不代表程式已實作或驗收通過。既有 `handoff.md` 是前一輪取樣紀錄；與本檔衝突時以本檔為準，實作前仍須重新查證。

## 實作交接（2026-11-20）

**狀態：進行中，尚未達到任何整個工作包或本計畫的驗收。** 請接手者先讀本節與 `parity-progress.md`，再依下方原工作包逐項繼續；不要把已執行的 unit／隔離 Git 測試當成 UI parity 驗收。

- 工作目錄：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/align-orca`，分支 `feat/wt-align-orca`，HEAD `1860df301e4afeeea884646c88642b599f7d8200`；Orca `/Users/tonyyang/git/orca` HEAD `30d56bd62b00f2432489f589aab15af9aa695fb1`；Herdr `0.9.5`。本 worktree 有大量**未提交和未追蹤**的本次實作與測試；`plan.md` 在實作開始前已有使用者修改，請勿 reset、覆蓋或只看 `git diff --stat` 而漏掉 untracked 檔案。Orca 工作樹本次查詢為乾淨。
- 使用者要求：檢查與測試請使用 `gpt-6-luna`、`high` 子代理；僅在暫存目錄／隔離 repo 測試，不能操作使用者真實 repo、remote、terminal session 或搶桌面焦點。之前的權限拒絕是歷史紀錄，若重試依當前權限判斷；不可繞過實際拒絕。
- **已做、僅部分驗證**：Explorer 不再顯示無效快捷鍵；新增／改名／複製／刪除有 workspace/host、名稱、路徑、symlink 等檢查，duplicate 失敗會清掉不完整檔，editor 寫入序列化並保留失敗的記憶體草稿；Source Control discard 固定目標、核對 index/內容、literal pathspec；diff 支援無 HEAD、staged/unstaged/untracked、截斷提示、特殊檔名與過期請求；Changes、Staged 各自的 `View all` 已新增，使用 section paths 而非 net `all`；worktree remove 已加 dirty/untracked/submodule/detached/unborn gating、target 固定與 linked-only 檢查；worktree create 拒絕前導 `-`、slug 為空與既有路徑衝突並有隔離 repo 測試；activity bar gating 抽為 `panel-gating.js`，worktree 純函式抽為 `helpers.js`。**M2 已完成 keymap 對齊**：`layout:orca` 的 `⌘1–9` workspace、`⌃1–9` tab、`⌘]`/`⌘[` pane focus、`⌘⇧↑/↓` workspace prev/next、`⌘⇧E/F/G/I` 右欄 view（經 `panel-views.js` bridge）、`⌘L` 右欄開關、`⌘R`/`⌘⌥R` rename；agent next/prev 移至 `⌘⌥⇧]`/`[`。**M4 已加 Explorer 鍵盤**：↑↓/Home/End/PageUp/Down、→/← 展開收合與父項、Space、Enter rename、Delete 確認、`⌘⌥C`/`⌘⌥⇧C` 複製路徑。具體檔案、例外與未驗項見 `parity-progress.md`。
- **特別注意：目前功能有意暫停**：Push、Commit & Push、Force Push、Sync、Publish、Rebase、Push & Create PR 在 Source Control menu 標為 unavailable；Create PR 僅對已推送的 GitHub.com 同 repo upstream 啟用。Push/force 的 target/lease 實作與測試仍在 `mods/orca-changes/push-target.js`，但 Herdr `exec` 目前只提供 `cwd/on/timeout`，不能把確認後 URL 安全固定給 Git；remote 名稱在最後檢查後仍可能改指其他 URL。完整安全恢復需獨立評估 host env/stdin 或其他能力、Git `insteadOf` 與 remote transport 設定，不要僅重新啟用或把憑證直接放進 argv。PR 的目標以 GitHub repository ID 和 default branch 核實，但尚未真實操作驗證；Sync/Rebase 仍須按計畫核實 target 和結果。
- **仍未解的安全限制**：檔案路徑檢查與 host 寫入／刪除非原子操作；確認 discard 後到實際 Git 寫入仍有競態。symlink workspace root、symlink editor 路徑及 symlink discard 目前保守拒絕；Duplicate 失敗可能留下 private partial file。editor 草稿只在該 view 記憶體中，關閉 view/app 後不能保證恢復；Herdr close-hook 失敗語意未驗證。這些不是 M1 驗收通過的證據。
- **測試現況**：2026-11-20 在此 worktree 最新執行 `node --test` **171/171** 通過，`git diff --check` 通過；`gpt-6-luna high` 複審分組 diff 後建議鍵盤事件改用 `e.key`，修正後其相關測試 8/8 和完整測試 132/132 再次通過（當時）。本輪新增 24 個案例：keymap（5）、panel view bridge（4）、tree navigation（5）、explorer 鍵盤接線（6）、worktree create（4）；更早的 15 個來自 worktree remove（7）、panel gating（4）、worktree helpers（4）。測試使用 VM/mock 或隔離本機 Git repo，**未做**真正 Herdr core/session 隔離整合、雙 app UI、實際 focus/clipboard/accessibility tree、Windows/Linux 或真正遠端驗證。
- **建議接手順序**：① 先讀 `git status --short`、`parity-progress.md` 與最新測試，並實機按一次 M2/M4 新鍵（⌘1–9 vs ⌃1–9、⌘] / ⌘[、⌘⇧E/F/G/I、Explorer ↑↓/Enter/Delete/⌘⌥C）；複審分組 `View all` 的 `mods/orca-changes/section-view.test.js` 和 `mods/orca-diff/diff-data.test.js`；② 補完 M0 inventory 中仍標「待查」的表面與三處權限缺口；③ 處理 M1 的原子路徑／草稿恢復與安全遠端目標依賴；④ 按 M2–M9 完成快捷鍵、選單、worktree 其餘生命週期、Agents、可及性和例外；⑤ 依 §4 做隔離整合及雙 app UI 測試、記錄未能驗證之項。worktree remove 的 gating 已有測試，但建立／開啟與 UI 未驗；現有 `all` diff 是 net HEAD，不等於 per-section `View all`；conflict review/merge editor 仍未實作。

## 0. 目標、基準與邊界

- **目標**：以本地 Orca 的實際 UI 為基準，讓 `layouts/orca.json` 所使用的 Herdr UI 元素、標籤、選單結構、可用狀態、快捷鍵、焦點與實際操作結果盡可能一致。先對齊行為，再對齊圖示及操作狀態；不以像素、尺寸、間距、圓角或動畫為交付目標。互動回饋在 light/dark 都必須看得見，但不要求色值相同。
- **基準**：Orca `/Users/tonyyang/git/orca` HEAD `30d56bd62b0`；本 worktree `feat/wt-align-orca`，調查時 HEAD `1860df3`。實作者先記錄兩邊當時 commit、工作樹狀態與 Herdr 版本，不能把此處行號當永久事實。
- **範圍**：以 `layouts/orca.json` 可進入的介面及其 overlay、`mods/worktree`、`agent-config`、`picker`、`confirm`、`keys.json` 為主；stock 其他 layout、`win98`、Orca 無對應的獨立產品功能不因 parity 而重做。`orca-diff-breakdown`、freebuff、額外 pane 動作等既有擴充保留，仍需做到正確、安全及基本鍵盤／可及性。
- **真實行為優先**：標籤相同但效果不同不算一致。無 API 或語意不同時，不掛假按鈕、不假裝成功；優先沿用 `mods/orca-panel-gap/main.js` 的明確 unavailable 說明，或按 Orca 的條件隱藏。記錄可見的具體差異。不得把關閉 space 改名為刪除 worktree、把複製終端緩衝區叫作選取文字，或把搜尋部分資料稱為 Search everything。
- **破壞性操作**：不得因 UI parity 增加自動 push、force push、刪檔／刪 worktree、執行 agent 或改變權限預設。顯示確切目標並要求適當確認；測試只使用隔離的暫存資料，不能操作使用者真實 repo、遠端或 session。
- **預設決策（規劃建議，不是 owner 已批准的既定事實）**：以 Orca 預設操作為目標，Herdr-only 能力保留，不預設全部移至選單尾端；有快捷鍵衝突時先證實 host 能力、scope 與終端輸入，再遷移並保留不衝突的舊鍵。無法等價實作的項目標為例外，不偽造相同結果。避免為了這份計畫新增 Herdr core 後端或跨 mod 框架；若必要則明列獨立依賴與待決事項。
- **執行前規則**：依專案 `AGENTS.md` 載入 agentflow；本次讀取其技能檔遭權限拒絕，baseline rules 未能讀取，因此未啟動 agentflow、未寫 devlog，也不宣稱 invariant/review 已接受。使用者已授權調查 Orca，但部分 Orca 檔案仍被逐檔權限拒絕；不以 `git show`、其他工具或複製檔案繞過拒絕，相關項目記為待授權。前一輪 `handoff.md` 所載權限與並行狀態是歷史資訊，不能當成本次實測或新授權。

### 0.1 這不是已完成的全量比較 — created from <gpt-6.1-terra::high>

本次讀碼確認了部分 pane/tab/workspace menu、快捷鍵、右側 activity、file explorer、source control、diff、worktree、agents、new menu 與 handoff。**沒有啟動兩個 app，也沒有逐個讀完所有條件與狀態**；外觀、focus/hover、拖曳與實際執行效果未驗證。前版的百分比、103 個 action 全部已核對、623 條引用及 tooltip 計數均未在本輪重算，不得據此宣稱完整。以下以「已觀察」與「待查／待實作」區分；所有 checkbox 初始為未完成。

本次逐檔權限拒絕：Orca `src/renderer/src/components/right-sidebar/file-explorer/panel/FileExplorerBackgroundMenu.tsx`（無法確認 background menu 全部項目與條件）、`src/renderer/src/components/tab-bar/create-menu/TabBarCreateRowCustomizer.tsx`（無法核實客製化流程）。`FloatingTerminalPanel.tsx` 讀取時 safety reviewer 暫時不可用，相關實際動作尚待補查。以上不影響其他已讀檔案的調查，但涉及的 acceptance 不能標為通過。

## 1. 已觀察及必須修正的舊計畫誤判 — created from <gpt-6.1-terra::high>

| 舊說法 | 讀碼後的事實／限制 | 出處 |
|---|---|---|
| Tab Color 缺失 | 已有色盤與 `tab.colors` / `localStorage`；應驗持久化及互動，不重做。 | `mods/orca-menu/main.js` 的 `TAB_COLORS`、`setTabColor`、render；`mods/orca-tabs/main.js` 的 `readTabColorStore` ↔ Orca `tab-bar/terminal-tabs/SortableTabContextMenu.tsx` |
| `Mark as read` / `Mark as unread` 是 workspace menu 現況 | `orca-menu` 的 space menu 已是 `Mark Read/Unread`；`orca-spaces` 中其他表面需另查，不可一律斷言。 | `mods/orca-menu/main.js` 的 `items` ↔ `sidebar/workspace-actions/context-menu/WorktreeContextMenuView.tsx` |
| Equalize Pane Sizes 缺失就顯示 disabled | Orca 只在 `canEqualizePaneSizes` 為真時顯示；Herdr 無同能力時不可當成 Orca 原行為。 | `terminal-pane/context-menu/TerminalContextMenu.tsx` |
| Allow Auto-Close 一律顯示 disabled | Orca 僅在特定被保留的 orchestration worker 有可用 handler 時顯示；不能無條件加列。 | `tab-bar/terminal-tabs/SortableTabContextMenu.tsx` |
| workspace menu 一律顯示 `Workspace` 標題 | Orca 只對多選 context 顯示；單選不顯示。 | `sidebar/workspace-actions/context-menu/WorktreeContextMenuView.tsx` |
| `⌘⇧0` 切換 sleeping workspaces | 此版是 `sidebar.focusWorktreeList`；`sidebar.sleepingWorkspaces.toggle` 預設無鍵。 | `src/shared/keybindings/definitions-core-1.ts` |
| `⌘⌥A` 直接改給 Herdr float 即一致 | Orca 開的是可容納 terminal 等內容的 Floating Terminal；Herdr `orca-float` 是 agent 清單，改鍵不會變成等價操作。 | `definitions-core-1.ts`、`mods/orca-float/main.js` |
| 用 `⌘P` 直接接 name filter 就是 Go to File | names filter 是 explorer 內篩選，與獨立 quick-open 的焦點、結果及開檔語意需逐項比較；未證實等價。 | `mods/orca-files/main.js`、`definitions-core-1.ts` |
| 每個按鈕都要 `role:tooltip:a11y = 1:1:1` | 原始碼 grep 數量不能證明渲染與可操作性；共用 helper、動態列表、非按鈕 tooltip 均會失真。應檢查實際控制項及無障礙樹。 | `mods/orca-files/main.js`、`mods/orca-changes/main.js` |
| Orca 全部選單與字串可用 regex 抽完並自動比對 | 元件組合、動態條件、翻譯、平台和 scope 無法僅靠字串抽取判等；機械盤點只是候選，需人工查條件。 | `TerminalContextMenu.tsx`、`WorktreeContextMenuView.tsx` |
| `orca-files` 沒有 editor pane | 已有 `EditorState`：本地小於上限且能安全 round-trip 的文字可編輯，遠端／大檔等只讀；並非 Orca Monaco 功能等價。 | `mods/orca-files/main.js` 的 `show` / `save` |
| file menu 的 `⌘⌥C`、Enter、Delete 已可用 | 這些在選單是**僅顯示**的 hint；需實作或拿掉提示。 | `mods/orca-files/main.js` 的 `menuView`；Orca `file-explorer/selection/useFileExplorerKeys.ts` |
| Ctrl-Tab 跟 Orca 的一般下一個 tab 等價 | Orca 定義為 `tab.previousRecent`，Herdr 為 `tab.next`；需驗 MRU 語意，不只比鍵名。 | `definitions-core-2.ts`、`keys.json` |

## 2. 盤點與決策流程 — created from <gpt-6.1-terra::high>

### P0 / M0：固定基準，盤點每個可達表面

- [ ] 讀 `layouts/orca.json` 與每個可達 mod 的入口、對應 Orca 元件和 action handler；列出 surface → 入口 → 狀態 → Orca 程式路徑 → Herdr 程式路徑 → 差異 → 類型（可修／平台限制／Herdr-only／待查）→ 測試及結果。包含 menu、dialog、empty/loading/error、disabled、快捷鍵、滑鼠與鍵盤。只對本產品可達介面盤點，不把 Orca 全部 2,000+ 元件當需求。
- [ ] 對每一候選項查「何時出現／隱藏／disabled、順序、目標、結果、取消、焦點、權限與主機」，而非只比文字；挑選改動所依賴的舊 Orca 引用逐條核對檔案、符號和行號。不得把「623 條」當全數已驗。
- [ ] 需要權限的 Orca 檔案若被拒絕，記錄具體路徑、用途與影響；不猜測實作。M0 可分批進行，但該表面的 acceptance 不得標 passed，直到可讀與驗證。
- [ ] 盤點本 worktree 實際狀態及其他 agent 的重疊檔案；執行 `agent-config`、`orca-status` 或效能相關修改前重新比對現況，避免覆蓋平行工作。不得順手改動其他 layout 或清除他人產物。

**驗收**：每個 `orca` layout 可達 block 和主要 overlay 在盤點表中有對應或明確例外；每個 planned 改動附兩側具體檔案／符號、狀態和可判定案例；待查、權限缺口、未跑 UI 的部分仍清楚標示。表可以放進現有 `plan.md` 工作項目，不必先做大型產生器或 dump 所有 i18n。

## 3. 工作包與驗收

各工作包遵循 M0 → 實作 → 該包測試 → UI 驗證 → 記錄例外；不要求同時改完所有功能才驗。以下內容是要完成的**規劃**，不是現在宣稱的實作狀態。

### P0 / M1：危險操作、正確目標及真實語意 — created from <gpt-6.1-terra::high>

**已觀察**：`orca-files` 的 delete 透過 shared path 再以目前的 `this.on` 執行 `rm -rf`；new/rename 接收字串再組路徑，且 local `writeTextFile` 與 remote 路徑的行為不同，需審查。`orca-changes` 的 Force Push／Publish 指向 `origin HEAD`，Rebase 取 `origin/HEAD`；Commit & Push 兩步全成功才清 message。這些是待驗風險，不代表已重現資料遺失。

- [ ] 統一識別 `{workspaceId, host, root, path/target}`，開啟確認時固定目標；確認前後 workspace/host 切換、目標消失、狀態已變時安全中止並說明，不回退到目前 active host。remote 功能須確認每一 API 真正執行的位置；不能安全支援即禁用並明示。
- [ ] file create、rename、duplicate、move、delete 驗證名稱與邊界：拒絕空名、`.`/`..`、路徑逃逸、已存在目的地、跨 workspace；檢查 symlink 指向 scope 外、檔案消失、權限失敗及特殊字元。不要覆寫既有檔案或在 remote 意外改 local。對照 Orca 對外部連結的 browse-only 規則。
- [ ] Git 動作按實際 repo、upstream、base、狀態與 in-flight 操作 gating；無法可靠決定 target 時禁用／說明，不能假設 origin 或靜默 force。單項／批次 discard、工作樹刪除與 force push 的確認顯示具體影響，取消不執行。區分 close space、sleep、remove linked worktree 和 delete workspace。
- [ ] Commit & Push 的 partial success 要報明 commit 已完成、push 失敗；保留可恢復上下文但不讓再次點擊意外產生第二個 commit。每步錯誤有反饋且 busy 重置；切 workspace 不將結果寫到另一個 workspace 的 UI。

**驗收**：在臨時 local Git repo 和可控假 remote／模擬錯誤中斷言：取消／無效目標不產生寫入；切換工作區或主機後不修改新目標；路徑逃逸與外部 symlink 不可寫；commit 成功 push 失敗後不重複 commit；命令參數保留空格、Unicode、前導 `-`；顯示成功／失敗且 UI 可恢復。對真正遠端尚未驗證時明列未驗。

### P1 / M2：快捷鍵、scope、焦點與提示 — created from <gpt-6.1-terra::high>

**已觀察**：macOS Orca `⌘1…9` 選 workspace、`⌃1…9` 選 tab；Herdr `keys.json` 相反。Orca `⌘]` / `⌘[` 是 pane focus，Herdr 是 agent next/prev；Orca `⌘⌥←/→` 是 worktree history，Herdr 用於方向 pane focus。Orca `⌘P` Go to File、`⌘K` Search everything、`⌘⇧T` reopen closed tab、`⌘⇧E/F/G/I` 各個右欄 view；這些功能不可只加鍵而不實作等價 action。來源 `definitions-core-1..3.ts`、`keys.json`。

- [ ] 建立按 **平台 + focus scope + action** 的映射，記錄原有快捷鍵與衝突，先核實 `run`/layout command 的作用範圍、terminal 優先序及 Herdr 命令是否存在；支援的對齊 Orca，仍保留可用的 Herdr-only 操作與不衝突 alias。macOS 優先；Linux/Windows 依各自 Orca default 核實，不把 mac chord 當跨平台。
- [ ] 調整 workspace/tab 1–9、pane 切換、歷史、tab cycling/MRU，並明確定義無目標、單 pane、多 pane、pinned tab 的行為。`⌘W` 必須依實際焦點與 close 規則驗，不把 Herdr 的 `tab.close` 視為已等價；`⌘⇧W` 不需為了模仿而刪掉既有功能。
- [ ] 實作／核實右欄各 view 開啟和焦點、workspace rename、前後切換、delete/reopen；不支援的動作不綁不存在的命令。`⌘L` 與 terminal readline 的衝突、pane 方向鍵的替代方案、重開 tab 是否能恢復程序與資料均須實測；無等價能力保留現行鍵並列例外，不以承諾替代測試。
- [ ] 決定 `⌘P` 和 `⌘K` 的功能實作時，比對 Orca 的結果類型、查詢、鍵盤選取、空／錯誤、focus return 和作用域；若現有 picker/name filter 僅是子集，明確命名並不標成完整 parity。搜尋不可洩漏其他 workspace 或 host 的資料。
- [ ] 菜單及 tooltip 的 hint 讀實際有效 keymap／平台；無綁定不得顯示固定 chord。更新快捷鍵說明及 landing 頁提示。

**驗收**：自動檢查同 scope 無意外衝突、每個顯示的 hint 對應可用 action；以焦點在 terminal、文字輸入、選單、explorer 時分別測試按鍵，確認文字與 shell 控制鍵不被劫持；1–9、單／多 pane、pinned、無 workspace、已切換 host 逐例驗實際目標。MRU、reopen 的資料恢復與替代鍵無法驗證時記為例外而非完成。

### P1 / M3：Pane、tab、workspace／project 選單 — created from <gpt-6.1-terra::high>

來源：`mods/orca-menu/main.js`、`orca-tabs/main.js`、`orca-pane/main.js` ↔ Orca `TerminalContextMenu.tsx`、`SortableTabContextMenu.tsx`、`WorktreeContextMenuView.tsx` 及其 submenus / delete items。

- [ ] 按單／多 pane、pinned/unpinned、agent/non-agent、custom title、單選／多選 workspace、Git／非 Git、linked/main worktree 檢查列序、分隔、條件、disabled、提示、焦點和動作目標。
- [ ] 同步確實適用的 Orca 標籤，例如 pane `Hand off to agent`、dialog `Hand off to another agent`；核實 tab 的 `Split terminal right/down` 源頭後保留 Orca 實際 casing，不用自行統一 Title Case。
- [ ] Tab Color 保留既有實作並驗選色、None、切 tab、重啟／重建與無效 tab 的清理；Close Others 在單 tab、Close 在 pinned tab 等狀態對照 Orca。保留 split left/up、swap、park、right-click routing 等 Herdr-only 項目；可重排但不可刪除或改變語意。
- [ ] workspace 的 Mark Read/Unread、pin、notification mute、Edit Details、Open in、Copy、Parent & Children、Project Group、delete/sleep，逐項比較其資料模型與條件。沒有底層模型的項目列例外；不得只加看似有效的 menu row。`Close`、`Remove worktree` 必須保留區別與確認。
- [ ] pane `Select All` 目前註解說以複製 scrollback 代替 selection；釐清選取／複製語意並標示能力限制。`Copy Session ID` 僅有可信的 session ID 時顯示，不用 terminal ID 充數；Add to chat 等依 Orca 條件與 Herdr 能力處理。

**驗收**：各上述狀態用有固定預期的 menu 測試核對可見、disabled、列序及 action target；模擬點擊和鍵盤啟動，驗 pinned 不被意外關閉、取消不破壞資料、左右／上下 split 方向正確。UI 中手動驗證 flyout、焦點和實際 clipboard，不只比 snapshot。

### P1 / M4：Explorer、搜尋與本地 editor — created from <gpt-6.1-terra::high>

來源：`mods/orca-files/main.js` ↔ Orca `right-sidebar/file-explorer/panel/FileExplorerToolbar.tsx`、`selection/useFileExplorerKeys.ts`、`mutations/`、`panel/FileExplorerRow.tsx`、`FileExplorerViewSwitch.tsx`。

- [ ] 比較 Explorer tree 展開／收合、refresh/loading/error、dotfiles 與 git ignored 開關、Names/Contents、大小寫／全字／regex、include/exclude、清除搜尋、結果開啟與切 workspace；驗大型目錄／搜尋截斷提示與過期請求不覆蓋新結果。
- [ ] 對照 row / background menu 的 New File/Folder、Copy、Copy Path/Relative Path、Duplicate、Rename、Delete、View File、Open in、Reveal、Open in Terminal 的條件與實際效果。實作所顯示的快捷鍵，或移除不能工作的 hint；clipboard 格式按平台與 host 誠實呈現。
- [ ] 對照焦點在 tree 時 ↑↓、左右展開、Space 啟動、Enter rename、範圍／多選、delete 與 undo/redo；不可把按鍵攔截到輸入欄或 terminal。拖放、移動與 undo 若 host 沒安全操作能力，列為明確例外；只在有完整 journal 和可恢復語意時聲稱支援 undo。
- [ ] 驗 file editor 的 autosave、切檔／關閉、外部變更衝突、只讀與錯誤；保留 remote、大檔、binary、無法 round-trip 的只讀保護，不宣稱 Monaco／merge editor parity。

**驗收**：隔離目錄涵蓋 nested、ignored、dotfile、binary、長檔、Unicode、symlink、消失和權限錯誤；檢查實際檔案內容、路徑和剪貼簿，不只按鈕存在。快速連續搜尋／切 workspace 後結果只屬於最新查詢；保存衝突不覆寫外部變更。單／多選、focus、提示與 undo/redo 的支援狀態逐項可觀測。

### P1 / M5：Source Control、diff 與 review — created from <gpt-6.1-terra::high>

來源：`mods/orca-changes/main.js`、`mods/orca-diff/`、`mods/orca-diff-breakdown/` ↔ Orca `right-sidebar/source-control/commit/commit-area.tsx`、`listing/uncommitted-sections.tsx`、`editor/diff/`。

- [ ] 比較 staged／unstaged／untracked／conflicts 分組、狀態／計數、row click、分組收合、單項與批次 stage/unstage/discard、確認、錯誤及 busy gating；含部分 staged、rename、delete、衝突、無 commit repo、上限超過。Orca `View all` 按 section；Herdr diff 的 `all` 是另一語意，不能直接等同。
- [ ] 比較 primary action、message、`⌘/Ctrl+Enter`、commit/dropdown、upstream/ahead/behind、push/pull/sync/rebase/publish/PR 條件和結果；先完成 M1 安全條件，不為了菜單齊全增加不安全遠端操作。
- [ ] 檢查單檔／全部 diff 的 staged vs unstaged、untracked、binary、無 HEAD、檔案／行數上限、切換 target、close pane 的正確性。`orca-diff` 目前 all 僅取前 20 個 untracked 且上限 5000 rows；顯示可見截斷或補完整能力，不可呈現為完整內容。衝突目前開純文字而非 merge editor，明確標示。
- [ ] review note、hunk 操作、combined diff、branch compare、Diff Breakdown 等分別核實能力與資料來源；`orca-diff-breakdown` 是保留的擴充，不能被算成 Orca 內建 source-control parity。

**驗收**：臨時 Git repo 構造 staged+unstaged 同一檔、untracked、刪除、rename、conflict、空 repo、超過顯示上限；核對 `git status`、index 與 diff 實際內容，取消 discard 前後完全相同。分支／upstream 不同與故意失敗的 fake remote 顯示正確結果；未支援的 hunk／review 功能不可顯示成已成功。

### P1 / M6：Workspace、sidebar 與 worktree 生命週期 — created from <gpt-6.1-terra::high>

來源：`mods/orca-nav/`、`orca-spaces/`、`orca-landing/`、`mods/worktree/` ↔ Orca `sidebar/workspace-card/`、`workspace-actions/`、`workspace-creation/`。

- [ ] 比較 sidebar project/workspace 排序、展開／收合、選擇、多選、搜尋、歷史 back/forward、unread 與狀態、tooltips、empty/loading/error。狀態只映射 Herdr 真正提供的 working/blocked/done/idle；不能把不存在的 failed/interrupted/host offline 推測為真。
- [ ] 核對 landing 的 Add project / Create workspace 的實際目的：目前 Create workspace 開 `orca-new-menu`，再選 worktree；與 Orca workflow 的差異要明確記錄或安全對齊。驗新建／開啟 worktree 的名稱、base、路徑、已存在 branch、錯誤、取消與完成後選中；不得自動改其他 checkout。
- [ ] 審查移除 linked worktree、dirty／untracked、未推送 commit／submodule、main checkout、正在使用的 terminal、遠端及失敗恢復；不強制刪除，不把 close space 說成 worktree 已刪。
- [ ] project group、parent/children、card options、sleep／notification 依資料模型決定可做或例外；不用 UI 佔位捏造持久狀態。保留專案目前的命名／身份差異，顯示文案可對齊 Orca 的 `workspace`，內部 `space` API 不必改名。

**驗收**：用臨時 repo 建 main + linked worktree，驗重名、dirty、已開啟、不可刪除 main、取消、錯誤及安全移除；非 Git folder 可正常使用。切換／重啟後已宣稱持久化的 pin/read/group 狀態正確；不存在的模型明示。

### P1 / M7：右側 activity、Agents、handoff、`+` 選單 — created from <gpt-6.1-terra::high>

- [ ] activity bar 比較 tab 次序、tooltip、shortcut 與 gating：Orca 的 Attached worktrees / PR Checks 是 folder-only、Source Control / Checks 是 git-only、Ports 是 ssh-only；Herdr 用 Git probe 近似 folder，不能宣稱模型完全相同。切換 workspace 或 host 時 active tab 失效要安全 fallback。來源 `mods/orca-panel-head/main.js` ↔ `use-right-sidebar-activity-items.ts`。
- [ ] 保留 `orca-panel-gap` 對無 backend 的說明；先核實能力再決定是否顯示，不能因 Orca 有 Checks、PR Checks、Ports 就造假資料。側邊／頂部 activity position、card layout、status bar visibility 屬後續可行性項，不與 P1 安全工作綁在一起。
- [ ] Agents 對照 workspace/project/all、host scope、搜尋、filter、refresh、row details、resume、空／錯誤與 session 隱私。Orca `AiVaultPanelHeader.tsx`、`AiVaultSessionRow.tsx` 支援多選項；Herdr `orca-agents` 註解明示目前只有 OMP transcript adapter 且掃描有界。列出各 CLI 真正支援的範圍；不能把非支援來源表示為零 session 或執行錯誤 resume。
- [ ] Handoff/fork 比較條件、目標 agent、context 來源、載入失敗、複製、取消、原 session 不變與新 session 的工作目錄／host。Herdr 現有 `hc read` 是終端內容，不能聲稱等同 Orca 結構化 session；手動檢查敏感內容，未經使用者操作不傳出、不啟動 agent。
- [ ] `+` menu 比較 new terminal、agent rows、配置 flyout、未安裝／載入中／模型查詢失敗、keyboard 和 Escape。Herdr 的 New File Browser、worktree、freebuff 保留；Orca 的 omnibox、browser、Markdown、customize/reorder/hidden、插件等依後端列可實作或明確例外，不將靜態清單說成完整等價。來源 `mods/orca-new-menu/main.js`、`mods/agent-config/main.js`、Orca `tab-bar/create-menu/`。

**驗收**：git／普通 folder／SSH 三種情境核對 tab gating 和 active fallback；unsupported panel 清楚說明。使用假 session／假 agent catalog 測試搜尋、scope、無資料與錯誤、resume 目標、model/effort 預設與取消；handoff 取消不啟動、啟動時資料與 host 正確。驗 keyboard 操作能進入、退出 flyout、跳過 disabled row 且焦點回到原處。

### P2 / M8：選單、dialog、可及性與互動回饋 — created from <gpt-6.1-terra::high>

- [ ] 針對 `orca-menu`、`orca-new-menu`、`orca-split-menu`、file/change menus、`agent-config`、handoff、confirm 和 picker 逐一比 Orca：開啟時焦點、↑↓、Home/End、Enter/Space、Escape、outside click、submenu 開關與返回焦點；輸入中的 Enter/Escape、IME composition 不被外層錯誤攔截。split-menu 的單鍵操作屬 Herdr-only，先保留，核實衝突後才調整。
- [ ] 每個實際 icon-only control 有可辨識的 accessible name、適當 role、disabled 狀態與可用 tooltip；有實際綁定才帶 chord。檢查 `orca-changes` 單檔 stage/unstage、`orca-diff` close 等並非每處皆有標籤的按鈕。文字按鈕不強制重複 tooltip。
- [ ] 比較選中／focus／hover／disabled／destructive 及 error/success feedback，dark 和 light 均可辨識；避免把顏色作為唯一狀態。修影響操作回饋的 hard-coded color，不以清零硬色或建立跨 mod helper 為目標。
- [ ] 先確認 Herdr mod 隔離和 GPUI 共享能力，再決定重用現有函式或小範圍重構；不得假設跨 mod import 可用，也不為了行數漂亮引入通用框架。

**驗收**：以實際渲染樹逐一檢查 icon 控制項的名稱、role、disabled；逐鍵操作至少一個普通 menu、submenu、帶文字輸入的 dialog 和 destructive confirmation；視覺確認兩個 theme 的 focus/hover/selected 與禁用狀態。若平台／工具無法讀 accessibility tree，明確記錄測試方法與未覆蓋項。

### P2 / M9：Float、status、settings 與其他 Orca 表面 — created from <gpt-6.1-terra::high>

- [ ] `orca-float` 是 live agent 清單而非 Orca 的 floating terminal；驗開關、關閉、空態、blocked 狀態與點選後焦點，明確標註差異。只有 Herdr 能安全承載可輸入 terminal 時才規劃真正 parity，不能單純換 chord 冒充。
- [ ] `orca-status` 的 usage、更新、host、float 等項核實 Orca 對應內容、可點擊行為、資料新鮮度、錯誤及敏感資訊；不覆蓋同時進行中的 status 工作。Orca status 段落可見性及 density 若需新狀態，先評估 host／持久化。
- [ ] 記錄 Herdr Settings/快速鍵編輯器、原生 chat、browser、插件、bots、dictation、mobile、遠端託管 checks／ports 的支援範圍；這些不是單靠 mod 偽 UI 即能完成的事。實驗性 app rail 可列後續研究，非現階段 parity gate。

**驗收**：每個保留控制項有實際 action、錯誤／不支援說明及正確焦點；文件或 UI 明確列出非等價行為。從未提供的 usage/session 不渲染成 0 或成功。實驗性或後端缺失功能不算完成。

## 4. 測試方式、結案門檻與重新基準化 — created from <gpt-6.1-terra::high>

### 驗證分層

1. **可重跑測試**：優先現有 `node:test` 慣例，針對有風險的決策／資料解析寫獨立固定預期（例如 menu gating、key scope、path safety、Git 部分成功）；測試不能用被測實作或動態抓到的 Orca 值生成 expected。只有有價值的地方抽出純邏輯，不因測試強行拆所有 UI。本次僅試跑 `node --test mods/orca-diff/diff.test.js`，5 項通過；它只證明 diff parser 現有案例通過，不能證明 UI parity 或整套測試通過。
2. **隔離整合測試**：只在專屬臨時 repo、假 remote、獨立 Herdr core／session 與 scratch config 上跑；不接使用者核心，不動現有 terminal、工作樹、剪貼簿或網路帳號。若沒有安全 harness，就明列未跑，不能假稱 e2e。實際新增 harness 前先檢查是否已有可用測試；`handoff.md` 所稱其他 worktree 的 harness 不等於目前已存在或已授權使用。
3. **兩 app UI 人工／可控自動驗證**：固定 Orca commit、Herdr 版本、OS、theme、視窗、測試資料和 focus 狀態；比較可見元素、順序、實際鼠鍵、focus、hover、tooltip、dialog、clipboard 與狀態。不能在使用者桌面搶焦點；Orca repo `AGENTS.md` 要求背景啟動、隱藏 renderer 的 CDP／fixture，native-focus 需隔離 display 或 CI。未具備條件就列待驗而非用截圖推斷互動。
4. **失敗與限制**：逐項記錄命令／環境、通過或失敗、證據、未測狀態與限制；UI 驗證、手動驗證或權限不足不能用 unit pass 代替。需要用戶決定的變更以候選／例外記錄，不臆稱已同意。

### 完成定義

- [ ] 所有可達 surface 已盤點；每一差異有 `aligned`、`Herdr-only（保留）`、`unsupported（說明原因）`、`待查／待授權` 或 `待實作` 狀態與證據。不得把待查歸為 aligned。
- [ ] P0/P1 每個實作項的指定案例通過，安全失敗與取消案例通過；可見快捷鍵、tooltip、狀態與真實行為一致。
- [ ] 自動測試、隔離整合、雙 app UI 檢查各有結果；不能跑的項目及影響清楚列出。既有功能未因對齊被移除，尤其 worktree 操作、freebuff、split／swap、float、Diff Breakdown。
- [ ] 實作後文件記錄 Orca commit、Herdr 版本、明確差異、配置遷移和 rollback；不得把 `plan.md` 完成等同於 UI parity 完成。

### Orca 更新後

- [ ] 更新基準前先看兩邊工作樹與 Orca commit；按實際改動的 keybinding 定義、surface、翻譯與 handler 重新盤點及跑相關測試，人工確認條件與語意。
- [ ] 可用小型腳本產生**候選** action/字串清單與檢測 Orca hash 變動，但 hash 不同只提示需要 review，不應令離線或無 Orca checkout 的一般測試無條件失敗；允許列在案的 Herdr-only 與 unsupported。無需把 23,714 條翻譯或所有 UI snapshot 納入 repo。
