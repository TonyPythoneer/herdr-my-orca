# 右側欄滑動，中間畫面縮放

*   **Author:** Tony Yang
*   **Status:** Draft（選項 B 已實作並同步到 live；`orca-panel-head` 待定，見 Decisions）
*   **Date:** 2026-11-23

--------------------------------------------------------------------------------

## Decisions（2026-11-23 由作者回答）

*   **D1 右側欄要跟左側欄一樣。** 內容不重排、只滑出去＋淡出 → 採用選項 B，已實作：
    `shared/panel-motion.js`（`panelFrame()`，左側 `sidebarFrame()` 的鏡像：內框固定開啟寬、
    靠 panel 右緣、位移 `-(1-k)*(open-28)`、同色平塗蓋層 `clamp(1-(k-.15)/.85)`），
    以及 `orca-files`、`orca-changes`、`orca-agents`、`orca-panel-gap`、`skillshare` 五個
    panel mod 的 `render()` 包一層。`orca-tabs` 發佈 `shared("panel.openPx")`，並在
    `measurePanel` 開啟時寫 `/tmp/panel-native-<t>.json`。
*   **D2 31px 圖示列（`orca-panel-head`）暫不包。** 作者的描述是「按下去後，icon 左邊出現
    一組關於這個右側欄子畫面的操作」——那是新的互動（每個子畫面的操作群組），不是這次滑動
    的一部分。待作者確認範圍後再決定它要不要一起滑（Q2 改寫如下）。
*   **D3 不做的**：離散跳段縮放（C）、卡片內縮錯覺。
*   **D4 鍵盤換成動畫版。** `cmd-b`、`ctrl-shift-b`、`cmd-l`、`ctrl-shift-e` 改綁
    `orca-tabs.toggle-sidebar` / `toggle-panel`。沒有 unified header 的版面（舊 `orca`、
    win98、terminals）由 `orca-tabs` 自己退回 `layout.toggle`，所以舊版面行為不變；沒有載入
    這個 mod 的版面，鍵等於沒有作用（這是已知取捨）。命令監聽不再只限 `props().unified`
    ——對話框與拖曳 overlay 的副本在 `init()` 就 return，不會重複切換。
*   **D5 動畫 API 收斂成一個。** 新增 `mods/orca-tabs/drawer.js`：一個 `Drawer` 類別擁有
    整台狀態機（preamble、中途反向的 token、寬度去重、釘住 `main`、收尾），差異用 spec
    表達（`id`、`defaultOpen`、`pin(open, wasHidden)`、`after(target)`、`measure`），環境用
    `env`（`run`/`find`/`layout`/`props`/`zoom`/`write`/`pin`/`release`）。左右兩份各約 60 行
    的重複實作已刪除，`motion: "layout" | "smooth"` 的計時器版本保留為對照組（同一組狀態）。

--------------------------------------------------------------------------------

## Overview

兩個問題要分開回答。

**右側欄能不能像左側欄一樣滑動？** 可以，而且已經在做了。`b440ff0 Animate unified right
sidebar` 把左側欄那套原生時鐘照抄給右側欄：`orca-tabs` 在 header 裡放一個隱形、寬度帶
`transition("width")` 的元素（`panel-native-clock`），gpui 在原生程式碼裡逐幀插值，
每一幀回拋 `on_size_change`，`panelNativeSize()` 再逐幀 `layout.resize {id:"panel"}`。
機制與左側欄的 `sidebar-native-clock` 是同一個，只是方向相反。差別在**內容**：左側欄的三個
mod 有 `sidebarFrame()`（固定寬內框、同色蓋層、位移），右側欄的 mod 沒有，所以右側欄動畫
期間它的內容是真的被壓縮。

**中間畫面能不能有縮放效果？** 不能，是真的不能。`gpui-kit` 的可動畫屬性只有
`opacity | width | height | left | top`（`gpui-kit.d.ts`, `MotionProperty`），元素沒有
`scale`、沒有 `transform`、沒有旋轉。中間的終端機是 layout 節點，mod 連樣式都碰不到；
唯一能改的是它的寬高，而改寬高 = 重排版面 = 文字換行，不是縮放。真正的等比例縮放要嘛是
host 給 transform，要嘛是 host 自己用原生版面動畫移動節點。兩者都不在這個 repo 的範圍內。

