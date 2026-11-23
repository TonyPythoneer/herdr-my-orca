# 側邊欄收合動畫的順暢度

*   **Author:** Tony Yang
*   **Status:** Draft（交給 Codex 審閱）
*   **Date:** 2026-11-23

--------------------------------------------------------------------------------

## Overview

Herdr App 的 `orca-unified` 版面把側邊欄的標頭併進一條橫跨左側的 header，由
`orca-tabs` 繪製。按下切換鈕時，`orca-tabs` 以一個計時迴圈逐格呼叫
`layout.resize`，沿著 cubic-bezier(.32,.72,0,1) 把側邊欄寬度從 259px 縮到 0
（或反向），完整一趟約 500ms。迴圈每次要求睡 16ms，但實測兩步之間是 18 到 30ms，
不是 60fps。

作者覺得這段滑動不順（「卡」），也問過為什麼無法像 HTML 原型那樣順。這份文件說明
為什麼，並提出一個把每格工作量降到接近零的做法（選項 B′），同時保留現有做法
（選項 A）作為可切換的對照，並列出要請審閱者驗證的風險。

作者把技術收斂交給 AI 與 advisor，因此本文件已經做出建議的方向（B′ 為主、A 保留、
C 為未來工作）。哪一個「摸起來比較順」要由作者在 app 內用兩個模式實際比較後決定。

## The Problem

按下切換鈕後，使用者看到的是不連續的動作。已知的事實：

*   **mod 無法讓終端機平順移動。** mod 只能對自己畫的元素使用原生
    `transition`/`spring`，而且只有 `opacity`、`left`、`top`、`width`、`height` 五種屬性。
    側邊欄與終端機是 layout 節點，只能靠 `layout.resize` 逐格改變寬度，沒有位移或
    疊層選項。
*   **逐格縮放沒有與繪製同步的計時。** 沒有「下一個畫面」的回呼，只能用
    `cx.sleep`。第一次探測要求 `sleep(16)`，實測步進平均 29ms（18 到 328ms）。
*   **抽屜曲線前段走得很快。** 約 70% 的距離在前四分之一的時間內走完。在約 20 到
    25ms 的步進下，前兩步各移動約 50 到 60px，這本身就會看起來一格一格地跳，
    與 GPU 是否是瓶頸無關。
*   **`layout.resize` 慢一格。** 呼叫立刻返回，`layout()` 回報的寬度晚一格才更新。
*   **每一格都要重畫終端機。** 實測（輪詢 `stty size`）PTY 只在動畫結束時改變一次
    尺寸，沒有每格重排；但終端機文字每格都在新位置重畫。
*   **側邊欄內容每格重建。** `orca-spaces` 每次寬度改變都重建整棵專案樹，
    `orca-tabs` 每格重算分頁幾何。這筆成本沒有量過。
*   **作者的「GPU 瓶頸」假設沒有量測支持。** 螢幕錄影幀率不固定（16 到 30fps），
    Herdr 視窗常被遮擋，量不到真實繪製幀率。上述步進與曲線的問題成立與否，
    都不依賴這個假設。

### 為什麼 HTML 原型比真正的 app 順

| | HTML 原型 | 目前的 app |
|---|---|---|
| 誰驅動每一格 | 同一程序內的 `requestAnimationFrame`，與螢幕更新同步 | `cx.sleep` 計時器，不與繪製同步 |
| 改變的東西 | 幾個 div 的 `left`/`width`/`opacity` | 一個 layout 節點的寬度，由 host 重排 |
| 每格要做的事 | 一次繪製 | JS → host 指令 → 重算 layout → 多個 mod 重新渲染 → 終端機文字重畫 |
| 內容 | 幾行文字 | 真的終端機格線、整棵專案樹 |
| 生效時機 | 同一格 | `layout()` 回報慢一格 |

瀏覽器對很重的面板做 `width` 動畫也會卡；順暢的網頁動畫通常改 `transform` 或
`opacity`，由合成器處理、不重新排版。

## Goals

*   讓側邊欄收合與展開看起來連續，而且不需要每格由 JS 呼叫 host。
*   動畫可以中途反向，且不會停在錯誤的狀態。
*   在 app 內可以用同一個開關切換「現有逐格做法」與「新做法」，由作者用眼睛比較。
*   用三個數字（步進間隔、每格 JS 渲染時間、畫面時間）取代「GPU 瓶頸」這個推測，
    並給出決定預設做法的規則。
*   舊的 `orca` 版面外觀與行為完全不變。

## Non-Goals

*   不覆蓋終端機內容：不採用浮在終端機上方的抽屜。
*   不改變切換鈕的位置（x=75、右邊距 4）。
*   不修改左側欄動畫以外的任何 UI（作者的範圍決定，2026-11-23）。分頁條與側邊欄內容
    隨側邊欄移動，屬於這個動畫的一部分。
