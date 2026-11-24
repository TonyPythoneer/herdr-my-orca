# spaces-nav 重構報告（mods/orca-spaces、mods/orca-nav）

狀態：完整測試 524 項全過（基準 490；多出的是本批新增測試），*.snap.json 無任何變更，未 commit。分支 refactor/spaces-nav 上有兩個 WIP commit（前手所留），其後的修改皆為未提交。

## a) 量測

### eslint 件數（前 -> 後）
| mod | 規則 | 前 | 後 |
|---|---|---|---|
| orca-nav | complexity | 3 | 0 |
| orca-nav | max-lines-per-function | 1 | 0 |
| orca-nav | no-nested-ternary | 4 | 0 |
| orca-nav | no-shadow | 5 | 0 |
| orca-nav | no-unused-vars | 1 | 0 |
| orca-spaces | complexity | 9 | 0 |
| orca-spaces | max-depth | 2 | 0 |
| orca-spaces | max-lines-per-function | 4 | 0 |
| orca-spaces | max-params | 4 | 0 |
| orca-spaces | no-nested-ternary | 6 | 0 |
| orca-spaces | no-shadow | 23 | 3（保留，見 c） |
| orca-spaces | no-unused-vars | 7 | 0 |

orca-nav 合計 14 -> 0；orca-spaces 合計 55 -> 3。flow-host.mjs、flow-nodes.mjs（新增輔助檔）為 0 件。

### 覆蓋率（行 / 函式；前 = 本批新增測試之前的既有測試）
orca-nav main.js：90.00 / 82.46 -> 99.58 / 98.68（未覆蓋僅 95-96，projectChoices 的 catch）。
orca-spaces：
- main.js 29.59 / 21.05 -> 97.44 / 91.30
- cards.js 86.04 / 62.26 -> 99.51 / 97.26
- focus.js 36.92 / 8.33 -> 100 / 100
- tip.js 45.65 / 16.67 -> 100 / 100
- project.js 42.50 / 0 -> 95.83 / 100
- worktree-plan.js 94.14 / 87.69 -> 99.10 / 92.96
- review-store.js（共用副本，不可動）70.00 / 30.00
（「前」的 orca-spaces 數字是前手已把 git-refresh.test.js 改成載入真的 main.js 之後量的，所以 main.js 不是 0。）

### 新增 / 修改的測試檔
新增檔必須先列在 orca-ui/app.mjs（不可改），所以測試併入既有 *.test.js；另有不是 *.test.js 的輔助與黃金檔。
- mods/orca-nav/refresh.test.js：併入原 options.flow.test.js（已刪除），新增 popup 鍵盤、按鈕、各頁列、未知 row kind、每個視圖的摘要（sha256）比對
- mods/orca-nav/views.golden.json（新增）
- mods/orca-spaces/git-refresh.test.js：due、check（約 25 種遠端／失敗情境）、lookupPRByBranch、命令迴圈、menu／toggle／reconnect／checkSaved／forgetProject、card／header／machineHead／清單／已存專案的事件處理、focus.js、tip.js、tick／settleRows／watch、avatar
- mods/orca-spaces/render.test.js：header、machineHead、statusHead、prBadge、renderBody 各狀態的摘要比對（card 的 render.snap.json 原封不動）
- mods/orca-spaces/worktree-plan.test.js：300 組種子隨機的 projectWorktreePlan 摘要
- mods/orca-spaces/flow.golden.json、views.golden.json（新增）；flow-host.mjs、flow-nodes.mjs（輔助模組，非測試）

### 新測試在未重構程式碼上通過
重構前版本（含所有黃金檔）備份於 scratchpad/refactor/reports/spaces-nav-baseline-tests/，並實際複製進 HEAD 的原始碼副本（scratchpad/refactor/sn-orig）執行，85 項全過。黃金檔（views／flow／nav）一律是在未重構的 main.js／cards.js／focus.js 上錄製；worktree-plan 的摘要由前手重構前的版本算出，另以 2000 組隨機情境對照原始與現行 projectWorktreePlan，差異 0。
重構中僅因簽章改變而調整測試呼叫形式（tip／tipMark／stop／lookupPRByBranch 的參數物件化），黃金檔的內容未動。

