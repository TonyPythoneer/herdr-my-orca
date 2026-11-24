# config-menus 重構報告（branch refactor/config-menus，未 commit 的修改）

範圍：mods/agent-config、mods/orca-new-menu、mods/orca-split-menu、mods/orca-menu。只改各 mod 的 main.js 與新增測試；共用副本、*.snap.json、orca-ui/、scripts/ 未動（git 驗證：沒有 *.snap.json 變更）。

## 驗證狀態
- 完整測試：506 項，505 過，1 項失敗：scripts/orca-ui-manifests.test.js「every mod is a feature or has one in-place map entry」。原因：該測試要求 orca-ui/app.mjs 的 in-place map 列出每個 mod 磁碟上所有 *.test.js，而我被禁止改 orca-ui/。需由協調者在 orca-ui/app.mjs 補（不動 main.js，只加 tests 清單）：
  - agent-config: + mods/agent-config/flyout.golden.test.js, mods/agent-config/settings.flow.test.js
  - orca-menu: + mods/orca-menu/menu.flow.test.js, mods/orca-menu/menu.golden.test.js
  - orca-new-menu: + mods/orca-new-menu/menu.flow.test.js, mods/orca-new-menu/menu.golden.test.js
  - orca-split-menu（目前沒有 tests 鍵）: tests: [mods/orca-split-menu/actions.flow.test.js, mods/orca-split-menu/menu.golden.test.js]
  補完後其餘 506 項全過（我未能實際跑補完後的版本，因為不可改 app.mjs）。
- 前一位 worker 留下的測試：settings.flow / menu.flow / actions.flow 在未重構程式碼上先驗證；其中 orca-menu/menu.flow.test.js 有一個錯誤斷言（把 "Split Terminal Down" 當成有分隔線，實際分隔線在第一個 split 列 "Split Terminal Right"），已更正斷言（沒改 main.js）。
- 上一次 WIP commit 的 44,000 行是我寫的 golden JSON（美化排版的完整輸出，每個 1–1.5 萬行）。沒有 *.snap.json 被改。已改成只存每個「場景 × 區段」的 sha1 摘要（canonical key 排序），四個 golden 合計約 600 行；完整原始輸出備份在 reports/config-menus-baseline-tests/。

## a) eslint 與覆蓋率
eslint 件數（前 → 後，全部規則）
- agent-config: max-lines-per-function 2→0, no-shadow 9→0, complexity 4→0, no-nested-ternary 6→0, max-params 1→0
- orca-new-menu: max-lines-per-function 1→0, complexity 3→0, no-shadow 10→0, no-nested-ternary 3→0
- orca-split-menu: no-shadow 4→0, max-lines-per-function 2→0
- orca-menu: no-unused-vars 1→0, max-lines-per-function 3→0, complexity 7→0, no-nested-ternary 12→0, no-shadow 4→0, max-depth 1→0
- 沒用 eslint-disable。

覆蓋率（行／函式 %，指定指令的目錄層級數字；main.js）
- agent-config: 前 82.14 / 62.42 → 後 97.75 / 78.92（目錄）；單跑 golden 95.84 / 89.11
- orca-new-menu: 前 47.86 / 42.31 → 後（目錄）51.04 / 79.38；單跑 golden 96.31 / 97.96（目錄層級數字被「stub loader 載入的 menu.flow 與 vm 載入的 golden」兩份報告合併拉低，不代表真實覆蓋）
- orca-split-menu: 前 76.67 / 68.97 → 後（目錄）74.62 / 78.46；單跑 golden 96.97 / 100（同上合併效應）
- orca-menu: main.js 以 vm 載入，指令預設不計入（前：無數字）；加 golden 後（vm filename 對應 main.js）重構前 98.22 / 97.62 → 後 98.46 / 97.74

新增的測試檔（在重構前的程式碼上全部先通過）
- mods/agent-config/flyout.golden.test.js + flyout.golden.json（18 個世界：codex/claude/opencode/pi × 新鮮／過期／無／舊 schema 快取、provider、遠端、launchNow、manager 停用、編輯器 JSON；每個世界記錄 init 結果、各種 open 狀態的 render 摘要、render 的每個事件處理函式（點擊、hover、按鍵）的效果、約 40 個方法操作的 run/exec/寫檔/狀態）
- mods/orca-menu/menu.golden.test.js + menu.golden.json（29 個場景 × rows/icons/separators/destructive/render/按鍵/hover/每列 choose 的對 host 要求/click；另 3 個單元測試）
- mods/orca-new-menu/menu.golden.test.js + menu.golden.json（9 個 host × rows/render/choose/按鍵/滾輪/hover/mouse-move/flyout 視窗位置/模型挑選流程）
- mods/orca-split-menu/menu.golden.test.js + menu.golden.json（7 個窗格配置 × rows/render/約 30 個按鍵/choose/hover/click）
- 前一位 worker 的：agent-config/settings.flow.test.js、orca-menu/menu.flow.test.js、orca-new-menu/menu.flow.test.js、orca-split-menu/actions.flow.test.js
- 備份（重構前版本，含 golden 與重構前 main.orig.js）：reports/config-menus-baseline-tests/<mod>/。golden 都是在未重構的 main.js 上錄的，並重跑兩次確認決定性，再用重構後程式碼比對通過。

