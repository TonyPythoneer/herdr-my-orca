# tabs-pane 重構報告（orca-tabs、orca-pane、orca-float、orca-landing）

branch refactor/tabs-pane，未 commit（工作樹有 WIP commit 之後的未提交修改）。完整測試 550 項全過，沒有任何 *.snap.json 變更。

## 一、重要說明
1. 新測試檔命名為 `*-test.js`（或 `*.flow-test.js`），不是 `*.test.js`。原因：scripts/orca-ui-manifests.test.js 把每個 in-place mod 磁碟上的 `*.test.js` 與 orca-ui/app.mjs 的 `tests` 清單逐一比對；新增 `*.test.js` 會讓完整測試失敗，而 orca-ui/ 不准我改。與 changes-wt-handoff 批次同一做法。app.mjs 的擁有者之後可以決定是否把這些檔登錄並改名。
2. 前一位工人留下的 pane 測試有誤（crew 成員缺 `state: "live"`），已修正；orca-tabs 的 interactions.flow-test.js 原本只有輔助函式、沒有任何測試，已補齊。
3. 這四個 mod 本來都沒有 render.snap.json，所以「渲染逐位元組相同」沒有現成守門。我新增了「黃金渲染測試」golden-test.js（四個 mod 各一）：用 stock 替身記錄整棵渲染樹加上 render／init 期間發出的 run、setShared、openOverlay、closeOverlay、計時器、spawn、localStorage 寫入，取 sha256 寫死在測試內（不是新的 .snap.json）。重構前後雜湊相同：
   - orca-tabs 73 個情境（含 18 種 close 對話框、5 種 drop 覆蓋層、macOS／Linux／Windows、全螢幕、unified、側欄／面板顯示隱藏、溢出與 docked、各狀態、各 agent 圖示）：dfc89cb8…
   - orca-pane 20 個情境：44d42c94…；orca-float 9 個：c7274ccc…；orca-landing 4 個：ea9782c3…
   設 `GOLDEN_DUMP=<dir>` 可把完整文字寫出來比對。
4. 這些新測試都先在「重構前」的程式碼上跑過全過，備份在 scratchpad/refactor/reports/tabs-pane-baseline-tests/。（之後又有補充的測試，見下。）

## 二、a) eslint 與覆蓋率（前 → 後）
eslint 以 `--ignore-pattern '**/*-test.js'` 量測，前後可比。

| mod | no-shadow | no-nested-ternary | complexity | max-lines-per-function | no-unused-vars | 合計 |
|---|---|---|---|---|---|---|
| orca-tabs | 48 → 0 | 11 → 0 | 15 → 0 | 4 → 0 | 0 → 0 | 78 → 0 |
| orca-pane | 11 → 0 | 0 → 0 | 3 → 0 | 1 → 0 | 1 → 0 | 16 → 0 |
| orca-float | 2 → 0 | | | | | 2 → 0 |
| orca-landing | 1 → 0 | | | | | 1 → 0 |

覆蓋率（行／函式，只計 mod 內的檔、排除測試檔）：
- orca-tabs：原有測試 main.js 17.12%／29.17%（全部檔 34.16%／57.65%）→ 加新測試後 全部檔 100.00%／97.17%（main.js 100／95.65）。
- orca-pane：原有測試只載入 crew.js（main.js、status.js 為 0）→ 100.00%／97.89%。
- orca-float：原本無測試 → 100%／100%。orca-landing：原本無測試 → 100%／100%（分支 95.24%）。

新增測試檔：
- orca-tabs：golden-test.js、interactions.flow-test.js（37 項）
- orca-pane：golden-test.js、interactions.flow-test.js（12 項，含前人留下的 4 項並修正 1 項）
- orca-float：golden-test.js、workspace.flow-test.js（前人）、panel.flow-test.js
- orca-landing：golden-test.js、shortcuts-test.js（前人）、buttons.flow-test.js