## b) 帳本（principles.md 1–100）
已套用：
- 01 過長函式：cardView -> cards.js 內 agentRow／cluster／agentBlock／statusLane／cardText／dropIndicator 等；check -> readGitInfo 等；projectWorktreePlan -> unopenedMainRows／mergeWorktreeRows／orderedRepoRows 等（codex 前手）；nav renderBody -> projectsHeader 等
- 02 重複：main.js header 三處群組選單 -> openGroupMenu；兩處 space.new -> newSpaceIn；chromeFill；nav sidebarFrame 內重複的 find 刪除；nav 三個簡單按鈕共用 addProject
- 03 命名：tip／tipMark／stop 參數物件；taskCx／eventCx／hoverCx／clickCx；rowProps；stateWords；commonDir
- 04 巢狀：check 的 max-depth 6 -> 平坦的 fillRemoteIdentity／forkParent
- 05 魔術數字：MAX_RETAINED_OPERATIONS、TYPE_AHEAD_MS、MAX_SUMMARY_GROUPS、MAX_CLUSTER_ICONS、AGENT_ICON_SIZE（純版面像素不命名）
- 08 死碼：nav HISTORY／pushHistory／pageRow／main／shown；spaces 未用 import（image、theme、props、tint、enter）、asks、worktrees 變數
- 14 資料群：lookupPRByBranch 的 { base, head, branch }
- 26 函式提取：同 01，另有 menuTarget／gitFacts、machineStatus／machineConnect／machineAdd、savedProjectRow、publishProjectState、due 的四個階段
- 27 重新命名變數：見 03，no-shadow 23->3、5->0
- 29 變數提取：slug、stateWords、commonDir
- 33 參數物件：tip、tipMark、stop、lookupPRByBranch、addFinishedCommands
- 34 刪除旗標參數：不適用（stop 的 radius 是數值選項而非旗標，已併入選項物件，見 33）
- 36 移動函式：isBusy、pullRequestState、reviewFromPullRequests 移到模組層
- 37 階段分離：check -> 讀 status／讀 identity／讀 remote／讀 worktree 清單；due -> 首次／移動／指令結束／主機回來／fallback
- 39 變數內聯：check 內 info.branch 迴圈 -> branchOf
- 40 替換演算法：不適用（沒有改演算法）
- 51 守衛子句：nav act、releaseCard、fillRemoteIdentity、pullRequestState
- 52 分解條件描述：isBusy、isTypeable、needsFirstLook
- 58 刪除控制旗標：nav act 的 return 連串 -> 查找表加單一出口
- 59 集合管線：summaryGroups
- 60 查找表：nav OPTION_PATCH／VALUE_TEXT／CHECK_KINDS；spaces PR_ICONS／PR_TONES（皆 null prototype）
- 63 三元：巢狀三元全部改成查找表或 if（單層保留）
- 65 Optional Chaining：本批沿用既有，無新增
- 71 吞掉例外：nav readOptions／projectChoices、spaces refreshCatalog／readRemoteIdentity／refreshMachines／reconnect／project.js ensureAvatar 的空 catch 都加了說明
- 76 規格化測試：見 a)
- 77 小步驟：每步跑完整測試
- 78 回歸測試：flow／golden 測試留在 repo
- 79 單一職責：cardView 只組合；各子畫面各一函式
- 80 DRY：同 02
- 81 KISS：不引入類別或模式
- 83 關注點分離：git 讀取（readGitInfo）與狀態寫入（check）分開
- 84 童軍規則：順手加了未動到的空 catch 說明與常數名
- 85 單元測試：focus.js、tip.js、menuJump 的表格式測試
- 86 Linter：以 eslint.config.mjs 量測，不用 eslint-disable
- 88 循環複雜度：complexity 12 全部達標
- 89 認知複雜度：隨 88 與巢狀三元消除而降低
- 90 程式碼覆蓋率：見 a)
- 94 純函式：branchOf、pullRequestState、reviewFromPullRequests、summaryGroups、cardTitle、cardGeometry、menuJump 的 isTypeable
- 97 命名規則：新函式動詞開頭、常數全大寫
- 99 黃金大師：views／flow／nav 黃金檔與 sha256 摘要
不適用：
- 06 巨大類別（Spaces 類別方法多但同為一個 View，拆類別會改變 retained-row／perf 探針所依賴的結構）、07 長參數列（以 33 處理，已列於 33）、09、10、11、12（模組層 avatar 集合是既有的跨實例快取，不動）、13、15、16、17、18、19、20、21、22、23、24、25 本批無此壞味道或改動會改行為
- 28 變更函式宣告（對外名稱不可改；內部簽章改動已記於 33）、30 類別提取、31 函式內聯、32 變數分離、35 查詢與更新分離、38 函式群集約成類別、41 陳述式滑動、42 函式參數化、43 隱藏委派、44 移除中間人、45 類別內聯、46 工廠函式、47 變數封裝、48–50 繼承相關：不適用（YAGNI，無真實需要）
- 53 整合條件描述、54 多型、55 分離迴圈、56 導入特殊案例、57 導入斷言、61 策略模式、62 快速失敗、64 德摩根、66 Null 合併（沿用既有）、67 列舉型別、68 狀態模式、69 模式匹配、70 短路求值、72 移動迴圈不變代碼、73 狀態機、74 決策表、75 Yoda（不採用）：不適用或不需要
- 82 YAGNI：全程遵守（未新增類別階層）
- 87 Formatter：不採用，沿用現有格式，只動重構到的區段
- 91 型別註解：此 repo 為純 JS，不適用
- 92 迪米特法則、93 依賴注入（測試以 globalThis 替身注入，無需改碼）、95 不可變、96 絞殺無花果、98 御門法、100 開放封閉：不適用

