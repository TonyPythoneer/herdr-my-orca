# 批次報告：shared-head-scripts（orca-ui/shared、panel/head、scripts）

worktree：/Users/tonyyang/git/herdr-my-orca.worktrees/orca-refactor-shared-head-scripts（branch refactor/shared-head-scripts），我沒有 commit。
開工時 `git status` 乾淨（HEAD 為 94cdf6f），沒有前人留下的未提交檔案，所以從頭做。工作中途協調者把我當時的成果存成 WIP commit f27a77f；本報告所述的重構與測試都在其中，之後只多一處修改。

## 驗收結果

- 完整測試：`node --test mods scripts orca-ui/features` 603 項全過（基準 490 + 新增 113），在最後一次修改（gpui-stub-loader 預設值）之後重跑。
- 工作區現況：成果已被協調者存成 WIP commit f27a77f（我沒有 commit）；其上只有一處未提交修改 scripts/gpui-stub-loader.mjs（panes 預設回 undefined，與原本一致）。
- `node scripts/build-orca-ui.mjs --check --out .` 結果 0：「32 managed file(s) match」（20 份共用副本 + 12 份 panel-head）。
- eslint（orca-ui、scripts）：23 件警告 -> 0 件。
- `git status` 沒有任何 `*.snap.json` 變更。沒有動 app.mjs、shared/manifest.json、layouts、keys.json、README。
- mods/ 下變動的 17 份檔案全是 `build-orca-ui.mjs` 重新生成的副本（未手改）。

## a) eslint 與覆蓋率

### eslint 前後（依規則）
| 檔案 | 規則 | 前 | 後 |
|---|---|---|---|
| orca-ui/features/panel/head/main.js | complexity（location 22、render 16） | 2 | 0 |
| | no-nested-ternary | 1 | 0 |
| | no-shadow（cx x4、on x1） | 5 | 0 |
| orca-ui/features/panel/head/panel-gating.js | no-nested-ternary | 2 | 0 |
| orca-ui/shared/agent-flyout.js | complexity（readValues 17） | 1 | 0 |
| | no-nested-ternary | 1 | 0 |
| orca-ui/shared/codex-provider.js | complexity（linkInfo 17） | 1 | 0 |
| orca-ui/shared/tasks.js | complexity（taskProblem 18、nextRunAt 31、runTask 21、claudeMetersSession 16） | 4 | 0 |
| scripts/build-orca-ui.mjs | no-nested-ternary | 2 | 0 |
| | complexity（undeclared 14） | 1 | 0 |
| scripts/orca-ui-manifests.mjs | complexity（checkFeatureShape 19、checkSharedItem 14） | 2 | 0 |
| | max-params（row 6 個參數） | 1 | 0 |
| 其餘（clip、list-viewport、panel-motion、review-store、transcript、where-error、orca-ui-fixture、gpui-stub-loader） | 全部規則 | 0 | 0 |

原始 JSON：reports/shs-eslint-before.json、reports/shs-eslint-after.json。

### 覆蓋率前後（行% / 函式%；原始輸出 reports/shs-cov-before.txt、shs-cov-after.txt）
共用來源有兩種量法：mods 副本（既有測試載入的那份，前後可直接比較）與來源檔本身（只有 scripts/opencode-launch.test.mjs 在重構前載入過 agent-flyout.js 來源；其餘來源檔重構前沒有任何測試直接載入，新增的 scripts/shared-*.test.mjs 才開始量到）。
| 檔案 | 前（行/函式） | 後（行/函式） |
|---|---|---|
| head/main.js | 未被任何測試載入（0/0） | 100.00 / 86.21（未涵蓋的函式是 on_click、on_mouse_down 箭頭函式：render 快照只記錄 on_* 名稱，不會執行它們） |
| head/panel-gating.js、panel-views.js | 100 / 100 | 100 / 100 |
| tasks.js 副本（mods/orca-tasks） | 98.94 / 100 | 99.76 / 100 |
| tasks.js 來源 | 無 | 99.52 / 97.83（未涵蓋 125-126 是 serializeTasks） |
| agent-flyout.js 副本（mods/agent-config） | 99.72 / 100 | 99.74 / 100 |
| agent-flyout.js 來源（opencode-launch.test.mjs 載入） | 64.17 / 5.88 | 78.78 / 59.26（新規格只針對有動的 readValues、opencodeCatalog、defaultValues） |
| codex-provider.js 副本（agent-config / agent-manager 兩組量測） | 98.90 / 100；76.24 / 83.33 | 99.00 / 100；79.60 / 85.71 |
| codex-provider.js 來源 | 無 | 68.50 / 66.67（規格只針對 linkInfo、presetFor、slugId、keyHint、validateHost；其餘函式由既有測試涵蓋副本） |
| transcript.js 來源 | 無 | 100 / 100 |
| build-orca-ui.mjs | 100 / 100 | 100 / 100（分支 93.33 -> 93.67） |
| orca-ui-manifests.mjs | 100 / 100（分支 88.68） | 100 / 100（分支 97.78） |
| where-error.mjs | 93.02 / 94.44 | 93.02 / 94.44（未涵蓋 70-72、76-78 是 main() 錯誤出口，沒有動它） |
| clip.js、review-store.js、list-viewport.js、panel-motion.js | 只有副本被既有測試涵蓋 | 沒有重構邏輯（clip、review-store 只加註解），數字不變，沒有新增測試 |

