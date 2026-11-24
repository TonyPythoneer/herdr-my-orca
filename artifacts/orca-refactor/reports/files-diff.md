# files-diff 重構報告（orca-files / orca-diff / orca-confirm）

分支 refactor/files-diff，未 commit（`git mv` 只改了索引中的測試檔名）。完整測試：553 項中 552 通過；唯一失敗是 `scripts/orca-ui-manifests.test.js`「every mod is a feature or has one in-place map entry」。原因：新增了 *.test.js，而 orca-ui/app.mjs 的 in-place 測試清單不可由我修改。依指示由 orchestrator 重新產生。*.snap.json 零變更（`git status` 驗證）。

## a) eslint 前後件數（依規則；僅手寫檔，*.test.js 被 eslint 設定忽略）

| mod | 規則 | 前 | 後 |
|---|---|---|---|
| orca-files | complexity | 14 | 0 |
| | no-nested-ternary | 19 | 0 |
| | no-shadow | 40 | 0 |
| | max-lines-per-function | 2 | 0 |
| | max-depth | 10 | 0 |
| | max-params | 1 | 0 |
| | no-unused-vars | 0 | 0 |
| orca-diff | max-lines-per-function / complexity / max-depth / nested-ternary / shadow | 1 / 2 / 2 / 4 / 3 | 0 / 0 / 0 / 0 / 0 |
| orca-confirm | no-shadow | 1 | 0 |

`eslint -c eslint.config.mjs mods/<mod>` 三個 mod 皆 0 件警告（含新增的 .mjs 測試輔助檔）。沒有使用 eslint-disable。

### 覆蓋率（行 / 函式；node --experimental-test-coverage）
- 基準（我加測試前）：
  - orca-files：模組檔 100% / 100%。main.js 因既有測試用 vm 執行，未被計入，等於 0。
  - orca-diff：95.77% / 78.57%（diff.js 65%、main.js 96%/57%）。
  - orca-confirm：100% / 100%。
- 重構後：
  - orca-files：main.js 100% / 95.5%；delete-target、file-mutation、editor-path、tree-nav、git-status、text-search、workspace-path、save-queue 皆 100% / 100%。
  - orca-diff：diff-data、diff-rows、main 100% 行；diff.js 100% / 85.7%（函式）。
  - orca-confirm：main.js 100% / 100%。

### 新增檔案
- 測試（規格化／黃金大師）：
  - orca-files：`files-data.flow.test.js`、`files-ui.flow.test.js`、`pure.flow.test.js`
  - orca-diff：`data.flow.test.js`、`view.flow.test.js`、`pane.flow.test.js`（前一位工人寫的）
  - orca-confirm：`confirm.flow.test.js`（前一位工人寫的）、`render.flow.test.js`
- 測試輔助檔：
  - `mods/orca-files/flow-harness.mjs`、`golden.mjs`（orca-diff、orca-confirm 各有一份 `golden.mjs`）。
  - 黃金檔：`files-data` / `files-ui` / `files-ui-actions` / `files-pure` / `diff-data` / `diff-view` / `confirm-render` 的 `*.golden.json`。這些是新檔，不是 `.snap.json`。
- 正式程式碼新檔：
  - `mods/orca-files/git-status.js`（git 狀態標記與資料夾標記）
  - `text-search.js`（glob 切分與 rg 輸出分組）
  - `workspace-path.js`（工作區比對與路徑片段檢查）

