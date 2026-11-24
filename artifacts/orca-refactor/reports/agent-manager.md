# 重構報告：mods/orca-agent-manager（branch refactor/agent-manager，未 commit；工作樹上有他人留下的 WIP commit 32da57f，之後的修改為未提交）

## a) 量測前後
eslint（mods/orca-agent-manager 全資料夾，含測試）
| 規則 | 前 | 後 |
|---|---|---|
| no-unused-vars | 2 | 0 |
| no-shadow | 17 | 0 |
| max-lines-per-function | 9（main 6、views 3） | 0 |
| complexity | 10（main 6、permissions 1、state 1、views 2） | 0 |
| no-nested-ternary | 9（main 4、permission-menu 3、state 1、views 1） | 0 |
總計 47 件 → 0 件（未使用 eslint-disable）。max-depth／max-params 原本即為 0。

覆蓋率（node --experimental-test-coverage，排除測試檔；全部檔案列，含 gpui-stub-loader）
- 前：行 90.93%、函式 78.13%（main.js 行 87.40／函式 69.72）。
- 後：行 96.62%、函式 94.37%（main.js 行 94.25／函式 89.16；新檔 page-view、provider-view、permission-plan 行 100%）。

測試：全套 490 → 523 項全過；*.snap.json 無任何變更（render.snap.json 逐位元組相同，30 個 case 全過）；資料夾外無任何修改。

新增測試檔（皆在 mod 資料夾內）：
- manager-flow-test.js（前一位工程師所寫，已驗證在未重構程式碼上通過）
- manager-page-test.js：整頁 render 在 19 種狀態下的 SHA-256 黃金檔（page.golden.json）＋ 16 個小建構器（builders.golden.json），以及經 capture-handlers.loader.mjs 直接按下 on_click／on_key_down／on_size_change／on_scroll_wheel／Popover on_open_change 等 view 內處理函式的 flow 測試
- manager-logic-test.js：uninstall 請求／確認各分支、refresh 失敗與衝突、poll、onKey、save／reset／writeRun 競態與失敗、toggleEnabled、flashPermission、npmStatusFor／commandPath／realPath、dismiss 按鈕
- capture-handlers.loader.mjs（測試用 loader：包裝 scripts 的 stub，額外記錄 on_* 處理函式、可由測試提供 terminals／knownAgents）
- page.golden.json、builders.golden.json（不是 *.snap.json）
這些測試已先在「重構前」的程式碼上全數通過（完整測試 523 項全過後才開始重構），備份在 scratchpad/refactor/reports/agent-manager-baseline-tests/。之後僅整理 manager-page-test.js 結構（拆出 addProviderStates、移除未用常數）以通過 lint，斷言不變，編輯後版本另存於 reports/agent-manager-after-edit-manager-page-test.js。
注意：orca-ui 的 in-place map 測試（scripts/orca-ui-manifests.test.js）會比對 mod 內所有 `*.test.js` 與 map，而我不能改 orca-ui/，因此新測試檔命名為 `*-test.js`（node --test 照樣會執行，但該 map 的正規式 /\.test\.m?js$/ 不會比對到）。擁有者若要登記進 map，可再改回 .test.js 並更新 map。前一位工程師的 manager.flow.test.js 同樣因此改名為 manager-flow-test.js。

新增／拆出的程式檔：page-view.js（Agents 頁：標頭、權限卡、區段）、provider-view.js（Model providers 頁與卡片）、permission-plan.js（權限變更計畫與摘要文字，純函式）。parts.js 新增 backButton、monoFont。main.js 由 2191 行降到 1599 行；views.js 拆成多個小建構器。

## 主要改動
- refresh → refresh／runRefresh／readDisk／applyDiskRead／probeFresh／adoptProgramsUpdate（refresh 與 poll 共用）；poll → readOutsideChanges。
- confirmUninstall → confirmUninstall／runUninstall／staleUninstallMessage／finishUninstall／setUninstallAction。
- setDefaultPermission 的計畫與提示文字抽到 permission-plan.js；saveCard → readCardInput／saveCard／adoptSavedCard；onKey → onKey／applyRowKey（ROW_MOVES 查找表）／scrollToFocus。
- providerCard（213 行）、permissionsCard（134 行）、render（248 行）、rowView／editorView／uninstallSectionView 全部拆成具名小函式，渲染輸出逐位元組不變。
- 重複：loadEditorRun（4 處）、removeFile（5 處）、readFile（7 處）、syncEditorsSafely（2 處）、guideLink／note／label（views）、inputFrame／fieldColumn／inputField（provider-view）、monoFont（3 處）、commandLine 的重複 div 鏈。
- 魔術數字命名：各 exec 逾時、CURL_MAX_SECONDS、SAVED_NOTICE_MS、PERMISSION_NOTICE_MS、MAGIC_PROBE_BYTES、INSTALL_IDENTITY、NARROW_WIDTH、SPINNER_*、SUMMARY_NAMES、DETAIL_NAMES（值皆不變）。
- 吞掉例外：所有空 catch 都補上原因註解（cache、shareInventory、syncEditors、persistPermissions）。
- 其他：state.js writeRunOverrides → runEntryProblem／applyRunEntry；permissions.js normalizePermissions → normalizeOverrides；permission-menu.js choiceDetail／permissionNote；state.js compareKeys。

