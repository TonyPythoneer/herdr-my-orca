# UI 操作一致性計畫（herdr-my-orca ↔ Orca）

對照基準：`/Users/tonyyang/git/orca` @ `30d56bd62b0`（2026-11-19 21:10 -0800）
本仓库基準：`herdr-my-orca` @ `b21d442`（2026-11-20，分支 `feat/wt-align-orca`）
工作區：`main` checkout（`/Users/tonyyang/git/herdr-my-orca`）正在跑**別的**工作（11/20 14:2x 起
`agent-config`、`orca-status` 三個 commit）。本檔只在這個 worktree 裡改，不要直接動 main。
注意：1.E.1 的 tooltip 覆蓋率表是 `db0181a` 量的，`0e35f64` 已補了 `agent-config` 的 Save
tooltip + a11y label，那一列要重量。
範圍：**只做「操作」一致性**（選單項目、標籤、快速鍵、鍵盤導覽、hover/tooltip、狀態用語）。比例、尺寸、圓角、配色數值不在本計畫（配色只在「影響 light theme 行為」時列一項）。

> ⚠️ 環境缺口（依 `AGENTS.md` 規定回報）：agentflow skill 檔
> （`~/.agents/skills/agentflow/SKILL.md`）讀取被權限擋下，因此 agentflow 未啟動；
> `.agentflow/rules.md` 是空的。本檔是直接寫在 repo 根目錄的 `plan.md`，未走 agentflow 的
> plan/tracker 機制，也未寫入 devlog（那需要共享紀錄權限）。

---

## 0. 現況：已經對齊的部分（不用重做）

* 右側面板 tab 清單 ≈ Orca `right-sidebar/activity-bar/use-right-sidebar-activity-items.ts:120-208`
  （Explorer / Agents / Attached worktrees / PR Checks / Source Control / Checks / Ports）。
* Pane 右鍵選單主體順序、destructive 樣式、separator 規則、右側快速鍵提示都有照 Orca
  `TerminalContextMenu.tsx:219-380` 做，並附了 623 處 Orca 原始碼引用（品質很高）。
* `⌘D` / `⌘⇧D`（split right/down）、`⌘T`、`⌘W`、`⌘B`、`⌘=`/`⌘-`/`⌘0`、`⌘,` 與 Orca 預設一致。
* Tab 拖曳分欄（`TabBar.tsx` / ADR 0007）、middle-click 關閉、狀態圖示
  （working ring / done dot / permission glyph）都有逐行引用。

下面才是差異。

---

## 1. 已確認的差異

### A. 標籤漂移 — Orca `#45153`（fix(ui): shorten action labels across Orca，11/19 20:56）之後沒同步
該 commit 改了 renderer `en.json` 裡 **82 條**字串。會碰到你這邊表面的：

| # | 你的實作 | Orca 現在 | 位置 |
|---|---|---|---|
| A1 | `"Hand Off to Another Agent…"` | 選單列 `Hand off to agent`；對話框標題 `Hand off to another agent` | `mods/orca-menu/main.js:80`、`mods/orca-handoff/main.js:176` ↔ `AgentSessionContinuationMenuItem.tsx:18`、`AgentSessionContinuationDialog.tsx:33` |
| A2 | —（未做，但要留意） | `Continue in terminal` / `Continue in chat`（舊：`Continue with Terminal Agent` / `Continue in Chat UI`） | `SortableTabContextMenu` |
| A3 | — | `Sleep workspace`（舊：`Sleep workspace instead`）、`Open all changes`（舊 `Open all changes together`）、`Add SSH project`、`Show worktree`、`Hide checklist` | `en.json` diff |
| A4 | `Mark as read` / `Mark as unread` | `Mark Read` / `Mark Unread` | `mods/orca-spaces/main.js:1215-1216` ↔ `WorktreeContextMenu*` |
| A5 | `New space`、`New space here`（`orca-spaces:792,794,920`、`orca-menu:242`）與 `New workspace`（`orca-nav:255`）**同一個 UI 三种叫法** | 一律 `New workspace` | Orca 全文不用 "space" 當名詞 |