所以這份草稿的結論是：**滑動做得到（而且已經有），連續縮放做不到；可以做出三種「像縮放」
的近似效果，選哪一種要由作者看過再定。**

## The Problem

### 現況（讀程式碼得到的事實）

| | 左側欄 | 右側欄 |
|---|---|---|
| 誰驅動每一幀 | `sidebar-native-clock`（`orca-tabs` header 裡的隱形寬度元素） | `panel-native-clock`（同一個 header 裡的另一個隱形元素） |
| 每幀做什麼 | `sidebarNativeSize()` → `layout.resize {id:"sidebar"}` | `panelNativeSize()` → `layout.resize {id:"panel"}` |
| 曲線與時長 | `ease-in-out`, 500ms | `ease-in-out`, 500ms |
| 終端機重排 | 先把 `main` 釘在舊寬度，PTY 只在結尾 reflow 一次（已量測） | 同樣先釘 `main`，但**沒有量測過** panel 的 core size events |
| 內容在動畫期間 | `sidebarFrame()`：固定開啟寬的內框、同色蓋層淡出、往左位移 28px | 沒有 frame，內容每一幀被壓窄、換行、截斷 |
| 開關來源 | 標題列切換鈕、`orca-tabs.toggle-sidebar`、`cmd-b`/`ctrl-shift-b`（`keys.json`，仍走瞬間的 `layout.toggle`，見 `docs/plan-unified-header.md`） | `orca-panel-head` 的切換鈕 → `orca-tabs.toggle-panel`；`cmd-l`、`ctrl-shift-e` 仍是瞬間的 `layout.toggle:panel`（同一個問題） |

四個不對稱，全部是「右側欄不像左側欄」的原因：

1.  **內容沒有 frame。** 左側欄的 `orca-nav`、`orca-spaces`、`orca-chrome` 各自把內容包進
    `sidebarFrame()`（三份相同的複本），所以動畫期間文字不重排、只滑動與淡出。右側欄的
    `orca-panel-head` 與 `panel-body` 的八個 child（`orca-files`、`orca-agents`、
    `orca-panel-gap`、`orca-changes`、`skillshare`）都沒有包，寬度一變就重新排版。
2.  **曲線不受 `props().motion` 控制。** 左側欄有三條路徑：`native`（原生時鐘）、
    `smooth`（smoothstep 計時器）、`layout`（抽屜曲線計時器）。右側欄只有原生時鐘一條，
    且不受 `motion` 影響。把 `motion` 改成 `smooth` 之後，兩側的曲線會不一樣。
3.  **tab strip 的視窗寬度每幀改變。** header 區塊在 `left` column 裡（不含 panel），
    panel 一窄，header 就變寬（或反之），`tab-viewport` 的 `on_size_change` 每幀更新
    `viewportWidth`，`clampTabStripScroll` 可能在動畫中途把捲到右端的 strip 往左拉，
    overflow 箭頭也可能在動畫中途出現或消失。左側欄用的是 `unified-gap` 佔位，不會動到
    視窗寬度。
4.  **沒有任何量測。** 左側欄有 `/tmp/sidebar-native-*.json`（`measureSidebar` 開關）。
    panel 沒有對應的取樣，所以「右側欄順不順」目前只有肉眼。

另外，鍵盤路徑（`cmd-l`、`ctrl-shift-e` → `layout.toggle:panel`）仍是瞬間切換，
與左側欄的 `cmd-b`/`ctrl-shift-b` 是完全一樣的已知問題；本文件不動 `keys.json`，只記錄它。

### 為什麼「縮放」做不到

*   `MotionProperty` 只有五種屬性。`gpui-kit` 的 `transform` 是 `FluentBuilder.map`
    （把元素交給一個函式），不是視覺變換；`d.ts` 裡也沒有 `scale`、`rotate`、
    `perspective`、`camera`。唯一的縮放輸入是 `on_pinch` 手勢事件，不是樣式。
*   終端機不是 mod 畫的。它是 layout 的 block，內容由 host 畫；mod 只能在
    `orca-pane`（32px 的 pane 標頭）這個 header slot 裡畫東西，碰不到格線。