### 測試在未重構程式碼上通過
- 這些測試先對重構前的程式碼錄製並通過（黃金檔 `UPDATE_GOLDEN=1` 只在那時寫入）。備份：`/private/tmp/claude-501/-Users-tonyyang-git-herdr-my-orca-worktrees-orca-ui-package-plan/48bf2fa3-dd93-41fb-802d-da66d400375d/scratchpad/refactor/reports/files-diff-baseline-tests/{orca-files,orca-diff,orca-confirm}`。
- 之後所有 `*.golden.json` 與該備份 `cmp` 逐位元組相同（重構期間沒有改黃金檔）。
- 方法：orca-files 的 flow 測試用 scripts/gpui-stub-loader.mjs 加上假 InputState、EditorState 與假 host；用 handler 登錄表直接呼叫真實的 on_click、on_key_down 等處理函式；用黃金檔固定 render 節點樹、exec 呼叫與狀態。涵蓋 refresh、git 標記、名稱過濾、rg 搜尋、act 全部動作、apply、remove、command、treeKey、show 與草稿、儲存、More 與 Open in 彈窗。
- 重構期間測試檔只有「測試碼風格」微調（變數改名、三元改 if）。這是前一位 codex 工人做的，已對照確認黃金內容未變。

## b) 帳本（principles.md 1–100）
1 過長函式：已套用（main.js: refresh→gitDecorations、show→loadPreview/readPreview、renderBody→fileHeader/treePane/popupView；diff-data.js: loadDiff→sectionPlan/allPlan/singleFilePlan/jobLines；file-mutation.js: mutateFile→validateRequest/resolvePaths）
2 重複程式碼：已套用（workspace-path.js: sameWorkspace、hasUnsafePart；main.js: toggleFolder、confirmDelete、centeredBox、statusMessage、spinner）
3 意義不明名字：已套用（main.js: key()→workspaceKey、byName→compareEntries、inner cx→taskCx/timerCx/eventCx、diff-rows.js untab 的 s→chunk）
4 過深巢狀：已套用（max-depth 10→0：git-status.js parseStatus、diff-data.js classifyStatus）
5 魔術數字：已套用（main.js: REFRESH_INTERVAL_MS、SEARCH_DEBOUNCE_MS、AUTOSAVE_DELAY_MS、MAX_PREVIEW_CHARS 等；diff-data.js: BATCH_MAX_*、MAX_DIFF_LINES；diff-rows.js: MAX_LINE_CHARS、TAB_WIDTH、UNTRACKED_PREVIEW_MAX；tree-nav.js: PAGE_DIVISOR）。純版面像素值（行高、padding）未命名
6 巨大類別：不適用（Files 是 Herdr View 的單一元件，已把純邏輯移出到模組，再拆類別需要改 props／命令分派）
7 過長參數列表：已套用（main.js: queryRow 6→參數物件）
8 死碼：已套用（no-unused-vars 於此批前為 0；重構中移除 treeList 內不再需要的 helper 與 row 的 `link` 解構；舊的 statusRank/statusLetter/byName 被取代）
9 變更分散：不適用（無跨檔重複修改點）
10 變更集中：不適用
11 義大利麵：不適用（無 goto 式流程；treeKey 已拆成 treeShortcut/navigateTree/rowKey）
12 全域變數：不適用（`mainFilesView` 為既有跨 popup 協議，保留，見 c）
13 特徵橫向依賴：不適用
14 資料群：已套用（參數物件 `{ state, id, active, busy, controls }`、`{ context, root, on }`）
15 執著基本型別：不適用（沒有帶語意的基本型別群）
16 Switch：已套用（tree-nav.js 的 switch → MOVES 查找表；main.js fileAction 保留 switch，因為每個分支是不同副作用）
17 暫時性屬性：不適用（view 欄位為既有狀態機，改動會改變重設行為）
18 訊息鍊：不適用（recorder 鏈式 UI 呼叫是 gpui 風格）
19 中間人：不適用
20 可疑的一般化：不適用（未新增泛化）
21 懶惰類別：不適用
22 資料類別：不適用
23 平行繼承：不適用
24 拒絕繼承：不適用
25 不適當關係：不適用
26 函式提取：已套用（見 1；另 tree-nav.js: arrowRight/arrowLeft/fromNoSelection）
27 重新命名變數：已套用（見 3；no-shadow 40→0）
28 變更函式宣告：已套用（queryRow 簽名；loadDiff 內部函式）
29 變數提取：已套用（main.js: treePane 的 status；isCopyPathKey/isDeleteKey）
30 類別提取：不適用（見 6）
31 函式內聯：不適用（無過度包裝可內聯）
32 變數分離：不適用
33 參數物件：已套用（queryRow、loadPreview、readPreview、askName、installPreview）
34 刪除旗標參數：不適用（沒有布林旗標參數需分流）
35 查詢與更新分離：不適用（parseStatus、gitDecorations 為純查詢；更新在呼叫端）
36 移動函式：已套用（git 狀態解析→git-status.js；glob／rg 解析→text-search.js；路徑檢查→workspace-path.js）
37 階段分離：已套用（loadDiff：規劃（plan）→執行（jobLines）；refresh：載入資料夾→git 標記→套用）
38 函式群集約成類別：不適用（YAGNI）
39 變數內聯：不適用
40 替換演算法：已套用（splitGlobs 改為指標掃描，黃金測試涵蓋 `[…]`、`{…}`、跳脫與未閉合）
41 陳述式滑動：不適用
42 函式參數化：不適用
43 隱藏委派：不適用
44 移除中間人：不適用
45 類別內聯：不適用
46 工廠函式：已套用（diff-data.js: untrackedJob）
47 變數封裝：不適用
48–50 繼承類（上提、父類、平坦化）：不適用（無繼承階層）
51 守衛子句：已套用（main.js: emptyTreeState、saveStatusText、fileBody；diff-data.js: validSectionTarget；tree-nav.js）
52 分解條件描述：已套用（isCopyPathKey/isDeleteKey、treeOwnsKeyboard、hiddenByFilter、isNoIndex/isEmptyNewFile）
53 整合條件描述：已套用（validSectionTarget 用 every 合併三個 some 條件）
54 多型：不適用
55 分離迴圈：不適用
56 導入特殊案例：不適用
57 導入斷言：不適用（行為保持不變，不新增斷言）
58 刪除控制旗標：不適用（無控制旗標）
59 集合管線：已套用（validSectionTarget 的 every；matchesName 的 tokens.every）
60 查找表：已套用（tree-nav.js MOVES；main.js NEW_ITEM、byPlatform 表）
61 策略模式：不適用（YAGNI，無第二變體）
62 快速失敗：已套用（file-mutation.js validateRequest 先於任何 exec；delete-target.js relativeTarget）
63 三元運算子：已套用（巢狀三元 19+4→0，僅留單層）
64 德摩根：不適用
65 Optional chaining：不適用（既有程式已大量使用）
66 Null 合併：不適用（既有程式已使用）
67 列舉型別：不適用
68 狀態模式：不適用（YAGNI）
69 模式匹配：不適用
70 短路求值：不適用
71 吞掉例外：已套用（save-queue.js、main.js 的空 catch 已加註解寫明為何可忽略；clip.js 為共用副本不可改，見 e）
72 移動迴圈不變代碼：不適用
73 狀態機：不適用
74 決策表：已套用（byPlatform 表、NEW_ITEM 表）
75 Yoda：不採用（依 principles）
76 規格化測試：已套用（見 a「新增檔案」）
77 小步驟：已套用（每步跑 mod 測試；各階段 diff 可審）
78 回歸測試：已套用（黃金檔即回歸網）
79 單一職責：已套用（git-status.js、text-search.js、workspace-path.js）
80 DRY：已套用（見 2）
81 KISS：已套用（拆分時不加抽象層）
82 YAGNI：已套用（不加類別／策略／狀態）
83 關注點分離：已套用（解析與 UI 分離）
84 童軍規則：已套用（順手把相鄰的空 catch 加註解）
85 單元測試：已套用（pure.flow.test.js、data.flow.test.js）
86 Linter：已套用（三個 mod 皆 0 警告）
87 Formatter：不採用（不重排整檔）
88 循環複雜度：已套用（complexity>12 全數 0）
89 認知複雜度：已套用（巢狀三元、深巢狀消除）
90 程式碼覆蓋率：已套用（見 a）
91 型別註解：不適用（本 repo 為無型別 JS）
92 迪米特：不適用
93 依賴注入：不適用（exec 等已由呼叫端注入，維持）
94 純函式：已套用（parseStatus、splitGlobs、searchResults、diff-data 的 jobLines、classifyStatus）
95 不可變：不適用
96 絞殺無花果：不適用（無遺留系統漸進替換）
97 命名規則：已套用（見 3）
98 御門法：不適用
99 黃金大師：已套用（`*.golden.json`；重構前錄製、之後逐位元組比對）
100 開放封閉：不適用（YAGNI）