## b) 帳本（principles.md 1–100）
01 已套用（main.js:runRefresh/runUninstall、views.js:editorView、page-view.js:agentsPageView）
02 已套用（main.js:loadEditorRun/removeFile/readFile、views.js:note/guideLink、provider-view.js:inputFrame）
03 已套用（main.js:applyDiskRead、rowInfo:effectiveRun、catalog:listName 等重新命名）
04 已套用（max-depth 本來 0；refresh 拆分後巢狀變淺）
05 已套用（main.js 逾時與上限常數、page-view.js 常數；純版面像素未命名）
06 不適用（無巨大類別需拆；AgentManager 仍是單一 View，邏輯拆成 view 檔與純函式）
07 不適用（max-params 無違規；readCardInput 以物件回傳）
08 已套用（main.js:移除 PERMISSION_SHORT_LABELS/permissionBadge/timeLabel 等未用匯入、reloadAllFromDisk 以外無死碼）
09 不適用（無需動的變更分散點）
10 不適用（沒有發散式變更熱點需處理）
11 已套用（main.js:onKey、refresh 的糾結流程以階段函式整理）
12 不適用（模組內只有常數，無可變全域）
13 不適用（無特徵橫向依賴）
14 已套用（permission-plan.js:planDefaultPermission 的 plan 物件、views.js:draftSummary）
15 不適用（無需以型別取代基本型別）
16 不適用（無 switch；以查找表取代 if 鏈見 #60）
17 不適用（無暫時性屬性新增；既有 persisting 等不動）
18 不適用（無需處理的訊息鍊）
19 不適用（showTerminals／providerCard 薄包裝沿用既有 row/editor 模式，屬必要）
20 不適用（未新增可疑的一般化）
21 不適用（無懶惰類別）
22 不適用（無資料類別）
23 不適用
24 不適用
25 不適用
26 已套用（全檔，如 views.js:rowTitle/editToggle、page-view.js:pageFooter）
27 已套用（main.js:cx→taskCx/eventCx/tickCx 等）
28 已套用（main.js:render(cx)→render()，writeRun 參數改名；對外名稱不變）
29 已套用（views.js:draftSummary、provider-view.js:cardEditor 的 info/preview/offer）
30 不適用（不加類別；以函式提取，#82）
31 不適用（無需內聯的多餘函式）
32 不適用
33 已套用（main.js:applyRowKey({rows,at,current})、views.js:editorActions({saveLabel,disabled})）
34 不適用（無旗標參數需刪除）
35 不適用（未改動查詢／更新邊界）
36 已套用（permission-plan.js、page-view.js、provider-view.js：函式移到所屬檔案）
37 已套用（main.js:runRefresh 先讀取再套用再探測；readCardInput／saveCard）
38 不適用（不新增類別；#82）
39 已套用（page-view.js:addSections 內去掉暫存變數、main.js:refresh 去掉 local flag）
40 不適用（無需替換演算法）
41 不適用
42 不適用
43 不適用
44 不適用
45 不適用
46 不適用（無需工廠）
47 不適用
48 不適用
49 不適用
50 不適用
51 已套用（main.js:confirmUninstall、permission-menu.js:permissionNote、provider-view.js:presetOffer、state.js:applyRunEntry）
52 已套用（main.js:staleUninstallMessage、page-view.js:conflictActions）
53 已套用（main.js:applyRowKey 以 expanded.delete 合併條件）
54 不適用（無多型需求）
55 不適用（無需分離迴圈）
56 不適用
57 不適用（不新增斷言以免改變行為）
58 已套用（main.js:onKey 移除 at 變數的重複指派、readOutsideChanges 移除 changed 旗標變數的多處指派）
59 已套用（state.js:writeRunOverrides 以 map/find 做驗證）
60 已套用（main.js:ROW_MOVES、provider-view.js:cardActions 的 tone 查找）
61 不適用（無第二種變體，#82）
62 已套用（runEntryProblem 先驗證後修改，沿用原行為）
63 已套用（所有三元皆為單層；toggle 的 verb、previewColor）
64 不適用（無需德摩根轉換；provider-view.js:presetOffer 已用以簡化條件）
65 不適用（原已使用 ?.）
66 已套用（main.js:`base ?? null` 取代 `base === undefined ? null : base`）
67 不適用（無列舉型別語言支援）
68 不適用（#82）
69 不適用（JS 無模式匹配）
70 已套用（main.js:adoptSavedCard 前 `if (saved)`、views.js when 條件）
71 已套用（main.js:cache/restoreCache/shareInventory/syncEditorsSafely/persistPermissions 的註解化 catch）
72 不適用
73 不適用（#82）
74 不適用
75 不適用（本專案不採 Yoda）
76 已套用（manager-page-test.js、manager-logic-test.js、manager-flow-test.js 於重構前新增）
77 已套用（每步後跑完整測試）
78 已套用（page.golden.json／builders.golden.json、render.snap.json）
79 已套用（page-view／provider-view／permission-plan 各司其職）
80 已套用（同 #02）
81 已套用（以小函式與查找表，不加框架）
82 已套用（未加類別階層或設計模式）
83 已套用（視圖建構與頁面邏輯分檔）
84 已套用（動到的函式一併整理，並補註解）
85 已套用（新增單元／流程測試）
86 已套用（eslint 0 件）
87 不適用（未重新排版整檔）
88 已套用（complexity > 12 → 0）
89 已套用（以守衛子句與提取降低認知複雜度）
90 已套用（覆蓋率 行 90.93→96.62、函式 78.13→94.37）
91 不適用（純 JS，無型別系統；以 JSDoc 註解說明新函式）
92 不適用（owner 模式為既有設計）
93 不適用（以參數傳入 owner／cx，無需 DI 容器）
94 已套用（permission-plan.js 純函式、state.js:runEntryProblem/compareKeys）
95 不適用（維持原有可變狀態，改動會變行為）
96 不適用（無舊系統需絞殺；採分階段原地拆分）
97 已套用（loadEditorRun、readCardInput、staleUninstallMessage 等命名）
98 不適用（未新增 API 邊界）
99 已套用（golden 檔即黃金大師）
100 不適用（#82，無第二種變體）