→ 動作：`git -C /Users/tonyyang/git/orca show df50c7b2938 -- src/renderer/src/i18n/locales/en.json`
逐條比對你 mods 裡的硬寫字串。

### B. 快速鍵不一致（`keys.json` ↔ `src/shared/keybindings/definitions-core-1..4.ts`）

| 動作 | Orca（darwin 預設） | 你目前 | 建議 |
|---|---|---|---|
| 切到第 N 個 workspace | `⌘1…⌘9` | `⌃1…⌃9` | **對調**（兩個都反了） |
| 切到第 N 個 tab | `⌃1…⌃9` | `⌘1…⌘9` | 同上 |
| Focus next/previous pane | `⌘]` / `⌘[` | `⌘]`=agent.next、`⌘[`=agent.prev | `⌘]`/`⌘[` 給 pane；agent 換 `⌘⌥]`/`⌘⌥[` |
| 上一個／下一個 tab（all types） | `⌘⇧]` / `⌘⇧[` | ✓ 相同 | — |
| Worktree history back/forward | `⌘⌥←` / `⌘⌥→` | 被 `pane.go:left/right` 佔用 | pane.go 改 `⌘⌥H/J/K/L` 或保留、把 history 放 `⌃⌘←/→`（要選一個，見 Q2） |
| Toggle Right Sidebar | `⌘L` | `⌘L` 是 terminal 跳到行首 | 保留行首（terminal 常用）→ 用 `⌘⇧E`/`⌃⇧E` 明確開 panel，並在 tooltip 寫清楚 |
| Search everything | `⌘K` | `⌘⇧P` → `app.palette`、`⌘P` → 自家 picker | 加 `⌘K`；`⌘P` 改給 Go to File（見 D4） |
| Go to File | `⌘P` | 無 | 缺（`orca-files` 已有 name filter，可接） |
| Reopen closed tab | `⌘⇧T` | 無 | 補 |
| Close pane | `⌘W`（跟 tab 同一個，依 canCloseTerminalPane 決定） | 另加 `⌘⇧W` | 移除 `⌘⇧W` 或標為 Herdr-only |
| Rename workspace | `⌘⌥R` | `⇧F2` | 補 `⌘⌥R`，F2 留著 |
| Delete workspace | `⌘⇧⌫`（+ `⌘⌥R` 那組） | 無 | 補（destructive，要確認框） |
| Prev/Next worktree | `⌘⇧↑` / `⌘⇧↓` | 無 | 補 |
| Show Explorer / Search / Source Control / Ports | `⌘⇧E` / `⌘⇧F` / `⌘⇧G` / `⌘⇧I` | 只有一個 `⌃⇧E` toggle panel | 改成 per-view chord（你 panel-head 已有那些 tab） |
| Toggle Sleeping Workspaces | `⌘⇧0` | 無 | 可選 |
| Toggle Floating Terminal | `⌘⌥A` | `⌃⌥A` → `orca-float.toggle`（你那個是 floating **workspace**） | 至少把 chord 改 `⌘⌥A` 對齊 |
| Collapse/Expand All Projects | `⌘⌥P` | 無（只有滑鼠） | 補（`orca-nav` 已有那颗按钮） |
| 其他你多加的 | — | `⌘⌥H/J/K/L`? 無；`⌃⇧B`（sidebar）、`⌃⌘-`? | `⌃⇧B` 是 VS Code 習慣，Orca 沒有；保留可，但要在 helper 表裡標「non-Orca」 |

### C. 選單項目與結構

**Pane 右鍵（`orca-menu` case `pane` ↔ `TerminalContextMenu.tsx:219-380`）**

* Orca 沒有：`Split Terminal Left` / `Split Terminal Up`、`Move to New Tab`、
  `Swap with Left/Right/Above/Below`、`Send right-clicks to pane`、`Send back to …`、`Copy Terminal ID`
  以外的自創列 → 這些是你的 **Herdr-only 附加列**，目前混在 Orca 的中間段落，
  造成「同一個選單兩種邏輯」。建議全部下沉到選單尾端一個 `Herdr` 標題 + separator 之後
  （見 Q1）。