### 新增或修改的測試檔
新增（全部在重構前的程式碼上先跑過並全過，備份在 reports/shared-head-scripts-baseline-tests/）：
- orca-ui/features/panel/head/render.test.js + render.golden.json（24 項：13 個 location 情境、git 探測快取、5 秒 TTL、過期探測與舊答案丟棄、gating 後的工具列、fallback、command 橋接 init 迴圈、4 個狀態的整體 render 黃金記錄）；已列入 head/manifest.json 的 tests。
- scripts/shared-tasks.test.mjs（22 項：parseTasks、taskProblem 全部訊息、nextRunAt 全部分支、runTask、parseResets、resetMs、formatCountdown 等）
- scripts/shared-agent-flyout.test.mjs（7 項：defaultValues、readValues 各分支、opencodeCatalog 分組）
- scripts/shared-codex-provider.test.mjs（6 項：linkInfo、recordLink、presetFor、slugId、keyHint、validateHost）
- scripts/shared-transcript.test.mjs（10 項：escape 剝除、換行規則、截斷、兩種 prompt）
- scripts/orca-ui-manifests-shape.test.mjs（43 項：feature manifest 與 shared 項目每一則錯誤訊息、檢查順序）
修改（只加內容）：
- orca-ui/features/panel/head/panel-gating.test.js 加 1 項（無 gating／未知 gating／原型鍵 "toString" 一律顯示）；在重構前的 panel-gating.js 上也通過。
- scripts/gpui-stub-loader.mjs 加三行替身（`panes`、`focused`、`nextCommand`，分別走 `__herdrPanes`、`__herdrFocused`、`__herdrNextCommand`）；只有測試設了全域才有作用，三者未設定時都回 undefined，與原本 `() => undefined` 的預設完全相同，不影響其他批次的測試。其他批次若也改這個檔案，合併時會是同一區段的相鄰新增，需要人工合併。

說明：render 黃金記錄用 `render.golden.json`，而不是 `*.snap.json`，因為本批次禁止動任何 `*.snap.json`；機制同 mods 的 render.snap.json（檔案不存在時錄製，存在時逐項比對）。重構前後 golden 逐位元組相同。

## b) 帳本（principles.md 1-100）