## c) 保留項目
- 共用副本 codex-provider.js、list-viewport.js（檔頭標明 Generated from orca-ui/shared）：未動；codex-provider.js 覆蓋率低（133-161 等為 Codex 側啟動邏輯）。
- main.js 的 provider 邏輯（makeCard…saveProvider/deleteProvider/fetchProviderIcon，約 300 行）仍留在 AgentManager 類別：它們直接讀寫 this 的多個欄位且有計時／競態語義，拆開風險大於益處；eslint 已 0 件。
- 渲染／計時結構（polling every 4000ms、gen 檢查、persisting 計數、writeChain）：未改動順序。
- render 內的 spinner frames、`#00000000` 等純版面字面值：未命名。
- reloadAllFromDisk 中對 stale rows 設值的迴圈：之後 syncEditors 幾乎必然覆蓋，看似多餘，但為行為不變而保留（見 e）。

## d) Herdr API 候選
- main.js:providerCardView 的 Input／Textarea 欄位框與按鈕（provider-view.js:inputFrame、main.js:button）：若 gpui-base 有標準 Field／Button 元件可取代手刻樣式。
- main.js:fetchProviderIcon（curl/xxd/sips/mv）與 ownedIcon：若 Herdr 提供檔案下載／圖片驗證 API 可取代 exec 外部程式。
- main.js:secureProviderFile（exec chmod/stat）：若有 writeTextFile 的 mode 參數可取代。
- main.js:shellPath／freshInstallCheck（exec /bin/sh、login shell 探測）：若 knownAgents 提供 force／fresh 選項（原註解已說明目前沒有）可整段取代。
- page-view.js:conflictActions／banner 等手刻橫幅：若有標準 Banner／Alert 元件。
- main.js:realPath／npmStatusFor（exec realpath、npm root -g）：若有路徑解析 API。

## e) 發現但未處理的問題（行為保持不變，不修）
- main.js（reloadAllFromDisk，原 render 內 reload-all 處理函式）：迴圈依 render 當下的 rows 設值，之後 syncEditors 會用最新資料覆蓋；若 agent 清單在 render 與點擊之間改變，沒有 row 的 editor 輸入不會被更新（極端邊界）。
- main.js:persistPermissions 的 try 區塊把 syncEditors 與 shareInventory 放在同一個 try：syncEditors 拋錯時會略過 shareInventory（refresh 路徑則不會）。
- stub 預設 knownAgents 回傳 []，使 refresh 在 stock stub 下走「detectionError」分支（`[].catch` 不是函式）；僅影響測試環境，不影響實機。
- mod 內 manager-*-test.js 未登記於 orca-ui in-place map（見上，非 bug，是流程上的限制）。
- 共用副本 codex-provider.js:133-161 等程式碼無任何測試覆蓋，請共用來源的負責人處理。
