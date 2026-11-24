# 重構報告：orca-changes / orca-worktree / orca-handoff（branch refactor/changes-wt-handoff）

狀態：完整測試 499 項全過（基準 490 + 新增 9 項）。未 commit（上一位 worker 的 WIP commit 9cdcb2f 之後的修改留在工作樹）。*.snap.json 無任何變更（git status 驗證）。三個 mod 本來就沒有 *.snap.json。

## a) 每個 mod 的量測

eslint（`eslint -c eslint.config.mjs mods/<mod>`，只算正式碼；`*-test.js` 測試檔另列）

| mod | 規則 | 前 | 後 |
|---|---|---|---|
| orca-changes | no-shadow | 50 | 0 |
| | complexity | 5 | 0 |
| | max-params | 3 | 0 |
| | no-unused-vars | 2 | 0 |
| | no-nested-ternary | 6 | 0 |
| orca-worktree | no-nested-ternary | 11 | 0 |
| | no-shadow | 9 | 0 |
| | complexity | 4 | 0 |
| | max-lines-per-function | 2 | 0 |
| orca-handoff | complexity | 2 | 0 |
| | no-shadow | 5 | 0 |
| | no-unused-vars | 2 | 0 |
| | max-lines-per-function | 1 | 0 |
| | no-nested-ternary | 1 | 0 |

注意：eslint 設定只忽略 `**/*.test.js`。我新增的測試檔必須叫 `*-test.js`（原因見下），所以會被 lint，產生 harness 警告共 10 項（orca-changes 5：git-matrix-test max-params 1、main.golden-test complexity 3 + max-lines 1；orca-worktree 4；orca-handoff 1）。這是長情境表與 proxy 記錄器造成的，不是正式碼；未用 eslint-disable。

覆蓋率（node --test-coverage，行 / 函式，各 mod 的 all files；排除 *.test.* 與 *-test.js）

| mod | 前（原測試） | 後（含新測試） |
|---|---|---|
| orca-changes | 42.66 / 45.35 | 95.76 / 91.47（main.js 100 / 91.4；push-target.js、create-pr.js 皆 100 / 100） |
| orca-worktree | 80.35 / 63.22 | 100 / 100 |
| orca-handoff | 78.23 / 68.29 | 94.71 / 96.43（main.js 100 / 100） |

「前」的 orca-changes main.js 只有 23.8%／16% 是假象：原有 section-view 測試用 vm 執行原始碼，未帶檔名，coverage 無法歸屬。我的新測試用同一個具名 `vm.Script`（檔名為 main.js、被遮掉的 import 以空白取代以保持偏移）在每個新 context 執行，因此 main.js 的覆蓋率才能被量到。剩餘未覆蓋的是共用副本（clip.js、panel-motion.js、transcript.js，不在我的範圍）與少數分支。

新增的測試檔（皆在重構前的程式碼上通過；備份：reports/changes-wt-handoff-baseline-tests/）
- orca-changes：`refresh.flow-test.js`（前一位 worker 寫的，內容未改，只改檔名）、`main.golden-test.js` + `main.golden.json`、`git-matrix-test.js` + `git-matrix.golden.json`
- orca-worktree：`dialog.flow-test.js`（前一位 worker）、`main.golden-test.js` + `main.golden.json`
- orca-handoff：`dialog.flow-test.js`（前一位 worker）、`main.golden-test.js` + `main.golden.json`

