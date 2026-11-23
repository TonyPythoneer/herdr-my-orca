# Tab 右鍵選單改版（方案 A · 精煉）— 給執行 AI 的 plan

Worktree: `wt-tab-menu-refresh`，branch `feature/wt-tab-menu-refresh`（基於 `9d09005`）。
視覺預覽（可互動，三版可切換）：`docs/concepts/tab-menu-concept.html`，瀏覽器直接開。
**已決定：做 A。不做 B、不做玻璃。** 不要 push、不要開 PR（local first）。

## 目標
修正現行 tab 選單：208px 寬使 "Move Tab to Split Right" 被截斷、24px 列高太擠、顏色盤壓在最底、看不出右鍵的是哪個分頁（右鍵可作用在背景分頁）。

## 限制（已查證）
- 選單是 mod 自繪的 gpui popup：寬度由 `openOverlay({ width })` 決定（`mods/orca-tabs/main.js:1281`，現為 `width: 208`）。
- 命令與順序 1:1 port 自 Orca `SortableTabContextMenu`（`mods/orca-menu/main.js` `case "tab"` 約 :138-185，註解引用行號）。**不改命令、不改順序。**
- 做不到：popup 背景模糊／玻璃、進場動畫（host 控制）。沒有內建子選單與 CSS。
- Enter 直接執行；只有關閉 agent／running tab 才有確認（保持）。

## 要做（A）
1. **寬度 272px**：改 `mods/orca-tabs/main.js:1281` 的 `width: 208` → `272`。同檔若有其他 tab 選單入口（grep `orca-menu` + `kind: "popup"`）一併確認。
2. **列高 24 → 30px**：`mods/orca-menu/main.js` 約 :737 `.h(24)`。只對 tab 選單？先確認此列渲染是否被 terminal／space／group 選單共用；若共用，用參數區分（tab 才 30），其他選單不動。
3. **Context header**：選單頂端一列，顯示分頁名、workspace、顏色點、pin 狀態。資料來自 `spaces()` / tab（`tg.id`、`own`、`tab?.settled`）。header 不可選、不進 ↑↓ 游標。
4. **間距與分隔線**：加留白與細線（沿用現有 `section()` 的 `div().mx(10).my(5).h(1).bg(t.border)`），不改分組。
5. **Close 危險色延後**：平常與其他列同色；hover／鍵盤選取才轉紅。
6. **快捷鍵 chip**：右側顯示 ⌘W（tab.close）、f2（tab.rename）、⌘D（split right）、⇧⌘D（split down），來源 `keys.json`（`cmd-w`、`f2`、`cmd-d`、`cmd-shift-d`）。優先從 keys 讀，不要硬寫；沒綁定就不顯示。
7. 顏色盤**留在底部**（A 的決定），僅調間距。
8. 外框：`frame: "none"` 自繪外框（若現有已是就只調圓角／邊框色）。

9. **新增 Close Tabs to the Right / Close Tabs to the Left**（使用者追加，屬於 A 的範圍）：
   - 位置：緊接在 Close Others 之後、同樣 inset，順序 Close Others → Close to the Right → Close to the Left。
   - 做法照 `orca-menu.close-others`（`mods/orca-menu/main.js` :436-455，選單項 :179，inset 判斷 :729，圖示 :276，危險色判斷 :323/:351）：新增 `orca-menu.close-right`／`orca-menu.close-left`，以該 tab 在 `owner.tabs` 的 index 切出右／左側、排除 `settled`（釘選）的 tab，開 `confirmClose` bulk 對話框。
   - 確認對話框已支援 `scope: "right"`／`"left"`（`mods/orca-tabs/main.js` :746-747，標題已有），直接傳入即可；仍需確認其文案與 tabIds 流程對這兩個 scope 正常。
   - 該側沒有可關的 tab（最右／最左，或全是釘選）時不顯示該列（同 Close Others 只在 `list.length > 1` 顯示的作法）。
   - 這兩列會讓選單變長：重新量高度，驗收「最長情況」要含它們。
   - Orca 原版沒有這兩列；在 `case "tab"` 註解標明是 Herdr 追加，不屬 1:1 port。

## 不做
子選單／flyout（B）、36px 列高、顏色上移、玻璃、動畫、改命令順序。若一週後仍嫌長，另開 plan 以 A 為底加 flyout。

## 風險
- 高度：A 約 500px；在 13 吋螢幕驗證不超出視窗（含 Close Others、Close split pane 全出現的最長情況）。
- 272px 的 popup 靠右邊緣時位置是否被 host 夾住。
- 列高若被其他選單共用會連帶改動（見 2）。

## 驗收
- Split Right/Left/Down/Up 四列文字完整不截斷。
- 在背景分頁右鍵：header 顯示該分頁而非目前分頁。
- ↑↓／Enter／Esc 行為與改版前一致；header 不被選中。
- Pin/Unpin、顏色選取、Copy Tab ID、Close Others、Close split pane 照常運作。
- Close to the Right/Left：只關該側、釘選 tab 不被關、最左／最右 tab 不出現對應列、確認對話框列出正確數量。
- 單一分頁時（無 Close Others／Move Tab）選單仍正確。
- 其他選單（terminal、space、group）外觀不變。
- 跑 repo 既有測試（`mods/*/*.test.js` 的測試指令，見 package.json）。

## 流程（必做）
改 `mods/` 前先載入 `herdr-app-dev-sync` skill：repo 與 live `~/.config/herdr-app/` 兩邊都要更新；copy 前先 diff；copy 交給 haiku subagent；`herdr-app check` 每個改動的 mod，`herdr-app status` 無錯。不留 probe mod。不要碰 `AGENTS.md`、`.agentflow`。
僅動：`mods/orca-menu/main.js`、`mods/orca-tabs/main.js`（一個 width）。

## 待使用者決定（實作時若未回覆，用括號內預設）
- 顏色是否留底部（預設：留底部）。
- header 是否顯示 workspace（預設：顯示）。
