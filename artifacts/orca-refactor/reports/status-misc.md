# status-misc 重構報告（orca-status / orca-tasks / orca-chrome / orca-agents / orca-panel-gap）

Branch refactor/status-misc，工作目錄 /Users/tonyyang/git/herdr-my-orca.worktrees/orca-refactor-status-misc。沒有 commit（協調者留下的 WIP commit f88e562 之後的修改仍未提交）。完整測試 523 項全過（基準 490 + 新增 33）；*.snap.json 沒有任何變更；沒有動 orca-ui/、scripts/、layouts/、keys.json、README、共用副本、其他 mod。

## 驗證方式
1. 完整測試：`node --test mods scripts orca-ui/features`，每個步驟後都跑，全過。
2. 黃金母版（#99，不在 repo 內）：這五個 mod 都沒有 render.snap.json，所以另寫 harness（scratchpad/sm/harness.mjs）。它凍結 Date.now、用有區別的主題色，把 status（65 種畫面）、tasks（600）、chrome（10800）、agents（6300）的 render 輸出，以及 usage／local-usage／wt-follow 的純函式（含 planFollow 400 組、probeLocal 數千組）、agents 轉錄解析（124 組）全部序列化成 92 MB 的 JSON。重構前的原始碼產生 golden.json，每一步之後用同一 harness 比對：全程 `cmp` 逐位元組相同（最後一次也是 identical）。
3. 新測試在未重構程式碼上通過：測試先寫、先在重構前跑過才開始重構；最後又把最終版測試複製到重構前的原始碼副本（scratchpad/sm/orig）再跑一次：97 項全過。備份在 .../reports/status-misc-baseline-tests/。

## a) 每個 mod：eslint 前後件數（依規則）
（eslint 9，`-c eslint.config.mjs`；最終版連新測試檔一起 lint 也是 0 件）

| mod | 前 | 後 |
|---|---|---|
| orca-status | 20：no-nested-ternary 6（local-usage 4、main 2）、no-shadow 7、complexity 6（main 3、usage 2、wt-follow 1）、max-lines-per-function 1 | 0 |
| orca-tasks | 9：no-shadow 2、complexity 2、max-lines 2、no-nested-ternary 3 | 0 |
| orca-chrome | 9：no-shadow 4（main 1、runner 3）、complexity 2、no-nested-ternary 2、max-lines 1 | 0 |
| orca-agents | 13：complexity 4、max-depth 1、no-nested-ternary 1、no-shadow 6、max-lines 1 | 0 |
| orca-panel-gap | 0 | 0 |
| 合計 | 51 | 0 |

覆蓋率（行／分支／函式）。「原始」指新增測試之前的測試：
- orca-status：原始 usage 97.4/—/93.8、local-usage 94.7/78.1/81.3、wt-follow 100/79/100，main.js 完全沒被載入（0%）。現在 all files 98.41/88.09/93.20（main.js 99.09/83.06/91.67）。
- orca-tasks：原始只有 tasks.js（98.94/88.09/100），main.js 0%。現在 main.js 99.45/84.97/82.35。
- orca-chrome：原始沒有任何測試（0%）。現在 main.js 96.06/81.40/63.64、runner.js 97.28/86.76/94.12。（tasks.js 是共用副本，81%，不是我的。）
- orca-agents：原始沒有任何測試（0%）。現在 main.js 96.29/82.72/86.59。
- orca-panel-gap：不變 99.12/83.33/100（沒有重構需求）。

新增測試檔（共 5 個，33 項）：
- mods/orca-status/status-flow-test.js（followMove 的新 space／遺失 pane 路徑、refreshUsage 節流與失敗、segment、resetIn 等 8 項）
- mods/orca-status/usage-edge-test.js（antigravity／omp 解析、formatTokens、statusline 4 項）
- mods/orca-tasks/tasks-flow-test.js（add／toggle／remove／stale write／runNow／saveEditor／卡片文字 7 項）
- mods/orca-chrome/chrome-flow-test.js（titlebar、footer、runner 的 seed／錯誤／fire 通知／probe／請求新舊 8 項）
- mods/orca-agents/agents-flow-test.js（標題優先序、project scope、時間字串、resume 6 項）