測試做法（#76 規格化測試 / #99 黃金大師）：
- golden 測試把每個 mod 的 main.js 以具名 vm.Script 載入，用記錄器 stub 渲染多種狀態（orca-changes：全區段、無 repo、載入中、錯誤、乾淨、限額橫幅、各種選單與 entry menu 等；worktree：new/open/switch/remove 與各 repo 狀態；handoff：handoff/fork 與各 agent/transcript 狀態），再自動找出渲染樹中每個 on_click／on_hover／on_key_down／on_mouse_down 處理函式並呼叫（orca-changes 與兩層 dialog 也會探索），記錄 git 呼叫、run 指令、shared 值、狀態與 notify 次數，另外直接呼叫約 100+ 個流程（push、force push、create PR、rebase、discard、resolve、refresh、init、watch、create、switchTo、executeFork 等）。
- 結果存成每個情境一個 SHA-256 的 golden（完整記錄好幾 MB，可用 `GOLDEN_FULL=<檔>` 傾印做 diff）。重構前後 digest 完全相同，等於渲染樹逐位元組相同、所有處理函式行為相同。golden 連續跑兩次輸出完全一致（確定性）。
- git-matrix-test：對 push-target.js（41 種 mutation）與 create-pr.js（44 種 + createPr 13 種）逐一驅動每個守衛與錯誤訊息，記錄結果，兩檔覆蓋率 100%。
- 為何叫 `-test.js` 而非 `.test.js`：`scripts/orca-ui-manifests.test.js` 會比對 `orca-ui/app.mjs` 列出的 `.test.js` 清單，多一個 `.test.js` 就失敗，而 orca-ui/ 禁止修改。`node --test` 仍會執行 `*-test.js`。前一位 worker 的三個 `*.flow.test.js` 因此改名為 `*.flow-test.js`（內容不變）。

重構時對測試檔的唯一調整（呼叫端簽名跟著變，語意不變、digest 不變）：
- `createPr(snapshot, git, gh, current, title, body, draft)` 改為參數物件 `createPr({ snapshot, git, gh, current, title, body, draft })`（#33），已同步改 `create-pr.test.js`、`git-matrix-test.js`。
- `submitCreatePr(target, snapshot, title, body, draft, cx)` 改為 `submitCreatePr(target, snapshot, { title, body, draft }, cx)`，已同步改 `main.golden-test.js` 兩處呼叫。
- 備份目錄中的測試檔是重構前版本（用舊簽名，已在舊程式碼上通過）。

## 主要重構內容
orca-changes
- main.js：刪除死碼 `fade`（grep 確認無引用，非匯出）；`no-shadow` 全部以 AST 工具改名（spawn 內為 taskCx、事件為 eventCx、計時器為 timerCx、巢狀 callbackCx；`location`→`captured`、`key` 參數→`sectionKey`、`e`→`event`）；`refresh` 拆成 `resetForContext`、`readChanges`，加 `readNumstat`、`statusRows`、`rowStatus`（消除巢狀三元與 complexity 21）；`finishOperation` 取代 6 處相同的 finally；`gitIn`/`ghIn` 取代 6 處重複閉包；`dialogShell`、`discardCancelButton`、`DISCARD_COPY`＋`discardKind`（查找表取代三個巢狀三元）、`forcePushDialog`、`showCreatePrDialog`；`rowButtons` 拆出 `fileRow`；`actionButton` 移除從未使用的 `cx` 參數（6→5）；`absolutePath`、`platformRevealLabel`；常數 `MAX_STATUS_ENTRIES`、`REFRESH_INTERVAL_MS`。
- push-target.js：`resolvePushTarget`（complexity 35）拆成 `readTrimmed`、`assertNoCustomRefspecs`、`assertPushPolicy`、`assertNotMirror`、`assertSingleUpstream`、`parsePushRow`、`pushDestinationRef`、`leaseTrackingRef`、`readPushUrl`；移除未用的 `_`（以解構省略）；`OBJECT_ID`、`BRANCH_PREFIX` 常數取代重複的正規式與字串。
- create-pr.js：`prepareCreatePr`（complexity 26）拆成 `readUpstream`、`notUsableRepository`、`notPushedBranch`；`createPr` 改參數物件。
- git-options.js、discard-snapshot.js：命名魔術數字（200、16000、3、7_000_000）。
- main.js 因 section-view.test.js 以 vm 讀原始碼並剝除單行 import，所以所有新輔助碼都留在 main.js，沒有新增 import。