*   縮放的視覺定義是「每個字元變大變小、欄列數跟著變」。在 Herdr 裡那等於改終端機字型或
    儲存格尺寸（`terminal_cell_width` / `terminal_line_height`，0.8..2，來自 settings 或
    layout，不是每幀可改的執行期值），每次改都是 PTY 尺寸變更 = 文字重排。前一版量到：
    原生時鐘逐幀 resize 會產生 35 次 core size events，釘住 `main` 才壓到 2 次。逐幀做
    縮放會把那個數字放大一個量級，而且畫面上會看到文字重排，不是縮放。
*   全域的替代品（`cx.set_rem_size`、`app.zoom_in`/`app.zoom_out`）都會連左右側欄一起縮，
    是離散級距，而且每一步都是全視窗重排。不是「中間縮放」。

## 可達成的效果（四選一，或組合）

### 選項 A：維持現況（寬度夾窄）

中間被夾窄、內容重排、終端機在結尾重排一次。這是現在的行為，已經「會動」，但不像縮放，
而且右側欄的 panel 內容在中間過程會被擠。

*   **成本**：0。
*   **什麼時候夠用**：作者要的只是「不要瞬間跳」，而中間被夾窄可以接受。

### 選項 B：右側欄專用的內容 frame（左側欄的鏡像）

把 `sidebarFrame()` 鏡像成 `panelFrame()`：內框固定開啟寬度、**靠右對齊**、往右位移
`(1-k)*28`，並蓋上一層 `surface` 色的平塗蓋層（alpha `clamp(1 - (k-.15)/.85)`）。
差別只在對齊邊與位移方向。這樣動畫期間 panel 內容不重排、只滑動與淡出，與左側欄一致。

在此之上可以再加「卡片內縮」的錯覺：卡片（`work-body` 裡的終端機）右緣隨 k 往左，配合
`orca-pane` 32px 標頭帶與內距的輕微變化，視覺上像卡片往內退。這仍然不是縮放（字級不變），
但比單純夾窄更接近「縮放感」。

*   **成本**：`orca-panel-head` 與 panel body 的五個 mod（八個 block）各包一層，或把 `panelFrame()`
  放到 `shared/` 由 `scripts/sync-shared.mjs` 複製。**注意**：現有的 `sidebarFrame()` 已經
  有三份複本（nav / spaces / chrome），要動的話應該一起收進 `shared/`，否則會變成六份。
*   **風險**：三個 panel 區塊（head 31px、body、footer 無）不在同一幀開始，顏色要與 panel
  的 `surface` + 1px `border` 對齊。左側欄已經踩過這兩個坑。

### 選項 C：離散縮放級距（真的變小，但是跳的）

只改終端機的儲存格尺寸或字型：例如展開時 1.00 → 0.92 兩段、收合時反向。每次都是一次 PTY
重排，所以只能有 2 到 3 段，不能連續。

*   **成本**：需要一個「改終端機字型/儲存格」的槓桿，目前只有 settings/layout 層的
   `terminal_cell_width`、`terminal_line_height`，沒有執行期指令，也沒有 per-pane 版本。
   **要先驗證存不存在**，等於 host 功能，可能直接不可行。
*   **風險**：文字重排兩次、比例跳動、以及與 `pinSidebarTerminal` 的釘寬邏輯衝突。

### 選項 D：host 原生 transform / 版面動畫（唯一真解，未來工作）

讓 layout 節點有 `scale`，或讓 `layout.resize`/`hide`/`show` 接受時長與曲線，由 gpui 在
原生程式碼裡以顯示器更新率插值。這與 `design_draft.md`（左側欄順暢度）的選項 C 是同一件
事。herdr-app 原始碼不在這個 repo，且升級會覆蓋 shipped mods/layouts，因此不在本次範圍。

### 明確不採用

| 做法 | 為什麼不 |
|---|---|
| `cx.set_rem_size()` 逐幀縮放 | 只縮 mod 自己用 rem 的尺寸，終端機格線不動；是全視窗重排，render 中非法，且會把左右側欄一起縮 |
| `app.zoom_in` / `app.zoom_out` 當動畫 | 離散、全域、每步全視窗重排；也不是「只有中間」 |
| 用 mod 畫一個假的縮小卡片蓋在終端機上 | 格線不會跟著縮，只會更不一致；而且等於覆蓋終端機內容 |
| 面板浮在終端機上方（抽屜） | 作者已否決（會覆蓋終端機內容），見 `design_draft.md` |

