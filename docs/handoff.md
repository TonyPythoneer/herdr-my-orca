# 修繕交接（現況）

**唯一工作目錄**：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`，分支 `worktree-workflow-stages-panel`。所有指令都在這裡執行，不要 `cd` 到別處、不要切換分支。

## 現況

`my-orca` Runner、planning skill、四燈 UI 已實作，經 review 發現失敗路徑有錯，修繕分階段進行（證據都在台帳，不在本檔）：

- **Phase A（F1、F2）、Phase B（F3、F4、F5）：已完成並驗收。**
- **Phase C：** F6、F8 只有紅燈測試（`todo`，等 owner 決定）；F7 完成；**F9（已解決：照 E12，不拒絕）　core 改綁。** owner 決定保留 E12：core id 變了且沒有進行中的 dispatch → 自動改綁；有進行中的 → 保留舊 id，由 hc 守衛擋下、走 R-F。邏輯已收成 `rebindCore`（`start`、`run` 共用），測試在 `my-orca/e12.test.mjs`。不要改成拒絕。

**F10　Tuning 燈：development 期間不該亮。** `lamp()` 已確認：`pending` 畫成空心圈（`border_1().border_color(l.color)`），所以 `"pending"` 就是規格要的「未開始」。在 `mods/orca-workflow/model.js` 的 `lights` 與 `my-orca/my-orca.mjs` 的 `lights`（兩份重複，都要改），把 Tuning 狀態裡的 `(state?.stage === "tuning" || tasks.length)` 改成 `state?.stage === "tuning"`。唯一可改的既有測試期望：`mods/orca-workflow/model.test.js` 的 `"lights show counts and gate states"` 裡 `["Tune", 0, 2, "working"]` 改成 `["Tune", 0, 2, "pending"]`。`my-orca/my-orca.test.mjs` 的 lights 測試只比數量，不用改。

**F11　缺圖示。** `mods/orca-workflow/main.js` 的 `ICON(name)` 指向 `mods/orca-status/${name}.svg`，但 `circle-help.svg` 實際只在 `mods/orca-chrome/`。在 `acceptanceRow` 內，把
`.child(svg(ICON(icon)).size(11).text_color(color))`
換成
`.child(row.pass === true || row.pass === false ? svg(ICON(icon)).size(11).text_color(color) : div().size(11).rounded_full().flex_none().border_1().border_color(color))`
（同檔 `lamp()` 已用同一組 `div().size().rounded_full().border_1().border_color()`，API 存在）。done-check：執行 `herdr-app check mods/orca-workflow` 並貼出輸出；指令不存在就貼出錯誤訊息，台帳標 `UNVERIFIED`，不要宣稱通過。

**F12　小錯碼。** `runTuning`（派發 Tuning 前，函式開頭附近）有 `if (!checked.ok) return needsUser(ctx, "tree_changed", checked.detail);`，改成 `needsUser(ctx, checked.code, checked.detail)`（`dispatchCheck` 回傳的 `code` 是 `tree_changed` 或 `unpushed`）。verdict `needs_user` 的碼 `bad_review` 保留不變（它在 `needs_user.code` 完整清單內）。

**F13　`--accept-head` 不可在 Runner 運行中改寫 state。** `startRunner` 處理 `acceptHead` 之前：`const live = hc.list({ "orca.run": state.run_id, "orca.role": "runner" }, { all: false });` 有結果 → `print(err, "start: stop the Runner first"); return EXIT.reject;`（`hc.list` 的呼叫形狀與檔內其他處相同：第一個參數是 labels 物件，第二個是 `{ all }`）。

**F14　`fake-e2e.mjs` 禁用清單。** 只改程式、**不要執行**。開頭用**不帶** `HC_SESSION` 的 env 讀 `hc server status --json` 取 owner core id，放進 `env.MY_ORCA_FORBID_CORE_IDS`，並斷言專屬 core id 不等於它，否則 abort。

**F15　UI 跨 worktree 誤通知。** `mods/orca-workflow/main.js` 的 `load()`：在 `this.wtId = wtId;` 這行**之前**加 `if (wtId !== this.wtId) this.lastStatus = null;`（`notifyTransition` 在這行之後才被呼叫）。

**F16　死碼。** 刪除 `RunnerExit`（`my-orca/my-orca.mjs`，目前有 `export`，專案內沒有別處引用）、`cmdInitCheck`、`escapeRe`、`lastChanged`（settleAndKill 內，F3 之後仍會被賦值但沒人讀）、`hc.json`、`makeRunnerContext` 的 `exits`。每刪一個先 `grep -rn <名稱> my-orca mods` 確認無其他引用。done-check：`node --check my-orca/my-orca.mjs` 與全套測試。

**F17　SKILL.md。** `skills/herdr-planning/SKILL.md` 在「Step 4」之前加一節「Constraints checklist」，逐條列出 `docs/spec-v2-converged.md` §8.2.3 的七條，要求逐條向使用者確認後才可呼叫 `my-orca init`。條文照抄 §8.2.3，不要自己改寫。

**F18　讓 happy path 有意義。** 新測試用真 git：臨時資料夾 `git init`、再建一個 bare remote 並設為 upstream；fake `hc.run` 真的執行 `git commit && git push`；`makeGit()` 真跑；斷言任務 `accepted`。再加一個 `commit-nopush` 變體（只 commit 不 push）→ `needs_user(unpushed)`。不碰任何 core。允許檔案：`my-orca/f18.test.mjs`。

## 5. 不要做（需 owner 或更強 model）

- 8.2.5 真 E2E；AT-03 (a)(b)（真 tab、`tab.close` 最後一個 tab）；U6／U9／U10 畫面與 `watchFolder` 遞迴性；U11／U12。
- 重跑 `fake-e2e.mjs` 8 個模式（會起專屬 core）。
- 用截圖宣稱畫面「已看過」：台帳 I-17 是 DEFERRED，不要改成 DONE。

## 6. 完成的定義

1. F1–F5 各有一個 commit，每項的台帳列都貼了紅/綠實際輸出。`node --test my-orca && node --test mods/orca-workflow` 全綠。
2. Phase C 若執行：同上；F6、F8 只有紅燈測試、無程式改動。
3. `docs/tasks-v2-implementation.md`：I-04、I-06、I-09 保持「部分完成」並指向對應的 F；A8／A9 保持「未經獨立驗證」。
4. `git log --stat` 檢查：所有 commit 只含該 F 允許的檔案與台帳；沒有 `README.md`、`mods/orca-status/*`、`.agentflow`、`AGENTS.md`。

**風險提醒**：F1–F5 完成前，不要在真 repo 啟用 `close_planning_tab`，也不要依賴 Resume 的第二次機會。