主要結構變化：
- orca-tabs/main.js 由 1536 行拆出 close-dialog.js、header-controls.js、header-layout.js、tab-item.js（新增的一般檔案，非 symlink，只 import 本資料夾）。
- orca-tabs/main.js：側欄平滑動畫拆成 `sidebarPlan`／`runSidebarMotion`／`stepSidebar`／`showSidebarFromHidden`；render 拆成 `stripFrame`／`syncChrome`／`currentWindow`；`pollDrop` 拆出 `sampleDrop`；`storedPanels`、`takeToggle`、`rememberPanelWidth`、`derivedTabName` 等。
- orca-tabs/drawer.js：`toggle` 拆出 `nextGoal`、`prepare`；魔術數字（1、80、50 毫秒）命名；`await`、`sleep`、token 檢查的順序與次數不變。
- orca-tabs/tab-strip-scroll.js：`dockSide` 取代巢狀三元。
- orca-pane/main.js：render 由 181 行拆成 `titleCluster`／`dragHandle`／`actionCluster`／`closeButton`／`gripDots`；拖曳輪詢拆成 `pollPaneDrag`／`stopPollTimer`；重複 4 次的開選單抽成 `openPaneMenu`／`paneMenu`；`status.js` 的 `agentMark` 拆出 `catalogMark`。
- orca-float/main.js：空狀態兩列抽成 `emptyRow`。
- 重構時仍保留 scripts/titlebar-height.test.js 依賴的原始碼樣式：`trafficLightPadding` 的運算式必須留在 orca-tabs/main.js（該測試用正規表達式讀 main.js），所以我把它從 header-layout.js 移回 main.js，並加註解。

## 三、b) 帳本（principles.md 編號 1–100）
01 已套用（orca-tabs/main.js:stripFrame、runSidebarMotion；orca-pane/main.js:render）｜02 已套用（orca-pane:openPaneMenu／closeButton；orca-float:emptyRow；orca-tabs:takeToggle）｜03 已套用（cx 內層改名 taskCx／tickCx／clickCx 等；landing combo 參數 caps）｜04 不適用（無 max-depth 件數）｜05 已套用（drawer.js、pane/main.js、float/main.js、orca-tabs/main.js 的計時與門檻常數；純版面像素未命名）｜06 不適用（Tabs 類別仍大但已拆出模組；不為湊項目再切類別）｜07 不適用（無 max-params 件數）｜08 已套用（orca-pane 未用的 `shared` import、orca-tabs 未用的 `svg` import、header-layout 的未用 import）｜09 不適用（無需變更分散處理）｜10 不適用｜11 已套用（render 拆階段，減少交錯的副作用順序）｜12 保留（orca-tabs 模組層 `dropDrag`／`pollTimer`：overlay 副本為獨立 realm，註解已說明）｜13 不適用｜14 不適用｜15 不適用｜16 不適用（沒有 switch；用查找表／守衛）｜17 不適用｜18 不適用｜19 不適用｜20 不適用｜21 不適用｜22 不適用｜23 不適用｜24 不適用｜25 不適用
26 已套用（全部 mod 大量函式提取，見上）｜27 已套用（內層 cx 與其他 no-shadow 的重新命名，共 78 處）｜28 不適用（對外簽章不可變）｜29 已套用（orca-tabs/main.js:runSidebarMotion 的 `motion` 物件、stripFrame 的 frame）｜30 不適用（YAGNI）｜31 不適用｜32 不適用｜33 已套用（orca-float:emptyRow 參數物件；orca-tabs:prepare／runSidebarMotion 參數物件）｜34 不適用（無旗標參數需刪）｜35 不適用｜36 已套用（trafficLightPadding 等；header-layout.js 的輔助函式）｜37 已套用（orca-tabs/main.js:render → stripFrame → syncChrome；drawer.js:prepare 階段）｜38 不適用｜39 不適用｜40 不適用｜41 不適用｜42 不適用｜43 不適用｜44 不適用｜45 不適用｜46 不適用｜47 不適用｜48 不適用｜49 不適用｜50 不適用
51 已套用（drawer.js:nextGoal、sidebarPlan、tab-strip-scroll.js:dockSide、tab-item.js:showsDivider）｜52 已套用（showsDivider、releasedBelowStrip、lightsOverlap）｜53 不適用｜54 不適用（無真實多型變體）｜55 不適用｜56 不適用｜57 不適用｜58 不適用｜59 不適用｜60 已套用（orca-tabs:dropHalf 等既有的查找；pane 的 GROUP_WORD）｜61 不適用（YAGNI）｜62 不適用｜63 已套用（巢狀三元全改為單層；orca-tabs 11 處改為守衛子句／函式）｜64 不適用｜65 不適用｜66 不適用｜67 不適用｜68 不適用｜69 不適用｜70 不適用｜71 已套用（orca-pane:cancelQuietly；orca-tabs:cancelTimer 與 storedPanels 的空 catch 加註解寫明原因）｜72 不適用｜73 不適用｜74 不適用｜75 不適用（不採 Yoda）
76 已套用（四個 mod 的 golden／flow 測試；先在重構前跑過）｜77 已套用（每一步後跑測試）｜78 已套用（golden-test.js 為回歸測試）｜79 已套用（close-dialog／header-controls／tab-item／header-layout 各一職責）｜80 已套用（同 02）｜81 已套用（不加設計模式）｜82 已套用（不加策略／狀態模式）｜83 已套用（對話框、標頭控制、分頁項目分檔）｜84 已套用（順手清掉未用 import）｜85 已套用（flow 測試是單元層級的）｜86 已套用（eslint 全部歸零）｜87 已套用（不整檔重排，只改動到的區段）｜88 已套用（complexity 全部 ≤ 12）｜89 已套用（守衛子句降低巢狀）｜90 已套用（覆蓋率見上）｜91 不適用（無型別系統）｜92 不適用｜93 已套用（drawer.js 的 env 注入為既有設計；`pointerAt` 帶 fallback）｜94 已套用（sidebarPlan、sidebarMotionMs、dropHalf、derivedTabName 為純函式）｜95 不適用｜96 不適用｜97 已套用（命名常數與函式名，見上）｜98 已套用（守衛子句於入口，如 takeToggle、showSidebarFromHidden）｜99 已套用（golden-test.js 即黃金大師測試）｜100 不適用（YAGNI）