## Goals

*   G1. 回答「能不能」：右側欄的滑動機制已存在，本文件說明它與左側欄的差距。
*   G2. 把「縮放」拆成四個可行/不可行的層級，每一個都說明它到底是什麼視覺效果。
*   G3. 給出可實作的最小下一步（選項 B），以及它要動哪些檔案、怎麼驗證。
*   G4. 任何改動都以 `props()` 開關控制，舊 `orca` 版面與 `motion: "layout"` 的行為不變。

## Non-Goals

*   不改 host（herdr-app）。選項 D 只記錄，不實作。
*   不新增鍵綁定，不動 `keys.json`。
*   不重畫面板的視覺設計（顏色、圖示、順序都不變）。
*   不在本文件階段跑量測；量測屬於實作的第一階段（Panel 0）。
*   不處理 panel 拖曳改寬（`resizable`）時的動畫，那是另一個輸入路徑。

## Open Questions

*   **Q1：右側欄內容真的需要 frame 嗎？** panel 的內容大多是清單與樹（檔案樹、changes），
    被壓窄時本來就會重新排版；左側欄的專案樹當初是為了避免「夾扁」才加 frame。要先看一段
    錄影決定值不值得動那六個 mod（九個 block）。
*   **Q2：`orca-panel-head`（31px 的 icon 條）該不該跟內容一起滑？** 它現在是唯一還
    會被壓窄的 panel 區塊。作者的初步描述是「按下去後，icon 左邊出現一組關於這個子畫面的
    操作」，那是新功能（每個子畫面的操作群組），要先定範圍：圖示列本身要不要像內容一樣
    「保持寬度滑出去」，還是它要留在原位當那組操作的錨點。
*   **Q3：曲線要不要跟 `motion` 對齊？** 現在右側欄永遠是原生 `ease-in-out` 500ms。若
    `motion` 改成 `smooth`，左右會不一致。要不要讓 panel 也有 timer 版本，還是把 panel
    固定為原生（並在文件裡寫明）？
*   **Q4：tab strip 在 panel 動畫中會不會跳？** `viewportWidth` 每幀改變 → `clampTabStripScroll`。
    需要一次「strip 捲到右端 + 開關 panel」的實測。
*   **Q5：panel 動畫時 PTY 真的只 reflow 一次嗎？** 左側欄量過（35 → 2 次），panel 沒量過。
    這是選項 A/B 的共同前提。
*   **Q6：卡片內縮的幾何會不會撞到「第一顆 tab 貼齊卡片左上角」？** `flushable()` 的判定
    依賴卡片左緣 = 側邊欄右緣；卡片若同時往內縮，左緣與右緣的位移量不同，flare 與圓角的
    視覺會不對稱。
*   **Q7：`pinSidebarTerminal` 這個 prop 現在同時管左右兩側的釘寬。** 名稱已經不符（它管
    panel 的釘寬）。要不要拆成 `pinWorkTerminal`，還是只加註解？

## Critical User Journeys (CUJs)

### CUJ 1: 收合與展開右側欄

*   **Given**: `orca-unified` 版面，右側欄展開在 350px，中間是 `main-terminals`。
*   **When**: 按 `orca-panel-head` 的切換鈕（或 `herdr-app do orca-tabs.toggle-panel`）。
*   **Then**: 面板在約 500ms 內平滑滑出/滑入，中間的卡片邊緣連續移動；終端機文字不在動畫
  期間重排（只在結尾一次）；`herdr-app status` 沒有錯誤。

### CUJ 2: 動畫途中反向

*   **Given**: 收合進行到一半（或收合剛結束、`layout.hide` 剛送出）。
*   **When**: 再按一次切換鈕。
*   **Then**: 從當下的寬度往反方向走，最終狀態是展開，不會停在隱藏，也不會閃出一格全寬的
  面板。

### CUJ 3: 左右同時