## b) 帳本（principles.md 1–100）
01 已套用（orca-menu:items/choose/render、orca-split-menu:items/render、orca-new-menu:init、agent-config:init/modelList/buildLaunch/launch）
02 已套用（orca-menu:openConfirmClose/terminalRow/tabLabel/leadPane/focusPane；split-menu:splitRow/folderRow；agent-config:launchSpace/providerTooltip）
03 已套用（內層 cx→taskCx/eventCx；agent-config:providerGlyph 的 home→appDir；new-menu:run→override；orca-menu:fn 名稱如 copyOrPaste/splitThenSwap）
04 已套用（orca-menu:delete-all-tabs 的 max-depth 5→由 deleteAllTabs 展平）
05 已套用（orca-menu:CONFIRM_DIALOG 等視窗尺寸、CONTEXT_LINES/BUFFER_LINES；new-menu:FLYOUT_W/H、WINDOW_MARGIN、MENU_EDGE；agent-config:CLI_TIMEOUT_MS、INPUT_MOUNT_DELAY_MS）；純版面像素值未命名
06 不適用（各 mod 一個 View 類別，是框架介面；拆類別屬 YAGNI；以函式提取代替）
07 已套用（agent-config:selectBox 9 參數→物件）
08 已套用（orca-menu:未使用的 shared import 刪除）
09 不適用（無跨檔散彈式修改）
10 不適用（無需集中變更）
11 已套用（orca-menu:choose 的 310 行 if 鏈→動作表）
12 不適用（new-menu 模組層快取 agentsByMachine 等是有意的跨開啟快取，保留）
13 不適用（無特徵橫向依賴）
14 已套用（new-menu:{machine,key,inventory,cached} 一組資料以參數物件傳遞給 refreshCatalog）
15 不適用（無基本型別執著問題）
16 已套用（orca-menu:items 的 switch 仍是單層派遣，各分支提取成函式；其餘 switch 為查找表取代）
17 不適用（View 實例欄位為框架慣例）
18 不適用
19 不適用
20 不適用
21 不適用
22 不適用
23 不適用
24 不適用
25 不適用
26 已套用（paneItems/tabItems/groupItems/spaceItems、onKey/row、loadSaved/applySaved/checkCatalog、buildProviderLaunch 等）
27 已套用（見 03）
28 不適用（對外名稱不可改；僅新增內部函式）
29 已套用（orca-menu:rowColor/accent；new-menu:worktreeFacts 的 known）
30 不適用（YAGNI，不加類別）
31 不適用（無需內聯）
32 不適用
33 已套用（見 07、14；orca-menu 的 env {p,cx,command}）
34 不適用（launch 的 unofficial 旗標參數：改成 launchTarget 判斷，但對外行為與簽名須保留，故保留參數）
35 不適用
36 不適用（函式留在原檔）
37 已套用（agent-config:buildLaunch 分 readEditors/expandItems/provider；confirmCloseTab 與 closeTab）
38 不適用（YAGNI）
39 已套用（orca-menu:ICON/BREAK 查表內聯單用變數）
40 不適用
41 不適用
42 已套用（orca-menu:splitThenSwap(direction, swap)、closeSide(side)、writeToTerminal(args)；split-menu:splitRow 資料驅動）
43 不適用
44 不適用
45 不適用
46 已套用（orca-menu:closeSide/splitThenSwap/terminalDialog 工廠函式）
47 不適用
48 不適用
49 不適用
50 不適用
51 已套用（orca-menu:paneTitleRows/paneIdentityRows/paneCloseRows/openTerminalInSpace 守衛；launchTarget；providerGlyph）
52 已套用（orca-menu:isDestructive、paneBreak 等具名條件）
53 已套用（orca-menu:BREAK_BY_MENU 以 includes 整合多個 || 條件）
54 不適用（無多型需求）
55 不適用
56 不適用
57 不適用
58 不適用（無控制旗標需移除；orca-menu 迴圈已改 flatMap）
59 已套用（orca-menu:unpinnedTabs/deleteAllTabs 的 filter/flatMap/map）
60 已套用（orca-menu:ICON_BY_COMMAND、BREAK_BY_MENU、ORCA_ACTIONS/HOST_ACTIONS；split-menu:CURSOR_KEYS；new-menu:agentAction）
61 不適用（沒有真實的第二種變體，查找表已足夠）
62 已套用（new-menu:launch 對已移除 agent 提前 return 守衛，維持原行為）
63 已套用（所有巢狀三元改為 if/查表，只留單層三元）
64 不適用
65 不適用（原本已使用 ?.）
66 不適用（原本已使用 ??）
67 不適用
68 不適用（YAGNI，無狀態模式）
69 不適用
70 已套用（orca-menu:toggleUnread 用 `if (!set.delete(id)) set.add(id)` 取代 `cond ? a() : b()` 運算式陳述式）
71 已套用（orca-menu:toggleUnread/copyContext/selectAll；new-menu:rememberModels；agent-config:persist、rememberProviderModel、rememberVariant 的空 catch 都加了說明註解）
72 不適用
73 不適用
74 已套用（orca-menu:ICON_BY_COMMAND/ICON_BY_SUFFIX 即決策表）
75 不適用（原則已定：不採用 Yoda）
76 已套用（新增四個 golden 規格化測試）
77 已套用（每步跑該 mod 測試，最後跑完整測試）
78 已套用（golden 在重構前錄製，重構後逐項比對）
79 已套用（orca-menu 每個動作一個函式；agent-config 載入/選擇/啟動拆分）
80 已套用（見 02）
81 已套用（以資料表取代重複程式碼，不加抽象層）
82 已套用（不加類別階層與設計模式）
83 已套用（orca-menu:items 與 choose 與 render 分離；agent-config:載入與 UI 分離）
84 已套用（順手把空 catch 補註解、刪除未用 import）
85 已套用（見 76；加入 selectBox/providerGlyph 等經 golden 覆蓋的行為）
86 已套用（eslint -c eslint.config.mjs 四個 mod 件數皆為 0）
87 不適用（不重排整檔：只改因重構動到的區段；orca-menu 的 diff 大是因 items/choose 整段重組）
88 已套用（所有函式 complexity ≤ 12，eslint 0）
89 已套用（以守衛子句與查表降低認知複雜度）
90 已套用（覆蓋率前後見 a）
91 不適用（本 repo 為 JS，無型別註解）
92 不適用
93 不適用（以參數傳入 env {p,cx,command}，未引入容器）
94 已套用（orca-menu:paneItems 等 rows 函式、menuIcon、section 為由輸入計算的純函式；new-menu:resolveFreebuff/launchTarget/flyoutX）
95 不適用
96 不適用
97 已套用（見 03）
98 不適用
99 已套用（golden master：以未重構程式碼錄製的輸出為準）
100 不適用（YAGNI，與 #82 取捨：不加擴充層）