**未解決事項（請處理）**：這 5 個檔案命名為 `*-test.js` 而不是 `*.test.js`，原因是 scripts/orca-ui-manifests.test.js 會比對 orca-ui/app.mjs 的 in-place map 內各 mod 的 `tests` 清單與磁碟上的 `*.test.js`，新增 `.test.js` 會使它失敗，而我不能改 orca-ui/。`node --test` 仍會跑 `*-test.js`（已確認 523 項包含它們）。請擁有 orca-ui/app.mjs 的人把它們加進 orca-agents、orca-chrome（目前沒有 `tests` 欄）、orca-status、orca-tasks 的 tests 清單後，再改回 `.test.js`（改回後 eslint config 會忽略它們）。

## 做了哪些重構（皆已逐位元組驗證）
- no-shadow 全部改名：內層 `cx` 一律改為 tickCx／jobCx／clickCx／changeCx／timerCx，且仍使用內層那一個。chrome 的 sidebarFrame 內重複的區域 `find` 刪除（與模組層級 find 相同，純去重；sidebarFrame 的其餘結構不動）。
- 巢狀三元：resetIn、formatTokens、limit／codex 視窗標籤、statusline 百分比、titlebar 左邊距、reset 文字、最後一次執行的文字與色調、排程文字、messageText 改為守衛子句、小函式、`find`。
- status：planFollow 拆成 linkedCheckoutOf／ownSpaceOf／moveFor／planPane；followTick 拆出 agentCwds／knownSpaces；followMove 拆成 ensureTargetSpace／moveTerminalInto／landedTab／finishMove／till（輪詢參數命名 FOLLOW_POLL_MS／FOLLOW_WAIT_MS）；render 拆成 usageCluster／maintenanceGroup 與模組層級的 segment／mark／chip／detailChip／floatToggle；parseAntigravityOutput、parseOmpUsage 拆成 antigravityGroupBuckets／parseOmpEnvelope／ompBucket／ompReading。
- tasks：apply 拆成 apply／fail／tryWrite／adoptFreshText；render 拆成 pageHeader／taskSection；taskCard 拆成 taskCard／taskSummary 加模組函式；WRITE_ATTEMPTS、REFRESH_MS 命名。
- chrome：runner.js 的 124 行閉包 startTaskRunner 拆成模組層級 load／adopt／probeResets／snapshot／fire／serveRunRequest／runDueTasks／runCycle，常數 PROBE_TIMEOUT_MS／REQUEST_FRESH_MS 命名；render 拆出 footer 與 titlebarPad。
- agents：resolveProjectScope（含深度 5）拆出 addRepoPaths／findActiveGit；foldTitle 拆成 titleSourceOf／titleCandidate；parseOmpSession 拆成累加器加 foldTimeline／foldSessionRecord／foldMessage／foldRecord／parseRecordLine；renderBody 拆成 effectiveScopeOf／scopedHistory／searchedHistory／sessionList；刪除不再使用的 cx 參數；MAX_SESSIONS／SCAN_TIMEOUT_MS／REPAINT_MS／RESCAN_MS 命名。
- 空 catch 補上為什麼可忽略的註解（status 的 wtCheckout、agentCwds）；刪除重複的 JSDoc 行；local-usage 的 300／10080／1e10／20000 命名。
- 過程中發現並修正自己改寫時的一個細微差異：runner 的 `now - at < 60s` 若 at 非數字（NaN）原本是「不處理」，一度寫成「處理」，已改回並用測試固定。