## c) 保留項目與理由
- `panelFrame`（panel-motion.js 為共用副本，不可改）：render 外框 GPU 成本結構未動。`render(cx)` 仍然是 `panelFrame(this.renderBody(cx))`。
- `v_virtual_list` 單一 `on_item_click`、`treeList` 結構與列高常數：註解說明避免每格建立處理函式與超 50 ms render 預算，未動。
- `renderBody` 內 `workspaceKey() !== context.key` 時用 `cx.timer.after(0, …)` 重新整理（避免 render 期 notify），未動。
- `mainFilesView` 模組層級變數：popup 與主面板共用的既有協議，未動。
- `directory()` 的 PowerShell 一行腳本、`OPEN_WITH` 腳本與兩個 shell 腳本（FILE_ACTION_SCRIPT 等）：腳本文字以 hash 在黃金測試中固定，只搬位置不改內容。
- `fileAction` 的 switch：每個 case 是不同副作用，查找表不會更簡單。
- 版面像素值（高度、padding、`openIn` 的 W/GAP/M）：純版面，依指示不逐一命名。
- 時序：`refresh` 將 git 標記收集移到 `gitDecorations`（async 函式），多一次 microtask 讓出；`loadDiff` 單檔路徑特意不 await 規劃步驟，維持第一個 `git diff` 與呼叫同 tick（前一版測試曾抓到這個差異）。