*   不改 `keys.json`（`cmd-b`、`ctrl-shift-b` 仍是瞬間切換）。
*   不在本文件階段執行量測；量測放在實作計畫的第一階段。
*   不修改 herdr-app 本身（host）；列為未來工作。

## Open Questions

*   **Question 1**：原生 `transition("width")` 在動畫途中被改變目標時，是否真的從
    當下的值接續？（前一個版本用新元素 id 做過 `left` 的轉場，已證明可行；中途改目標
    尚未驗證。）
*   **Question 2**：三個側邊欄區塊（nav、spaces、頁尾）各自畫一個蓋層，是否會在不同
    的一格開始？區塊之間的分隔線沒有被蓋到，視覺上是否可接受？
*   **Question 3**：蓋層是單一的 `t.background`，但卡片頂端有 `orca-pane` 的 32px
    標頭帶，顏色是否一致？
*   **Question 4**：原生緩動只有 ease-out 或 `spring`（阻尼 1），沒有抽屜曲線。
    差別在主觀上是否可接受？

## Critical User Journeys (CUJs)

### CUJ 1: 收合再展開

*   **Given**: 在 `orca-unified` 版面，側邊欄展開、寬度為開啟寬度。
*   **When**: 按切換鈕（或 `orca-tabs.toggle-sidebar` 指令）收合，等動畫結束，再按一次。
*   **Then**: 動畫期間畫面連續；結束後側邊欄隱藏／展開，寬度回到原本的開啟寬度；
    `herdr-app status` 沒有錯誤。

### CUJ 2: 動畫途中反向

*   **Given**: 收合動畫進行到一半，或收合剛結束、隱藏指令剛送出。
*   **When**: 再按一次切換鈕。
*   **Then**: 動畫從當下的狀態往另一個方向走，最終狀態為「展開」，不會停在隱藏，也不會
    閃出一格全寬的側邊欄。

## Technical Plan (Architecture)

### 目前的實作（選項 A，`motion: "layout"`）

```text
切換鈕 click / `orca-tabs.toggle-sidebar` 指令
   │  設定旗標 wantToggle，通知重繪
   ▼
Tabs.render() 消費旗標 ──▶ Tabs.toggleSidebar(cx)
                            │  cx.spawn：時間驅動迴圈（要求每 16ms，實測 18-30ms）
                            │  k = (now - t0) / dur，寬度 = open × drawerEase(k)
                            ▼
                  run("layout.resize", {id:"sidebar", px})   ← 取整後寬度改變才送
                            ▼
          host 重算 layout ──▶ 側邊欄、卡片（終端機）、header 區塊尺寸改變
                            ▼
   layout() 回報新寬度（慢一格）──▶ 各 mod 重新渲染：
     • orca-tabs：分頁條起點 = max(側邊欄寬度, 111) 的空白佔位
     • orca-nav / orca-spaces / orca-chrome 頁尾：sidebarFrame() 固定寬度內框，
       同色蓋層淡出、`left` 位移
結尾：收合 → layout.hide，再在隱藏狀態 resize 回開啟寬度；展開 → 先在隱藏狀態
resize 到 1px，再 layout.show，之後逐格往上。
```

*   曲線與時間：cubic-bezier(.32,.72,0,1)；完整時長 `(320 + 120d)(0.5 + 0.5d) + 60` ms，
    d 為剩餘距離比例（完整為 500ms）。
*   中途反向：token 機制；每次迴圈與開頭即時讀取節點是否已隱藏，必要時補送 `show`。

### 建議的方向：選項 B′（`motion: "cover"`）— layout 只改一次，邊緣是 mod 畫的蓋層

**機制。** 終端機只在動畫的一端重排一次；看得到的「移動的邊緣」是 mod 自己畫的蓋層，
用原生 `transition("width")` 由 gpui 在原生程式碼內插值，JS 不需要每格介入。

*   **共用狀態**：`shared("sidebar.anim")` = `{ gen, target: 0|1, dur }`。每次切換
    `gen` 加一。各 mod 的蓋層與分頁條位移元素的 id 都帶 `-g<gen>`，讓每次動畫從新
    元素開始（前一版已證明：轉場只對「元素已帶著它之後」的變化生效）。
*   **展開**：
    1.  `orca-tabs` 呼叫一次 `layout.show`（寬度為記憶的開啟寬度）。終端機立刻跳到
        最終位置並重排一次（與選項 A 結尾的那一次重排同等）。
    2.  設定 `sidebar.anim = {gen+1, target: 1, dur}`，約 40ms 後再通知一次重繪。
    3.  `orca-nav`、`orca-spaces`、`orca-chrome` 頁尾各畫一個卡片色、靠右對齊的蓋層：
        第一次渲染寬度為整個區塊寬，第二次渲染寬度為 0，帶 `transition("width", …)`，
        於是蓋層向右縮回，露出下面靜止的側邊欄內容。
    4.  `orca-tabs` 把分頁條、箭頭、`+` 以 `left` 位移元素從「舊位置」滑到 0（與前一版
        的做法相同）。