01 已套用（tasks.js:nextRunAt、taskProblem、runTask、claudeMetersSession；head/main.js:location、render；codex-provider.js:linkInfo；agent-flyout.js:readValues；orca-ui-manifests.mjs:checkFeatureShape、checkSharedItem；build-orca-ui.mjs:undeclared）
02 已套用（codex-provider.js:HOST_ERROR 取代重複字串；tasks.js:codexResets 兩段重複的 window_minutes 判斷合併；tasks.js:DAILY_TIME 取代兩處相同 regex）
03 已套用（head/main.js:find->findNode、n/c/f->node/child/hit、tint 的 a->alphaHex；tasks.js:startedAt->heldUntil）
04 已套用（head/main.js:refreshRepoState 以守衛子句取代三層 if/else；原本就沒有 max-depth 警告）
05 已套用（tasks.js:MS_PER_SECOND、MS_PER_MINUTE、SECONDS_PER_*、EPOCH_MS_FLOOR、DEFAULT_DELAY_SECONDS、NOT_RUN_CODE；head/main.js:PROBE_TTL_MS、TINT_ACTIVE、TINT_HOVER、INACTIVE_ICON；codex-provider.js:AVATAR_SIZE、KEY_HINT_*；transcript.js:各 char code 與 MAX_NEWLINE_RUN；build-orca-ui.mjs:EXIT_DRIFT、EXIT_USAGE、LINE_FEED；agent-flyout.js:DEFAULT_FALLBACK_EFFORT）。panel-motion.js 的 28、0.15、0.85 屬 GPU 公式，保留（見 c）
06 不適用（只有一個很小的 View 類別）
07 已套用（orca-ui-manifests.mjs:row 六個參數改為 root + 物件）
08 已套用（head/main.js:location() 回傳但沒人用的 `space` 欄位刪除；tasks.js:nextResetRun 內重複的 `last.code === 0` 判斷刪除，因為前面的 return 已排除）。匯出但沒有外部使用的名稱保留（見 e）
09 不適用（沒有發現散彈式修改的壞味道）
10 不適用（沒有發散式變更的壞味道）
11 不適用（沒有義大利麵式控制流）
12 不適用（head/main.js 的 gitCache 是刻意的跨 render 快取，行為必須保留；已改由 refreshRepoState 一處集中修改）
13 不適用（沒有特徵的橫向依賴）
14 已套用（head/main.js:refreshRepoState 以 `{ cwd, on }` 物件一起傳遞）
15 不適用（沒有以基本型別承載領域概念而造成問題的地方）
16 已套用（panel-gating.js:巢狀三元的 switch 式判斷改為 GATES 表）
17 不適用
18 不適用（沒有過長的訊息鍊）
19 不適用
20 不適用（沒有新增任何推測性的一般化）
21 不適用
22 不適用
23 不適用
24 不適用
25 不適用
26 已套用（tasks.js:retryAt、pingDelayMs、nextDailyRun、nextResetRun、execOptions、noteOf、triggerProblem、resetTriggerProblem、apiReportsSession；head/main.js:hostOf、scopeToProject、refreshRepoState、selectFallback、toolButton、collapseButton；codex-provider.js:parseLinkUrl、githubInfo；agent-flyout.js:readChecklist、readSelect、catalogGroup；build-orca-ui.mjs:driftReason、undeclaredInFeatureMods、unlistedSharedCopies；orca-ui-manifests.mjs:checkFeatureFields、checkFeatureNames、checkFeatureLists、checkSharedOutputs）
27 已套用（head/main.js:內層 cx 改 spawnCx／eventCx，內層 on 改 isActive，no-shadow 5 件歸零）
28 已套用（orca-ui-manifests.mjs:row 簽名；panel-gating.js:visibleTools 第二參數改為 state；皆為內部呼叫，對外名稱不變）
29 已套用（tasks.js:reported、heldUntil；head/main.js:focus、live）
30 不適用
31 不適用
32 不適用
33 已套用（orca-ui-manifests.mjs:row）
34 不適用（沒有旗標參數）
35 不適用（沒有發現查詢與更新混在一起的函式；refreshRepoState 的更新與 render 的查詢本來就分開）
36 不適用
37 已套用（build-orca-ui.mjs:undeclared 拆成兩個階段；head/main.js:render 的「定位、探測、gating、組畫面」；orca-ui-manifests.mjs:欄位、名稱、清單三階段檢查，檢查順序與錯誤訊息不變）
38 不適用（#82 YAGNI，沒有第二種變體）
39 不適用
40 不適用
41 不適用
42 不適用
43 不適用
44 不適用
45 不適用
46 已套用（head/main.js:emptyGitCache(resolved) 是 gitCache 記錄的工廠函式）
47 已套用（head/main.js:gitCache 的所有寫入集中在 refreshRepoState 與其探測回呼）
48 不適用
49 不適用
50 不適用
51 已套用（head/main.js:hostOf、scopeToProject、refreshRepoState、selectFallback；tasks.js:triggerProblem、taskProblem；build-orca-ui.mjs:driftReason）
52 已套用（tasks.js:isUnmetered、isKeyedSession、apiReportsSession、isArgvOfStrings；head/main.js:isInside）
53 已套用（tasks.js:nextResetRun 把「有上次成功執行」與「沒有」合併為 `lastAt === null ? 0 : …`）
54 不適用
55 不適用
56 不適用
57 不適用（不新增斷言，避免改變行為）
58 不適用（沒有控制旗標）
59 已套用（tasks.js:codexResets 以 `[primary, secondary].find(isObjectLike)` 取代兩段 if/else if）
60 已套用（panel-gating.js:GATES；codex-provider.js:PORT_PRESETS 取代連續的 if）
61 不適用（#82）
62 不適用
63 已套用（所有巢狀三元：main.js:location、panel-gating.js x2、agent-flyout.js:opencodeCatalog、build-orca-ui.mjs:plan 的三層三元，全部移除；只留單層）
64 已套用（head/main.js:refreshRepoState 的 `!isSameTarget || (isExpired && !pending)` 改寫為 `isSameTarget && !(isExpired && !pending)` 的提前返回）
65 已套用（head/main.js:onSshHost 改用 `activeSpace()?.machine`）
66 不適用（既有的 `??` 已是慣用寫法）
67 不適用
68 不適用（#82）
69 不適用
70 已套用（head/main.js:`isFolder = resolved && !ok`；tasks.js:isKeyedSession）
71 已套用（空 catch 補上為什麼可忽略的註解：clip.js x4、review-store.js x2、build-orca-ui.mjs:pathProblem、where-error.mjs x2、head/main.js 探測的 `.catch`、codex-provider.js x2、tasks.js:parseResets）
72 不適用
73 不適用
74 已套用（panel-gating.js:GATES 即決策表）
75 不採用（principles.md 明訂）
76 已套用（新增 render.test.js 與五份 scripts/shared-*／manifests-shape 規格測試，先在原程式碼通過）
77 已套用（小步驟；但每一步之後跑的是針對該檔的子集測試，完整測試只在加完測試、重構完共用來源、重構完 scripts、最後驗收這幾個檢查點跑，沒有逐步都跑完整套；最終完整套 603 項全過）
78 已套用（上述測試全部保留在 repo 作為回歸測試）
79 已套用（head/main.js:位置、探測、按鈕建構各自成函式）
80 已套用（同 #02）
81 已套用（只有函式提取與查找表，沒有加類別或框架）
82 已套用（沒有新增類別階層或設計模式）
83 已套用（head/main.js:location／探測／畫面分離）
84 已套用（agent-flyout.js、codex-provider.js、list-viewport.js、tasks.js 檔頭註解中已不存在的 `scripts/sync-shared.mjs` 改為 `scripts/build-orca-ui.mjs`）
85 已套用（同 #76，新增單元測試）
86 已套用（eslint 23 -> 0，未使用 eslint-disable）
87 不採用（principles.md 明訂；只改動因重構而動到的區段）
88 已套用（所有函式複雜度 <= 12）
89 已套用（以守衛子句與函式提取降低巢狀；專案沒有認知複雜度規則，無法量化）
90 已套用（見 a 的覆蓋率表；head/main.js 0 -> 100% 行）
91 不適用（JS 專案，沿用既有 JSDoc）
92 不適用
93 不適用（runTask 已經以參數注入 exec）
94 已套用（tasks.js 新抽出的 nextDailyRun、nextResetRun、retryAt、pingDelayMs、noteOf、execOptions 皆為純函式）
95 不適用（gitCache 為了保留行為仍原地更新）
96 不適用
97 已套用（常數用 UPPER_SNAKE，函式用動詞；對外名稱未改）
98 不適用
99 已套用（render.golden.json 為黃金記錄，重構前錄製，重構後逐位元組相同）
100 已套用（panel-gating.js:新增一種 gating 只要加 GATES 一項，不必改 visibleTools）