## b) 帳本（principles.md 1–100）
01 已套用（status/main.js:followMove、render；tasks/main.js:taskCard、render；chrome/runner.js:startTaskRunner；agents/main.js:renderBody、parseOmpSession）
02 已套用（chrome/main.js 刪除重複 find；runner.js 的 adopt 取代兩份發布程式碼；usage.js 刪除重複註解）
03 已套用（內層 cx 改為 tickCx／jobCx 等；rawList、c 等不動：未被規則點名）
04 已套用（agents/main.js:resolveProjectScope 深度 5 降到 ≤4）
05 已套用（local-usage SESSION_MINUTES／WEEK_MINUTES／EPOCH_MS_FLOOR；agents MAX_SESSIONS 等；runner REQUEST_FRESH_MS；純版面像素值未命名）
06 不適用（沒有巨大類別；各 View 已用方法拆分）
07 不適用（沒有超過 5 個參數的函式；moveTerminalInto 等皆 ≤4）
08 已套用（agents scopeSwitch／searchBar／renderBody 的死參數 cx；status render 的 cx；tasks 的 `void event`）
09 不適用（重構未涉及變更分散）
10 不適用（無霰彈式修改的需要）
11 不適用（無意大利麵式跳轉）
12 不適用（只在測試用 globalThis 全域；mod 本身無新增全域）
13 不適用（無特徵橫向依賴需處理）
14 不適用（沒有重複出現的資料群需要物件化）
15 不適用（沒有執著於基本型別的需要）
16 不適用（無 switch；以查找式 if 守衛處理）
17 不適用（無暫時性屬性）
18 不適用（訊息鍊是 gpui builder 的固定寫法）
19 不適用（沒有中間人類別）
20 不適用（沒有可疑的一般化；未新增抽象）
21 不適用（無懶惰類別）
22 不適用（無資料類別）
23 不適用（無繼承）
24 不適用（無繼承）
25 不適用（無不適當關係）
26 已套用（status:ensureTargetSpace、moveTerminalInto、finishMove；agents:foldRecord；tasks:tryWrite 等）
27 已套用（所有內層 cx 重新命名）
28 已套用（agents:scopeSwitch／searchBar／renderBody 簽名移除未用參數，非對外）
29 已套用（status:detailChip 內 parts；tasks:lastRunText 的 outcome／note／fails）
30 不適用（YAGNI：以模組函式取代，未新增類別）
31 不適用（無需內聯）
32 不適用（無需變數分離）
33 已套用（status:planPane 以參數物件傳入 ctx；agents:parseOmpSession 的累加器 acc）
34 不適用（沒有旗標參數）
35 不適用（沒有查詢兼更新的函式需分離）
36 不適用（函式位置已合理；僅在同檔內上移 helper）
37 已套用（chrome/runner.js:runCycle 讀取→探測→請求→到期；agents:parseOmpSession 讀行→折疊）
38 不適用（未改成類別）
39 已套用（agents:parseOmpSession 的 updatedAt 內聯為 `acc.updatedAt ?? acc.createdAt`）
40 不適用（未替換演算法）
41 不適用（無需語句滑動）
42 不適用（無需函式參數化）
43 不適用（無委派可隱藏）
44 不適用（無中間人）
45 不適用（無類別內聯）
46 不適用（無需工廠）
47 不適用（無需封裝）
48 不適用（無繼承）
49 不適用（無繼承）
50 不適用（無繼承）
51 已套用（resetIn、formatTokens、limitLabel、titlebarPad、resetText、lastRunText、scheduleText、effectiveScopeOf、foldTitle）
52 已套用（agents:sharesRepo 與 isSameProject；tasks:fresh 判斷）
53 已套用（agents:titleCandidate 將多個回傳 current 的條件合併為 null 候選）
54 不適用（無多型需求；YAGNI）
55 不適用（沒有需分離的迴圈）
56 不適用（無特殊案例物件需求）
57 不適用（行為保持不變，不新增斷言）
58 已套用（status:moveTerminalInto 去掉 let tabId 控制變數；tasks:apply 以 return 取代）
59 已套用（usage.js:antigravityGroupBuckets 的 filter／map／flatMap；ompReading 的 map／filter(Boolean)）
60 不適用（只有 2–3 種分支，守衛子句更清楚；#60 查找表在 limitLabel 因原型鍵風險而不用）
61 不適用（無第二種變體，YAGNI）
62 已套用（status:ensureTargetSpace 找不到就立即 return null；agents:titleCandidate）
63 已套用（只保留單層三元）
64 不適用（無需德摩根轉換；runner 的 fresh 判斷刻意不轉換以保留 NaN 語意）
65 已套用（既有 ?. 保留；未新增）
66 已套用（既有 ?? 保留；`state.error || ""` 因語意相同改為單行）
67 不適用（無需列舉）
68 不適用（無狀態模式需求）
69 不適用（無模式匹配）
70 已套用（agents:parseRecordLine 與 messageText 的短路回傳）
71 已套用（status:wtCheckout、agentCwds 空 catch 加註解；其餘 catch 原本就有註解）
72 不適用（無迴圈不變代碼）
73 不適用（無狀態機）
74 不適用（無決策表）
75 不適用（不採用 Yoda）
76 已套用（5 個新測試檔、33 項，先於重構寫成並在重構前通過）
77 已套用（約 25 個小步驟，每步完整測試加黃金母版）
78 已套用（完整測試 523 項）
79 已套用（agents:foldRecord 與各 fold 函式；runner 的 load／probe／fire）
80 已套用（同 #02）
81 已套用（以守衛子句與小函式簡化，未加框架）
82 已套用（未新增類別或模式）
83 已套用（runner：IO 與排程分離；agents：解析、篩選、繪製分離）
84 已套用（順手修補只限被重構的區段；未碰其他程式碼）
85 已套用（新增 33 項單元／流程測試）
86 已套用（eslint 51 → 0，沒有使用 eslint-disable）
87 已套用（只改動被重構的區段，未重新排版整檔）
88 已套用（所有函式 complexity ≤12）
89 已套用（巢狀與長函式降低，守衛子句降低認知複雜度）
90 已套用（見 a) 覆蓋率，main.js 從 0% 升至 96–99%）
91 不適用（專案是純 JS，無型別註解體系）
92 不適用（gpui builder 鏈本身是固定寫法）
93 不適用（測試經由 stub 的 globalThis 注入，不改 mod 的依賴結構）
94 已套用（wt-follow:linkedCheckoutOf／ownSpaceOf／moveFor；usage:ompBucket；agents:titleCandidate 皆純函式）
95 已套用（agents:foldTitle 不改動 current，回傳新物件）
96 不適用（未做逐步替換舊系統）
97 已套用（tickCx／jobCx／clickCx／changeCx、ompBucket、finishMove 等有語意的名字；對外名稱未動）
98 不適用（無對外 API 變更）
99 已套用（scratchpad/sm/harness.mjs 黃金母版，逐位元組比對）
100 不適用（無新變體，YAGNI）