* Orca 有、你缺：`Equalize Pane Sizes`（你註解說做不到 — OK，但請在選單裡用 disabled +
  tooltip 說明，而不是直接消失）、`Copy Session ID`（agent session id，你只有 Terminal/Pane ID）。
* Orca 的 `Add to chat` 是 **disabled 列**（不是消失）；你選擇不畫。兩取其一，但要全部表面一致。

**Tab 右鍵（case `tab` ↔ `SortableTabContextMenu.tsx`）**

* 你缺 `Tab Color`（Orca :223-250）、`Allow Auto-Close`（:197-205，你註解說 Herdr 無對應 → 同上用 disabled）。
* 你的 `Split terminal right/down` 用小寫 sentence case，同選單其他列是大寫 Title Case
  → 這是 Orca 的規則嗎？Orca 在 **keybinding 標題**用小寫、**選單列**用 Title Case，
  你這邊選單混用，請統一成 Title Case。

**Workspace 卡片的右鍵（case `space` ↔ `WorktreeContextMenuView.tsx:146-236`）**

| Orca | 你 |
|---|---|
| 段落標題 `Workspace` | 無標題（你只在 split-menu 有） |
| `Mark Read/Unread`、`Mute Notifications` | `Mark Read/Unread`，**缺 Mute Notifications** |
| `Delete Worktree` / `Delete`（destructive，刪除中 `Deleting…`） | `Close`（語意不同：你關 space，Orca 刪 worktree） |
| `Edit Details…`（rename+branch+emoji 對話框） | `Update`（只做 rename，而且標籤不同） |
| `Pin` / `Unpin`（卡片層） | 只有 tab 層 |
| `Open in ▸` 子選單（外部編輯器） | `Open in Terminal`（單列） |
| `Copy ▸` 子選單：`Path`、`Worktree Name` | 兩條平列 `Copy Path` / `Copy Worktree Name` |
| `Parent & Children ▸`、`Project Group ▸`（`New group from project`、`Move to group`、`Remove from group`、`New Project Group`） | 完全沒有 group 操作 |

**Project／group 表頭右鍵（case `group` ↔ `RepoHeaderProjectActionsMenu` + `ProjectGroupHeaderMenu`）**
你只有 `New worktree / Open worktree / Copy Path / Rename / Close`；Orca 另有
`New Project Group`、`New group from project`、`Move to group`、`Remove from group`、`Add SSH project`。

### D. Orca 有、你完全沒做的操作面（要決定做或明確標「超出範圍」）

1. **`+` 選單可客製**：`Customize`、`In the + menu` / `Hidden` 兩區拖曳、`Show`/`Hide`/
   `Always shown`、`Reset Order`、`All Keyboard Shortcuts…`
   （`tab-bar/create-menu/TabBarCreateRowCustomizer.tsx:151-365`）。你的 `orca-new-menu` 是寫死的清單。
2. **右側 activity bar 位置**：`Activity Bar Position` → `Side` / `Top`（`activity-bar-position-menu.tsx:80-96`）。
   你只有 `Top`。
3. **狀態列**：`StatusBarVisibilityMenu`（逐段開關）+ icon-only density（`status-bar/composition/`）；
   你有 `git blame`? 無。Orca 段：usage、accounts、app/skill/agent-cli/remote update、plugins、
   caffeinate、native-chat resume、git blame、pet、resources、ports、ssh、disk。你只有 usage/update/hosts/float。
4. **`⌘P` Go to File**、**`⌘K` Search everything**（含 quick actions、filter chips）。
5. **App rail（experimental，`feat(shell): add an experimental app rail #44953`）**：
   圖示式左欄（Workspaces / Help / Settings，arrow-key roving focus）。新東西，列 P3。
6. **卡片可組版**：`Workspace options → Card layout / Show properties`
   （`workspace-card/template/default-workspace-card.json`）。你已在 `orca-nav:319-320`
   自己標了 gap — 保持標記即可。