*   **Given**: 兩側都展開。
*   **When**: 先按左側收合，動畫途中按右側展開。
*   **Then**: `main` 的釘寬在同一個動畫結束後才還原成 `weight: 1`（`releaseNativePin()`
  只在兩邊都不 busy 時還原）；兩側動畫互不干擾。

### CUJ 4: 舊版面

*   **Given**: 切到 `orca` 版面。
*   **When**: 開關側邊欄與右側欄。
*   **Then**: 外觀與行為與現在完全相同（瞬間切換，沒有動畫）。

## Technical Plan (Architecture)

### 現在的路徑（已上線）

```text
orca-panel-head 的切換鈕 ──▶ run("orca-tabs.toggle-panel")
                                 │  wantPanelToggle++
                                 ▼
Tabs.render() 消費旗標 ──▶ togglePanelNative(cx)
                            │ 1. 釘住 main：px = header/zoom + panelOpen - sidebarPx
                            │ 2. 展開時：panel 先 resize 到 1px → show
                            │ 3. panelWidth = 目標寬度 / zoom；native 寬度轉場啟動
                            ▼
          panel-native-clock（隱形、絕對定位、h(1)、transition("width", 500ms ease-in-out)）
                            │  每幀 on_size_change → panelNativeSize({width})
                            ▼
                  run("layout.resize", {id:"panel", px})   ← 取整後改變才送
                            ▼
          host 重排 ──▶ work-body 與 header 寬度改變（終端機被釘住，只被裁切）
                            ▼
          結束：收合 → layout.hide + 隱藏狀態下 resize 回開啟寬；再 releaseNativePin()
```

### 已上線的增量（2026-11-23）

`shared/panel-motion.js` + 五個 panel mod 的 `render()` 包一層；`orca-tabs` 發佈
`shared("panel.openPx")`、`measurePanel` 取樣、`drawer.js` 一台動畫機；`keys.json` 四個鍵改
走動畫。全部已複製到 `~/.config/herdr-app`，六個 mod `herdr-app check` 通過，
`herdr-app status` 的 `errors` 為空。

### 選項 B 的增量（原始提案，供對照）

1.  **`shared/panel-motion.js`**（新檔，由 `scripts/sync-shared.mjs` 複製）
    *   `panelFrame(inner)`：讀 `shared("panel.openPx")` 與 `layout()` 的 panel px；
      `k = px / open`；`px >= open - 0.5` 或沒有 openPx 時直接回傳 `inner`（與
      `sidebarFrame` 相同的短路）。
    *   內框：`w(open)`、`overflow_hidden`、靠右對齊（`justify_end` 或 `left(k*open - open)`），
      位移 `+(1-k)*28`。
    *   蓋層：`theme().surface` 平塗，alpha `clamp(1 - (k-.15)/.85)`（與左側欄同一組數字）。
    *   順便把現有三份 `sidebarFrame()` 收進同一個檔案的 `sidebarFrame()`，讓兩側共用一組
      數字與短路條件（三份複本改成一份）。
2.  **`mods/orca-tabs/main.js`**
    *   在 panel 開啟寬度穩定時 `setShared("panel.openPx", panel.size.px)`（對稱於現有的
      `sidebar.openPx`）。
    *   `panelNativeSize()` 加取樣：`props()?.measurePanel` 時寫
      `/tmp/panel-native-<t>.json`，內容與 sidebar 版相同（`{target, open, steps:[{ms,px}]}`）。
3.  **`mods/orca-panel-head/main.js` 與 panel body 的五個 mod（八個 block）**
    *   把 render 最外層包進 `panelFrame(...)`。若 Q2 的答案是「head 不參與」，跳過
      `orca-panel-head`。
4.  **`layouts/orca-unified.json`**
    *   若要開關控制：`panel` 的三處 props 加 `motion`/`frame` 旗標；預設沿用現況。

### 卡片內縮（選項 B 的加強，需先答 Q6）

若作者要「更像縮放」，在 `frame` 之上加一組隨 k 變化的內距/圓角（例如卡片右緣的內距
`(1-k)*8`、pane header 帶的高度不變）。這只改 mod 畫得到的部分（`orca-pane` 標頭）與
layout 的 `terminal_padding`（靜態值，不能在動畫中改），所以**實際上能動的只有 mod 自己
的 chrome**；終端機格線不會跟著內縮。這一點必須在決定前講清楚，否則會做出「卡片在動、
字沒動」的怪畫面。