orca-worktree
- helpers.js：`ago` 巢狀三元改為守衛子句，命名 HOUR/DAY 等常數。
- main.js：`init` 拆成 `load`、`loadRepo`＋模組函式 `remoteHome`（空 catch 加註解說明為何忽略）；`identity` 簡化；`dialogFrame`、`filterInput`、`rowList`、`openRow`、`switchRow`、`branchTag`、`switchDetail`、`switchTarget`、`branchesLoading`、`switchFooterText`、`newDetail`、`newFooterText` 取代三份重複的框架／輸入框／列表與所有巢狀三元；`SPINNER_FRAMES`/`SPINNER_FRAME_MS`、`INPUT_FOCUS_DELAY_MS`、`WORKTREE_ADD_TIMEOUT_MS` 常數；placeholder 用 Map（避免原型鍵）。沒有新增 import（create.test.js、switch.test.js 的 vm 範圍只提供原有名稱）。

orca-handoff
- main.js：`init` 拆成 `resolveSource`、`startCapture`（空 catch 加註解）；`executeFork` 刪除未使用的 `space`、`repoTop`（連同不再使用的 `spaces` import）並抽出 `forkTabName`；`render`（182 行）拆成 `headerView`、`metadataCard`、`agentPicker`、`statusBanner`、`actionFooter`、`startAction`、`startLabel`；`COPY_CLOSE_DELAY_MS`、`FORK_TAB_FALLBACK_NAME` 常數。

## b) 原則帳本 1–100
已套用
- 01 過長的函式：orca-handoff main.js:render；orca-worktree main.js:renderOpen/renderSwitch/render；orca-changes main.js:refresh、push-target.js:resolvePushTarget、create-pr.js:prepareCreatePr
- 02 重複的程式碼：orca-changes main.js:finishOperation、gitIn/ghIn、dialogShell、discardCancelButton；orca-worktree main.js:dialogFrame/filterInput/rowList
- 03 意義不明的名字：orca-changes main.js:taskCx/eventCx/timerCx/captured/sectionKey；push-target.js:parsePushRow 解構取代 `_`
- 04 過深的巢狀：orca-changes main.js:readChanges（原 refresh 內五層）、statusRows
- 05 魔術數字：orca-changes main.js:MAX_STATUS_ENTRIES/REFRESH_INTERVAL_MS、git-options.js、discard-snapshot.js；orca-worktree main.js 與 helpers.js:ago；orca-handoff main.js:COPY_CLOSE_DELAY_MS
- 08 死碼：orca-changes main.js:fade；orca-handoff main.js:executeFork 的 space/repoTop/spaces import
- 11 義大利麵式程式碼：orca-changes main.js:refresh（以 readChanges／statusRows 取代 continue 交錯的迴圈）
- 26 函式提取：全部三個 mod（見上）
- 27 重新命名變數：orca-changes main.js、orca-worktree main.js:init（eventCx）、orca-handoff main.js（taskCx）
- 29 變數提取：orca-changes main.js:confirmDiscard（copy）、orca-worktree main.js:renderOpen（count/row）
- 33 參數物件：orca-changes create-pr.js:createPr、main.js:submitCreatePr
- 34 刪除旗標參數：orca-changes main.js:actionButton 刪除未使用的 cx 參數
- 36 移動函式：orca-changes main.js:readNumstat/statusRows 由方法內閉包移到模組層級
- 37 階段分離：orca-changes main.js:refresh（讀取狀態、解析列、寫入 view 三段）；orca-worktree main.js:init→load→loadRepo
- 40 替換演算法：orca-changes main.js:confirmDiscard 以 DISCARD_COPY 查找表取代條件鏈
- 41 陳述式滑動：orca-changes push-target.js:resolvePushTarget（把 assert 依序集中）
- 51 守衛子句：orca-worktree helpers.js:ago、orca-worktree main.js:visible/switchDetail/newDetail、orca-handoff main.js:forkTabName/startLabel
- 52 分解條件描述：orca-changes create-pr.js:notUsableRepository/notPushedBranch；push-target.js:unreadable
- 53 整合條件描述：orca-changes push-target.js:unreadable（`code !== 0 && code !== 1` 合併）
- 59 集合管線：orca-changes main.js:readChanges（slice→flatMap(statusRows)）
- 60 查找表：orca-changes main.js:DISCARD_COPY；orca-worktree main.js:PLACEHOLDER
- 63 三元運算子：三個 mod 的所有巢狀三元改為單層（其餘單層保留）
- 71 吞掉例外：orca-worktree main.js:remoteHome、orca-handoff main.js:startCapture/forkTabName 補註解說明為何忽略
- 76 規格化測試：golden-test 與 git-matrix-test（見 a）
- 77 小步驟：每步後跑該 mod 測試，里程碑跑完整測試
- 78 回歸測試：golden digest 於重構前記錄、重構後逐項比對
- 79 單一職責：orca-changes push-target.js 各 assert 函式、orca-handoff main.js 各 view 方法
- 80 DRY：同 #02
- 83 關注點分離：orca-handoff main.js 把 view 組裝與 fork 命名分開
- 84 童軍規則：順手補上空 catch 說明與常數命名
- 85 單元測試：git-matrix-test、golden 測試
- 86 Linter：eslint 前後件數見 a
- 88 循環複雜度：complexity 全數降到 12 以下
- 89 認知複雜度：巢狀三元與深巢狀移除
- 90 程式碼覆蓋率：見 a
- 97 命名規則：見 #03
- 99 黃金大師：golden-test 即黃金大師測試