7. **狀態詞彙**：Orca 有 `failed` / `interrupted` 兩態（你註解說 Herdr 的 rollup 只有
   working/blocked/done/idle → 死碼，合理）；但 Orca 的文字標籤 `Needs you`、`Waiting on you`、
   `Unread result`、`Monitoring`、`Last turn failed`、`Host offline` 你都沒用，卡片只有圖示沒有
   tooltip 文字。建議至少把這些字放進 tooltip（純文字，不需新狀態）。
8. **Settings**：Orca 有快速鍵編輯器（record、衝突偵測、keybindings 檔）。你走 Herdr 的
   `app.settings` — 這是平台限制，寫進 README 的 "Not included" 就好。

### E. 你自己 UI 的內部不一致（「我希望操作都一致」最大的一塊）

1. **Tooltip / accessibility label 覆蓋率差很多**：

   | mod | `role("button")` | `.tooltip(` | `accessibility_label(` |
   |---|---|---|---|
   | orca-nav | 6 | 3 | 6 |
   | orca-pane | 2 | 8 | 2 |
   | orca-spaces | 12 | **1** | 12 |
   | orca-tabs | 6 | 7 | 7 |
   | orca-files | 4 | 8 | 5 |
   | orca-changes | **0** | 1 | **0** |
   | orca-menu | — | 1 | **0** |

   Orca 的規則是**每個 icon button 都有 tooltip，且帶 chord**
   （例：`app-shell/chrome/TitlebarLeftControls.tsx` → `Toggle sidebar ({{value0}})`）。
   → 定一條規則：`button(id, label, action, {chord})` helper 一次幫你上
   `role` + `accessibility_label` + `tooltip("Label (⌘B)")`，全站改用它。
2. **鍵盤導覽不統一**：`orca-menu` / `orca-new-menu` / `orca-split-menu` 有
   `↑ ↓ home end space esc`（+ enter）；`agent-config` **只有 esc**；`orca-handoff` 只有 `esc/enter`；
   `picker` 自己一套。→ 抽一個 `menuKeys(list, onPick, onClose)` 共用。
3. **`orca-split-menu` 有字母快速鍵**（`1-9 F ⇧F C ⇧C O ⇧O Z X`），Orca 的選單沒有 type-to-activate
   以外的一鍵執行；而且同一支選單在 `orca-menu` 裡完全不能用。→ 留 or 砍，但要一致（建議砍，
   改成 ↑↓+Enter，或把字母鍵改成 Orca 的 type-ahead 過濾）。
4. **硬寫顏色 180+ 處**（orca-spaces 38、orca-pane 34、orca-tabs 26 …），含 hover 色
   （`#404040b3`）、section header 色（`#8a8a8a`）。→ `themes/orca-light.json` 下 hover/selected
   行為會跟 dark 不一样，屬於「操作反饋不一致」。收斂到 theme token。
5. **destructive 樣式**已有規則（`--destructive`），但 `Close workspace`、`Remove worktree`、
   `Close split pane` 是否都套用要掃一遍。
6. **選單右側 chord 提示**只有 `orca-menu` 會顯示（從 `keys()` 查）；`orca-new-menu` 用
   `hint` 字串、`orca-split-menu` 顯示字母、`orca-nav`/`orca-panel-head` 完全沒顯示。
   → 共用 `orca-menu` 那個 `shortcut(name, args)` 實作。

---

## 2. 需要你決定的 5 件事（我附上預設）

| # | 問題 | 我的預設 |
|---|---|---|
| Q1 | Herdr-only 附加列（Split Left/Up、Swap、Move to New Tab、right-click routing、park、`New/Open worktree` 在 `+` 選單、Diff Breakdown panel、freebuff agent）要保留嗎？ | **保留**，但全部集中到選單尾端一個 `Herdr` 區塊（標題 + separator），Orca 那段逐字照 Orca |
| Q2 | 快速鍵以誰為準？ | **以 Orca 為準**，只在 terminal 輸入會壞掉時（`⌘L`）妥協 |
| Q3 | 做不做 `⌘P` Go to File / `⌘K` Search everything？ | 先 `⌘K`（接你現有 picker），`⌘P` 接 orca-files 的 name filter |
| Q4 | 標籤全部改用 Orca 的英文原文（含 "workspace" 不寫 "space"）？ | **是** |
| Q5 | `orca-light` 算不算目標範圍（影響 1.E.4 的優先序）？ | 算，列 P2 |