## c) 保留項目與理由
- orca-chrome/main.js:sidebarFrame 與 orca-*/panel-motion.js:panelFrame：GPU／畫格成本相關（註解說明用一個平面遮罩 quad 取代群組 opacity）。結構保留；只刪除 sidebarFrame 內與模組層級重複的區域 `find`（純去重，行為相同）。
- 共用副本（orca-tasks/tasks.js、orca-chrome/tasks.js、*/panel-motion.js）：依規定未碰。chrome/tasks.js 覆蓋率只有 81%、panel-motion.js（agents）73%，那是共用來源的問題。
- gpui builder 鏈的垂直長度（render 內的 `.child(...)` 鏈）：不為了湊行數而改變渲染結構；已拆到各 ≤60 行。
- `limitLabel` 沒有用查找表（#60）：物件查找對 `constructor` 之類的 kind 會取到函式，與原行為不同。

## d) Herdr API 候選清單（未改，僅列出）
- orca-status/main.js:wtCheckout／followTick（約 270–330 行）：以 git exec 加 hc get 每 3 秒輪詢 worktree；若 Herdr 提供 terminal cwd 變更事件或 git 狀態 API 可取代（我沒有證據它存在，只是候選）。
- orca-agents/main.js:gitCache（約 65 行）：直接讀 localStorage 的 "git.cache.v2"（Herdr 內部格式）；若有公開的 git 資訊 API 可取代。
- orca-chrome/runner.js:nextCommand 迴圈加 10 秒 timer：若 Herdr 有排程 API 可取代。
- 沒有其他可確認的手刻 UI 可換成 Herdr 內建元件。

## e) 發現但未處理的 bug／問題（行為保持不變，未修）
- orca-tasks/main.js:29、312、391：引用其他 mod 資料夾的素材（mods/orca-status/claude.svg、codex.svg、mods/orca-chrome/clock.svg、mods/orca-agent-manager/chevron-left.svg），違反「mod 只引用自己的資料夾、可單獨安裝」。
- orca-status/main.js:47 resetIn：resetTime 是無法解析的字串時會顯示 "NaNd NaNh"。
- scripts/orca-ui-manifests.test.js 與 orca-ui/app.mjs 的限制導致新測試只能用 `-test.js` 命名（見上）。