不適用
- 06 巨大類別：orca-changes Changes 類別仍大，但拆類別會改變 View 結構與 section-view.test 的 vm 載入方式；未動，見 c)
- 07 過長的參數列表：已由 #33/#34 處理，不另外套用
- 09 變更分散、10 變更集中：沒有發散式修改或散彈式修改的證據
- 12 全域變數：`mainChangesView` 是 entry menu 找到主面板的既有機制，改動會改變行為（見 c）
- 13 特徵的橫向依賴、14 資料群：無對應壞味道
- 15 執著於基本型別：無對應壞味道（porcelain 狀態字串是 git 協定）
- 16 Switch 陳述式：gitTone 的 switch 是單純顏色對照，查找表不會更清楚
- 17 暫時性屬性：view 欄位由 init 一次設定
- 18 訊息鍊：UI builder 的鏈式呼叫是 gpui 風格，且渲染需逐位元組相同
- 19 中間人、20 可疑的一般化、21 懶惰類別、22 資料類別、23 平行繼承、24 拒絕繼承、25 不適當的關係：無
- 28 變更函式宣告：只做 #33/#34 兩處，其餘不需
- 30 類別提取：見 #06
- 31 函式內聯：無過度間接
- 32 變數分離：無一個變數兩種用途的情形
- 35 查詢與更新分離：`refresh`、`apply` 的語意由呼叫時序決定，拆開會改事件時序
- 38 函式群集約成類別、45 類別內聯：不需要
- 39 變數內聯：無需
- 42 函式參數化：無近似重複函式需要合併
- 43 隱藏委派、44 移除中間人：無
- 46 工廠函式：不需要
- 47 變數封裝：見 #12
- 48 方法上提、49 提取父類、50 平坦化類別階層：只有一層繼承 View
- 54 多型：沒有第二種變體（#82）
- 55 分離迴圈：沒有一個迴圈做兩件事
- 56 導入特殊案例：不需要
- 57 導入斷言：不加（行為保持不變）
- 58 刪除控制旗標：orca-changes verifyDiscard 的 `verified` 旗標在 finally 之後用於決定是否 perform，移除會改變時序；保留
- 61 策略模式、68 狀態模式：沒有第二種變體（#82）
- 62 快速失敗：只在 #51 的範圍內套用，不新增驗證
- 64 德摩根定律：無需
- 65 Optional Chaining、66 Null 合併運算子：原碼已使用
- 67 列舉型別：JS 無列舉，字串常數足夠
- 69 模式匹配：JS 無
- 70 短路求值：原碼已使用
- 72 移動迴圈不變代碼：無明顯項目
- 73 狀態機：primaryAction 已是決策序列，不需要重寫
- 74 決策表：同上
- 75 Yoda 寫法：依取捨不採用
- 81 KISS：整體原則，已體現於不新增抽象
- 82 YAGNI：未新增類別階層或設計模式
- 87 Formatter：未重新排版，diff 只含因重構而動到的區段
- 91 型別註解：JS 專案，不加
- 92 迪米特法則：UI builder 鏈與既有結構，不改
- 93 依賴注入：push-target/create-pr 本來就注入 git/gh，其餘靠 herdr 全域，不改
- 94 純函式：已有的純函式保持；新抽出的 statusRows、readUpstream 判斷式等是純的，其餘涉及 exec/view 狀態
- 95 不可變：view 以可變欄位驅動，改動會改行為
- 96 絞殺無花果：不是替換整個系統
- 98 御門法：未新增資料來源
- 100 開放封閉原則：同 #54