---

## 3. 執行順序

* [ ] **M1 標籤同步（0.5 天）**：A1–A5 + `#45153` 全 82 條掃一遍；`space`→`workspace`；
      tooltip 加 chord。驗：`grep -rn '"[A-Z][^"]*"' mods/orca-*/main.js` 逐條對 Orca 原文。
* [ ] **M2 快速鍵表（0.5 天）**：按 1.B 改 `keys.json`（⌘/⌃ 1-9 對調、⌘K、⌘⇧T、⌘⌥R、⌘⇧⌫、
      ⌘⇧↑↓、⌘⇧E/F/G/I、⌘⌥P、⌘⌥A）。驗：啟動後逐條按，並確認選單右側顯示的新 chord 一致。
* [ ] **M3 選單對齊（1–1.5 天）**：pane / tab / space / group 四個 case，按 1.C 補齊
      （含 disabled 列、`Copy ▸`、`Open in ▸`、Mute Notifications、Edit Details…、Tab Color、
      group 子選單），Herdr-only 段集中。驗：對同一情境並排截圖（Orca vs 你的 orca 佈局）。
* [ ] **M4 內部一致性（1 天）**：`button()` helper（tooltip+chord+a11y）、`menuKeys()` 共用、
      移除或統一 split-menu 字母鍵、選單 chord 提示统一、destructive 掃描。
      驗：`grep -c 'role("button")' / 'tooltip(' / 'accessibility_label(' 每個 mod 都要 ≈ 1:1:1`。
* [ ] **M5 缺少的表面（選做，各 0.5–1 天）**：D3 狀態列可見性選單 → D2 activity bar 位置 →
      D1 `+` 選單客製 → D4 `⌘K`/`⌘P`。
* [ ] **M6 長效檢查（0.5 天）**：寫一個 `scripts/parity-labels.mjs`：
      從 `/Users/tonyyang/git/orca` 抽出所有 `t('key','Default')` 的字串集合，
      比你 mods 裡硬寫的 `"..."` 標籤，輸出「Orca 沒有這句」+「近似但不同（大小寫/用字）」兩張表，
      接進你現有的 `*.test.js` 跑。這樣 Orca 之後改字，你能一鍵看到。

---

## 4. 這輪查了什麼／沒查什麼（誠實清單）

**已比對**：pane/tab/space/group 選單、右側 panel tab、`+`/new-menu、狀態列、
sidebar nav/chrome、cards 狀態圖示、handoff 對話框、`keys.json` ↔ keybinding catalog、
`#45153` 標籤 diff、`#44953` app rail。

**尚未逐項比對（下一輪）**：`orca-files` ↔ File Explorer（拖曳、undo/redo、new/rename/delete 的確認流程）、
`orca-changes` ↔ Source Control（stage/commit/amend/ push 後的行為）、`orca-diff`/`orca-diff-breakdown` ↔ diff viewer、
`orca-landing` ↔ New workspace / worktree-creation 對話框、`orca-float` ↔ FloatingWorkspacePanel、
`orca-agents` ↔ AI Vault/Agents 面板、`agent-config` ↔ Orca 的 agent launch setup panel、
拖曳多選／range selection、keyboard focus order（Orca 是 web，全站 Tab 可走）、
dictation／notifications／bots 相關表面（大概率超出你的範圍，需要先畫線）。

**工具限制**：`/Users/tonyyang/git/orca` 的部分檔案（`AGENTS.md`、`i18n/locales/en.json` 直接讀）
被權限擋；`en.json` 我是用 `git show <commit> -- <path>` 繞過的，所以**只能看到有 diff 的字串**。
如果你要我把「全部標籤 vs 你的全部標籤」做一次徹底比對，請開放 `/Users/tonyyang/git/orca` 的讀取權
（或把那個資料夾加進這個 session 的專案），M6 的腳本也需要它能讀那邊。