### 選項 C 的前置驗證（不改程式，只查）

*   `herdr-app commands | grep -i terminal` 是否已有 per-pane 字型/縮放指令。
*   若沒有：`settings.json` 的 `terminal_cell_width` 是否能在執行期生效（寫檔 + 重啟？）。
*   結論若是「只能重啟生效」，選項 C 直接淘汰。

## Alternatives Considered

*   **Alternative A：維持現況（寬度夾窄）** — 未排除，成本 0，是先前的預設。
*   **Alternative B：panel 內容 frame（左側欄鏡像）** — 建議的下一步；唯一不需要 host 改動
  就能讓右側欄「摸起來像左側欄」的做法。
*   **Alternative C：離散縮放級距** — 未排除，但要先確認有沒有執行期槓桿；成本與風險最高。
*   **Alternative D：host 原生 transform / 版面動畫** — 唯一真解，列為未來工作，不在本 repo。
*   **Alternative E：只動 header，版面瞬間跳** — 已否決（`design_draft.md`）。
*   **Alternative F：把 panel 做成一層浮在終端機上的抽屜** — 已否決（會覆蓋終端機內容）。

## Non-Functional Requirements

*   **Performance**：動畫期間每幀的 JS 工作應與左側欄相同等級（一次 `layout.resize` +
  各 mod 一次 render）；frame 版本不得引入每幀的離屏繪製（不要用 group `opacity`，用平塗
  蓋層，理由見 `design_draft.md` 的 GPU 段落）。
*   **Rollback**：`props().frame` 關掉即回到現況；舊 `orca` 版面不受影響。
*   **量測**：右側欄要有與左側欄同格式的取樣檔，否則「順不順」無法比較。

## Verification Plan

*   **Build/Check**：每個改到的 mod 跑 `herdr-app check mods/<name>`；`herdr-app status`
  的 `errors` 為空。
*   **Unit Tests**：`node --test mods/*/*.test.js`。新增測試：
    *   `panelFrame()` 在 `px >= open - 0.5`、沒有 `openPx`、`k` 中間值三種情況的回傳。
    *   `panelNativeSize()` 的寬度去重與 stale hide 取消（照 `sidebar-native.test.js` 的三個
      既有案例各寫一份 panel 版）。
    *   `shared/` 收斂後 `node scripts/sync-shared.mjs --check` 必須通過。
*   **視覺**：`herdr-app shot` 連續截圖（不用螢幕錄影，幀率不固定），確認 panel 內容不重排、
  蓋層與 head 在同一幀開始。
*   **中途反向**：`herdr-app do orca-tabs.toggle-panel` 計時掃描（收合後 0.15 / 0.5 / 1.2 秒、
  展開後 0.02 / 0.2 / 0.45 秒反向），最終狀態都要正確。
*   **PTY**：`hc events` 計數 panel 開關期間的 core size events（左側欄的驗收方式），
  目標是 2 次以內。
*   **舊版面**：`herdr-app do layout.switch --name orca` 後確認外觀與行為不變。
*   **主觀**：作者在 app 內比較「現況」與「frame 版本」，決定要不要留。

## 給審閱者的風險清單

1.  「滑動已經有了」是讀 `b440ff0` 與 `orca-tabs` 得到的結論，**沒有**實機量測 panel 的
    幀率與 PTY events（Q5）。
2.  選項 B 要動六個 mod（九個 block）；`sidebarFrame()` 現有的三份複本若不一起收斂，會變成六份。
3.  「縮放做不到」的依據是 `gpui-kit.d.ts` 的 `MotionProperty` 五個值與「mod 碰不到
    layout 節點」這兩件事；若 host 版本更新加入 transform，這個結論就要重寫（請確認
    app/core 版本）。
4.  卡片內縮（B 的加強）只動得到 mod 畫的 chrome，終端機字級不動，容易做成「卡片在動、
    字沒動」的不一致畫面；建議先做 frame，不要同時做內縮。
5.  Q3 的曲線不對稱是既有問題，不是這次改動造成的；但若作者把 `motion` 改成 `smooth`
    做比較，右側欄不會跟著變，比較結果會誤導。