## c) 保留項目與理由
- 無 eslint 規則件數保留。
- GPU／畫格相關（panelFrame/sidebarFrame/drawer 結構）：這四個 mod 沒有；render 的 builder 鏈（orca-menu row、split-menu row、new-menu row/render、agent-config 各 render 區塊）原樣搬移、鏈式呼叫順序與參數不變（golden 以 render 樹摘要驗證）。
- agent-config 共用副本（agent-flyout.js、codex-provider.js、list-viewport.js）、orca-new-menu/agent-flyout.js、orca-menu/clip.js、transcript.js：依規定未動。
- models.js、rows.js、freebuff.js、close-sides.js、close-space.js：eslint 本來就 0 件，未動。
- orca-new-menu 與 agent-config 的 View 類別大小：未拆類別（#82）。

## d) Herdr API 候選（行為變更，未做）
- mods/agent-config/main.js scrollList/viewportHeight（list-viewport 手刻捲動區與高度計算）：若 Herdr 提供原生可捲動清單元件則可替換。
- mods/orca-new-menu/main.js flyoutAt/trackRow/flyoutX：手算翻轉與夾限位置；若 openOverlay 支援以錨點元素定位並自動翻轉則可替換。
- mods/orca-menu/main.js unpinnedTabs 的 localStorage `spaces.unread.v1` + setShared 雙寫：若 Herdr 提供持久的 shared/store API 可只用一處。
- mods/orca-split-menu/main.js onKey/matchesShortcut：手刻快捷鍵比對；若 View 有宣告式快捷鍵綁定 API 可替換。
- mods/orca-menu/main.js keyHint/shortcut：手刻和弦格式化（⇧⌘D）；若 keys() 能回傳顯示用字串可替換。

## e) 發現但沒處理的 bug（行為保持，未修）
- mods/orca-split-menu/main.js（splitRow：split-left／split-up 的 pane.swap 沒帶 pane 參數，會對目前焦點窗格交換；orca-menu 的 split-left/up 同樣），原檔約 25–50 與 90–105 行。
- mods/orca-split-menu/main.js destructiveColor() 用 theme().appearance，orca-menu 用 window.appearance()，兩處判斷明暗的來源不同，可能顏色不一致。
- 未能實測的風險：orca-menu 動作表在 `args` 缺少時的 TypeError 行為與原版一致（沿用 `it[2].x` 不加 ?.），不是新問題。