*   **收合**：反向。蓋層從寬 0 長到整個區塊寬，分頁條位移元素從 0 滑到「舊的起點 −
    新的起點」。用一個計時器等 `dur` 後呼叫一次 `layout.hide`（再在隱藏狀態
    resize 回開啟寬度）；隱藏節點不繪製內容，所以蓋層隨之消失，分頁條位移元素同一格
    重設為 0，位置相同、不會跳。
*   **中途反向**：翻轉 `target`，`gen` 不變或加一皆可（見 Open Question 1），取消尚未
    觸發的 `layout.hide` 計時器（token），改為排下一個。
*   **每格成本**：沒有 JS 迴圈、沒有每格的 host 指令、沒有每格的終端機重畫。

**取捨。**

*   終端機文字在展開開頭或收合結尾跳一次；卡片邊緣本身看起來是移動的，因為蓋層邊緣
    在移動。
*   原生緩動只有 ease-out 與 `spring`，沒有抽屜曲線。
*   這與 `docs/plan-unified-header.md` 的「JS 迴圈只決定目標寬度，所有繪製從 layout
    回報的寬度推算」這個決定相反。該決定是在量到步進間隔（18 到 30ms）與注意到
    抽屜曲線前段過快之前做的。

**在什麼情況下失敗。**

*   三個蓋層不同步、分隔線沒被蓋到、顏色與卡片頂端的 32px 標頭帶不一致。
*   原生 `transition` 在中途改目標時不從當下的值接續。
*   終端機跳一格被作者判定為不可接受。

### 保留的對照：選項 A（逐格 `layout.resize`）

見上方「目前的實作」。保留在 `motion: "layout"` 之後，讓作者能在同一個 app 內
並排比較。若量測顯示成本在 mod（例如 `orca-spaces` 每格重建），可先在動畫期間凍結
該區塊內容再量一次。

### 未來工作：選項 C（在 host 加原生版面動畫）

讓 `layout.resize`/`hide`/`show` 接受時長與曲線，或讓節點有位移屬性，由 gpui 在原生
程式碼內以顯示器更新率插值。這是唯一能讓終端機本身以原生幀率移動的做法。herdr-app
的原始碼不在這個 repo，且「Shipped layouts/mods are replaced at start」意味著修改可能
在升級時被覆蓋，因此不納入本次範圍。

### 預設做法的決定規則（由量測決定，不由推測決定）

在選項 A 的迴圈中記錄三個數字：步進間隔的中位數與 p90；`orca-tabs`、`orca-spaces`、
`orca-nav` 的 `render` 每格耗時；畫面時間（`show_fps_monitor()` 疊加層，用
`herdr-app shot` 連續截圖讀取，視窗被遮擋時也可用，不需要滑鼠點擊）。

*   p90 步進間隔大於 20ms，或畫面時間大於 16.7ms 而 JS 渲染時間不超過 6ms：A 已到
    上限，預設改為 B′。
*   JS 渲染時間佔大宗：先在動畫期間凍結 `orca-spaces` 內容，再量一次，再決定。
*   無論量測結果，最終「哪一個比較順」由作者在 app 內切換 `motion` 比較後決定。

## Alternatives Considered

### Alternative A: 現有逐格 `layout.resize`（保留為 `motion: "layout"`）

*   **Pros**: 邊緣與終端機同一格內一起連續移動；已上線；有抽屜曲線。
*   **Cons**: 每格都走 JS → host → 重排 → 多 mod 重新渲染；沒有幀同步；前段步長過大。
*   **Reason for Rejection**: 未排除，保留作為對照。

### Alternative B: 浮在終端機上方的抽屜

*   **Reason for Rejection**: Rejected by author: 會覆蓋終端機內容。

### Alternative C: 只讓 header 滑動、版面瞬間跳

*   **Reason for Rejection**: Rejected by author: header 與版面不同步，看起來不順。

### Alternative D: 不用新元素 id，直接對現有元素改 `left`

*   **Reason for Rejection**: 已量測，轉場只對元素已帶著它之後的變化生效，這樣不會有動畫。

### Alternative E: 整組 `opacity` 淡出側邊欄內容

*   **Reason for Rejection**: GPU 每格要離屏繪製整棵子樹；已改為同色蓋層。

### Alternative F: 讓終端機區塊用原生 `transition("left")` 自己移動

*   **Reason for Rejection**: 不可行：終端機是 layout 節點，mod 無法對它加轉場。