## c) 保留項目
- orca-spaces/main.js init() 的三個 no-shadow（`cx.timer.every(15000, cx => ...)`、`(250, (cx) => ...)`）：scripts/perf-spaces.py、perf-spaces-virtual.py 以這幾行的**精確文字**做 replace_once，且被 perf-spaces-virtual.test.js 測試；scripts/ 不可改，改名會讓該測試失敗。
- orca-spaces/main.js renderBody：未動 shUnread、colors、ensureAvatar 迴圈、savedRows 宣告、`.children(rows.length ? this.grouped(...)`、space-list／loading row 的文字，同上（perf probe 依賴）。只抽出 savedProjectRow 與 publishProjectState，後者不在探針的錨點內。嘗試把 space-content 整段抽成方法會讓 perf-spaces-virtual 測試失敗，已還原。
- init 的 15000／250 計時數字、`const saved = ...`：同上，不能命名。
- GPU／畫格：兩個 mod 的 sidebarFrame（不透明度改成一個平面遮罩的結構）、header 的 hover cluster 以 opacity 淡入而非掛卸、syncRetained 的每幀上限，結構一律未動（只刪掉 nav 版本內重複的 find、為 16 取名）。
- review-store.js 是 orca-ui/shared 的產生副本，未動；card／row 的 retained entity 流程未動。
- worktree-plan.js 內 applyWorkspaceOptions 未動（已無 eslint 件數）。

## d) Herdr API 候選
- orca-nav/main.js:~92-97、spaces/main.js:~1193（savedRows）：手刻的 `projects.saved.v1` localStorage 專案清單，若 Herdr 有專案目錄 API 可取代
- orca-nav/main.js:~169-182 與 spaces 的 popup 選單：手刻的 Radix 風格 DropdownMenu（鍵盤上下／Home／End、子頁），若 Herdr 提供選單 primitive 可取代（optionsView、menuRow、act）
- orca-spaces/focus.js 全檔：手刻 T3 focus-visible（kit 沒有 focus_visible 與輸入模態）；tip.js 的 HoverCard 當 tooltip（`.tooltip()` 只吃字串）
- orca-spaces/main.js 的 refreshMachines／reconnect：以 `hc machine ls/rm/add` 手刻重連，若有 machine API 可取代
- orca-spaces/project.js ensureAvatar：以 exec curl／convert 下載頭像，若有 image-from-URL API 可取代
- orca-spaces/main.js 的 watch()＋60 秒 fallback：若有 repo 變更事件 API 可取代輪詢
- orca-nav 的 pickFolder 已是 Herdr API，沿用

## e) 發現但未處理的 bug（行為保持不變，未修）
- orca-spaces/main.js:1196：`s.folder && s.folder === folder || s.folder.startsWith(...)` 運算子優先序；space 的 folder 為 null/undefined 時 `.startsWith` 會丟例外，整個 renderBody 失敗
- orca-nav/main.js:189：addProject 對 `projects.saved.v1` 的 JSON.parse 沒有保護，壞值會讓 promise 被拒絕而無聲失敗（另一處 spaces 的 stored() 有保護）
- orca-spaces/cards.js:50：`AGENT_ICON_OVERRIDES[a.app]` 是一般物件，app 名為 `constructor` 等 Object.prototype 成員時 override 會是函式，`.endsWith` 丟 TypeError（本批新加的 PR_ICONS 等已用 null prototype，這個沿用原樣）
- orca-nav 資料夾內 arrow-left.svg、arrow-right.svg（歷史箭頭）已無任何引用（HISTORY 死碼已刪），但檔案不可刪
- orca-spaces/main.js:1196 同一處（被 saved 列過濾）在 perf 探針中被替換成空陣列，所以探針不會暴露它
- 兩個 mod 各有一份 sidebarFrame（因 mod 只能 import 自己資料夾），日後改一處要同步另一處
- 前手留下的 flow.golden.json 曾因測試失敗而被寫成部分內容；已刪除並在未重構程式碼上重錄，測試也已改成不會自動寫黃金檔（缺檔時直接失敗）