## d) Herdr API 候選（不在此次重構內改）
- main.js:994 `promptView`、1012 `menuView`、1144 `moreView`、1082 `openInView`：手刻彈窗列與提示框。若 Herdr 有內建 menu／prompt 元件，可取代。
- main.js:1059 `openIn`：手算彈窗位置（viewport、左右翻轉）。可改用 `openOverlay` 的自動錨定（若支援 anchor／placement）。
- main.js:124 `directory` 與 417 `fileList`（以 sh、PowerShell、rg 列檔）：若 Herdr 提供檔案系統列目錄 API（類似 `readTextFile`／`watchFolder` 的目錄版），可取代。
- main.js:66 一帶 `canEditPath`／`file-mutation.js`／`delete-target.js` 的 sh 腳本：註解中的 `shortcut:` 已標明需要 host 的 directory-handle 式 API。
- orca-diff/main.js:60 `dismiss` 以 panes()／focused() 手動找 diff pane：可用「關閉自己」的 API（若有）。

## e) 發現但未處理的 bug（行為保持不變，未修）
1. mods/orca-files/main.js:261 `await this.command(c, taskCx).catch(...)`：`command()` 不是 async，對 "search"、"refresh"、"filters"、"view" 與未知命令回傳 `undefined`，`undefined.catch` 丟 TypeError。命令本身已執行，但 `nextCommand` 迴圈隨即終止，之後的命令全部失效。只有 `remove-*`（回傳 Promise）不受影響。黃金測試「commands queued…」已固定此行為（`errors: ["TypeError…reading 'catch'"]`、迴圈結束）。修法是 `Promise.resolve(this.command(...)).catch(...)`；若修了要同步更新黃金檔。
2. mods/orca-files/tree-nav.js `parentIndex`：index 超出 rows 範圍時 `rows[i].depth` 會 TypeError（呼叫端已用 `if (!row) return none` 先擋住，目前不可達）。
3. 共用副本 mods/orca-files/clip.js:14,17,31,43 有空 catch；panel-motion.js 為共用副本。依規定交由 orca-ui/shared 的負責人處理。