### Alternative G: 動畫期間凍結終端機尺寸

*   **Reason for Rejection**: 沒有收益：實測 PTY 本來就只在結尾重排一次。

### Alternative H: 在 host 加原生版面動畫

*   **Reason for Rejection**: 本次不採用：host 原始碼不在 repo。列為未來工作，不是被否決。

## Non-Functional Requirements

*   **Performance**：動畫期間每格 JS 成本應接近零（B′），或以量測數字說明（A）。
*   **Rollout & Rollback**：以 `motion: "layout" | "cover"` 開關控制，預設值依上方規則
    決定；舊 `orca` 版面不受影響（兩個模式都只在 `props().unified` 的區塊內生效）。
    退回方式：切回 `motion: "layout"`，或 `herdr-app do layout.switch --name orca`。

### Future Improvements

*   **選項 C**：host 原生版面動畫。
*   **選項 A 的退路**：若量測顯示終端機重畫是主要成本，B′ 是目前唯一可降低它的做法。

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `mods/orca-tabs/main.js` (Modify)

*   **Type / Scope**: JavaScript 模組（gpui-kit View）。
*   **Proposed Changes**:
    *   `toggleSidebar`：依 `motion` 分支。`"layout"` 保持現狀並加入三個量測值的記錄
        （步進間隔、各 mod 渲染時間、輸出到 scratchpad 路徑的 JSON，僅在量測開關開啟時）。
        `"cover"`：呼叫一次 `layout.show`/`hide`，設定 `sidebar.anim`，用單一計時器排
        `hide`，並以 token 取消。
    *   分頁條、箭頭、`+` 的位移元素：id 帶 `-g<gen>`，`left` 從舊位置轉到 0（展開）或從 0 轉到
        新位置（收合）。
    *   讀取 `props().motion`（預設值依決定規則）。

#### 2. `mods/orca-nav/main.js`, `mods/orca-spaces/main.js`, `mods/orca-chrome/main.js` (Modify)

*   **Type / Scope**: JavaScript 模組。
*   **Proposed Changes**: `sidebarFrame()` 在 `motion: "cover"` 時改畫靠右的卡片色蓋層，
    寬度帶 `transition("width")`，id 帶 `-g<gen>`；在 `"layout"` 時維持現有的同色蓋層。
    `orca-chrome` 的 live 檔案含另一個 worktree 的未合併改動，必須就地修補，不能整份複製。

#### 3. `layouts/orca-unified.json` (Modify)

*   **Type / Scope**: 版面設定。
*   **Proposed Changes**: 在側邊欄三個區塊的 `props` 與 header 區塊加入 `motion`。

#### 4. `docs/plan-unified-header.md` (Modify)

*   **Type / Scope**: 文件。
*   **Proposed Changes**: 記錄「JS 迴圈只決定寬度」被 B′ 取代，並寫入量測結果與最終預設。

### Phase 0：量測（放在實作的第一步，不在本文件階段執行）

三個數字與決定規則見上方。實作前先在選項 A 的迴圈上取得數字，再決定 `motion` 的預設值。

### Verification Plan

*   **Build/Check**: 每個變更的 mod 執行 `herdr-app check <mod 路徑>`；`herdr-app status`
    的 `errors` 為空。
*   **Unit Tests**: `node --test mods/*/*.test.js`（目前 246 個全過）。
*   **中途反向**: 用 `herdr-app do orca-tabs.toggle-sidebar` 計時掃描：收合後 0.15 到
    1.2 秒、展開後 0.02 到 0.45 秒內反向，並涵蓋收合結尾（`hide` 剛送出的 0.5 到 0.7 秒）
    與展開開頭，最終狀態都必須符合預期。
*   **視覺**: `herdr-app shot` 連續截圖，確認蓋層、分頁條位移與側邊欄內容同步；不使用
    螢幕錄影（幀率不固定）。
*   **舊版面**: 切換到 `orca` 版面，確認外觀與行為不變。
*   **主觀**: 作者在 app 內切換 `motion`，比較兩個模式。

--------------------------------------------------------------------------------

## 給審閱者（Codex）的風險清單

1.  三個側邊欄區塊的蓋層是否在同一格開始？可能差一格。
2.  區塊之間的分隔線沒有被蓋到。
3.  蓋層是單一的 `t.background`，卡片頂端有 `orca-pane` 的 32px 標頭帶，顏色可能不一致。
4.  原生 `transition` 在動畫途中改目標的接續行為尚未驗證。
5.  選項 B′ 與前一份計畫的決定相反；請確認理由（步進間隔實測 18 到 30ms、曲線前段
    步長過大）是否站得住腳。
6.  `docs/plan-unified-header.md` 與本文件的關係：本文件取代其中「JS 迴圈只決定寬度」
    這一條。

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