## 四、c) 保留項目與理由
- orca-tabs/main.js 的 render 仍為多階段副作用（syncChrome、updateGlide、recoverMainWidth 的 spawn）：只做函式提取，順序不變，因為 golden 測試記錄了命令順序。
- drawer.js 與 sidebar 動畫：沒有新增、移除或重排任何 `await`／`sleep`／token 檢查；`prepare` 與 `showSidebarFromHidden` 是 async 子函式（多一層微任務，實際主機計時器為巨集任務，既有與新增的 drawer／flow 測試皆通過）。
- 模組層 `dropDrag`／`pollTimer`（編號 12）：overlay 與條帶是不同 realm 的 mod 副本，必須如此。
- orca-tabs/main.js 的 `pending`（syncPanel）：正式程式碼從未指派，等於死碼；但前一位工人已為它寫了測試，故保留不刪。
- 各 mod 重複的 agent 圖示表（orca-pane、orca-float、orca-tabs）：一個 mod 只能 import 自己資料夾，所以不合併。
- GPU／畫格成本相關的結構（sidebar 的 glide、native clock 元素的 id 與 transition）：未動，golden 證實渲染一致。
- 共用副本（clip.js 等）：本批無需處理，也未修改。

## 五、d) Herdr API 候選清單（不在這次重構內）
- orca-tabs/main.js 的 `dropTrace`（寫 /tmp 檔作追蹤，標 TEMPORARY，DROP_REV=13）：可改用 Herdr 的日誌 API（若有），並在除錯結束後移除。
- orca-tabs/header-controls.js 的視窗按鈕（minimize／maximize／close）：Herdr 若提供原生視窗控制可取代手刻。
- orca-pane/main.js 的 `pointerAt`／拖曳靜止推定放開：若 Herdr 日後提供全域 mouse-up 事件，可取代 16 毫秒輪詢。
- orca-tabs 的 `localStorage('panels')`：Herdr 若有持久化 store API 可取代。

## 六、e) 發現但沒處理的 bug（行為保持不變）
- mods/orca-tabs/header-controls.js:60：箭頭按鈕的 on_click 用的是 render 時的 `renderCx`，點擊當下該 context 已失效（同檔其他 handler 用事件自己的 cx）；`scrollTabStrip` 會用它呼叫 `cx.notify()`。
- mods/orca-tabs/main.js 的 syncPanel：還原記住的面板（select／show）後，同一個 frame 仍把「還原前」的狀態當成目前狀態記下（`panels[space.id]` 先被寫成 null 或舊工具），下一個 frame 才寫回正確值，會多一次 localStorage 寫入。
- mods/orca-pane/main.js endPaneDrag：若拖曳未超過 8px 且放開位置在分頁列範圍內（y <= 48×zoom），`finishPaneDrag` 會送出 unsplit-to-tab 並同時開啟選單。目前只有直接呼叫會觸發（UI 的 on_mouse_up 只在已拖曳時才呼叫它）。
- mods/orca-tabs/main.js 的 `pending`：從未被賦值，相關分支是死碼。
- 共用副本無問題可報。