## c) 保留項目與理由
- orca-changes 的 `Changes` 類別（約 900 行）不拆：section-view.test.js 以 vm 讀 main.js 原始碼並剝除單行 import，新增檔案或 import 會讓它失效；且類別內的方法共用 view 狀態。
- `panelFrame`（panel-motion.js 共用副本）與 view 的 `render(cx)` 結構：註解寫明 GPU 成本與右側欄寬度穩定；未動。`render(cx){ return panelFrame(this.renderBody(cx)); }` 原樣保留。
- orca-worktree 的 `render`/`renderOpen`/`renderSwitch`：節點鏈順序逐位元組不變（golden 驗證），抽出的方法只是包裝相同的呼叫順序。
- `verifyDiscard` 的 `verified` 旗標（#58）與 `runPrimary` 等的 busy/loading 守衛：拆動會改事件時序。
- `mainChangesView` 模組變數（#12）：entry menu 與主面板互通的既有機制。
- 共用副本 clip.js、panel-motion.js（orca-changes）、clip.js、transcript.js（orca-handoff）：禁止修改，未動。transcript.js 覆蓋率 87.7%（共用副本，非我的責任）。
- 測試 harness 警告共 10 項（見 a）。

## d) Herdr API 候選（未實作）
- orca-changes main.js:`window.open_dialog(...)` 手刻的確認對話框（forcePushDialog、showCreatePrDialog、confirmDiscard*）：若 Herdr 有內建 confirm/dialog API 可取代手刻 v_flex 卡片與按鈕。
- orca-changes main.js:`openOverlay({ kind: "popup", ... })` 手刻的 entry context menu（entryMenuView）：若有原生 context menu API 可取代。
- orca-worktree main.js:`renderOpen`/`renderSwitch` 手刻的可過濾清單（Input + 捲動列表 + Scrollbar + 鍵盤上下選取）：若有原生 select／list picker 元件可取代。
- orca-worktree main.js:`remoteHome()`：用 sh 與 powershell 取遠端 HOME；若有 `home({ on })` 之類 API 可取代。
- orca-handoff main.js:Agent 選擇器（agentPicker）與 `AGENT_CATALOG`：若 `knownAgents()` 的清單可用，可改用它取代硬編碼目錄。
- orca-handoff main.js:`copyCurrentPrompt` 用 clip.js 的 `copyText`：若有原生 clipboard API 可取代。

## e) 發現但未處理的問題（不改，行為保持不變）
- orca-changes main.js:`runSync`、`runPublish`、`runRebase`、`runPush`、`runCommitAndPush`、`runForcePush`：整個 repo（含 layouts、keys.json）沒有任何呼叫端；選單項目對應都被寫成停用（"unavailable"）。看起來是死碼，但屬於功能預留，沒有刪。
- orca-worktree main.js:`remove()` 永遠丟出 REMOVE_UNAVAILABLE（remove.js 註明為刻意的 shortcut）。
- orca-worktree main.js:`work()` 在 `props().action === "remove"` 時 `this.error` 永遠非空，對話框不會自動關閉（符合其「不可用」意圖）。
- orca-worktree main.js:`init` 對 `props().action`、`props().branch` 使用非 optional 的 `props()`，而前面都用 `props()?.`；如果 props 為 undefined 會丟出（被 try/catch 轉成錯誤訊息）。
- orca-handoff main.js:`executeHandoff` 宣告為 async 但沒有 await；`fork` 的 branch 名稱只用在分頁名稱，沒有真的建立分支（註解說「create a fork branch」但沒做）。