## c) 保留項目與理由

- orca-ui/shared/panel-motion.js:panelFrame（15-37）：GPU／畫格成本相關（檔內註解寫明「用平面覆蓋層取代 group opacity，避免 GPU 每格離屏繪製整棵子樹」），數字 28、0.15、0.85 是左側 sidebarFrame 公式的鏡像，不確定就不動；沒有 eslint 警告。
- head/main.js render() 的回傳鏈（h_flex 與 children／child 的順序、各 on_* 處理函式）：render 快照比對逐位元組，因此按鈕建構只是搬進 toolButton／collapseButton，鏈上順序與參數完全不變。
- head/main.js:gitCache 模組層級狀態與「原地更新」的探測回呼：這是刻意的跨 render 快取，改成不可變會改變事件時序。
- agent-flyout.js 中 `gap: 4`、`ROW` 的像素值等純版面數字：依規則不逐一命名。
- 匯出但沒有外部使用者的名稱（見 e）：屬對外匯出名稱，依規則不改。
- scripts/*.test.js 既有測試檔：沒有改動（它們不在 eslint 範圍，且已有 100% 行覆蓋）。

## d) Herdr API 候選清單（都是行為變更，這次沒有做；皆未驗證 API 是否存在）

- orca-ui/features/panel/head/main.js:refreshRepoState（約 61-80 行）：手刻的 `git rev-parse --show-toplevel` 探測加 5 秒快取，若 Herdr 提供「這個資料夾是否為 git repo」的狀態 API，可取代。
- orca-ui/shared/clip.js:copyText（9-32 行）：用 `exec("sh", …)` 呼叫 wl-copy／xclip／pbcopy／powershell 寫入宿主剪貼簿，若 Herdr 提供剪貼簿 API 可取代；reveal（34-44 行）：以 `open -R`／xdg-open 揭示檔案，若有「在檔案管理員中顯示」API 可取代。
- orca-ui/shared/review-store.js:loadReviewCache／saveReviewCache：自行同時寫 localStorage 與 setShared，若 Herdr 提供持久化的共享儲存 API 可取代。
- orca-ui/shared/tasks.js:301-315（RESET_SCRIPT）：以一段 `sh` 讀 ~/.cache/herdr-usage 與 ~/.codex，若 Herdr 提供用量或 reset 時間的 API（orca-status 已讀同一批檔案）可取代。
- orca-ui/features/panel/head/main.js:toolButton／collapseButton：手刻的玻璃膠囊按鈕，若 gpui-kit 有標準的 icon button 元件可取代（會改變渲染結構）。

## e) 發現但沒有處理的問題（行為保持不變，未修）

- orca-ui/shared/tasks.js:103-104（resetTriggerProblem）：`PROVIDER_LABEL[trigger.provider]`、`WINDOW_MINUTES[trigger.window]` 以普通物件查表，`provider: "constructor"` 這類原型鍵會通過驗證（應改用 Object.hasOwn）。windowMinutes()（tasks.js:128）與 providerLabel()（tasks.js:136） 的 `??` 查表同理。
- orca-ui/features/panel/head/main.js:64（refreshRepoState）：沒有任何資料夾時把狀態標為 resolved:true、ok:false，於是工具列改顯示「資料夾工作區」的項目（隱藏 Source Control）。可能是刻意的，但對「完全沒有 cwd」的視窗不一定合理；render.test.js 已鎖定目前行為。
- orca-ui/shared/transcript.js:55（findTerminalEscapeEnd）：沒有結尾的 OSC 序列只會吃掉 ESC 與 `]` 兩個字元，其後的內容保留；與 Orca 原始實作是否一致沒有比對。
- 匯出但整個 repo 沒有其他使用者（只有自身、測試或副本）：agent-flyout.js:DEFAULT_AGENTS；review-store.js:FOUND_REVIEW_TTL_MS、NO_REVIEW_REFRESH_INTERVAL_MS、reviewKey、recordReview、invalidateReview；tasks.js:latestDaily。屬對外名稱，這次保留。
- scripts/where-error.mjs:66-78（main() 的 manifest／輸入讀取失敗出口）沒有測試，行覆蓋 93%；沒有動它。
- head/main.js 的 on_click、on_mouse_down 處理函式沒有 flow 測試：gpui-stub-loader 的記錄器把函式引數轉成 "fn"，測試拿不到它們；這次只做了機械式的參數改名（cx -> eventCx）。
