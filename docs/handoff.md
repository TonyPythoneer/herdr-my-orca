# 修繕交接（現況）

**唯一工作目錄**：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`，分支 `worktree-workflow-stages-panel`。所有指令都在這裡執行，不要 `cd` 到別處、不要切換分支。

## 現況

`my-orca` Runner、planning skill、四燈 UI 已實作，經 review 發現失敗路徑有錯，修繕分階段進行（證據都在台帳，不在本檔）：

- **Phase A（F1、F2）、Phase B（F3、F4、F5）：已完成並驗收。**
- **Phase C：** F6、F8 只有紅燈測試（`todo`，等 owner 決定）；F7 完成；**F9 被規格 E12 擋住，等 owner 二選一，不要做**；另有審查修補 FIX-1（`3298581`）。**還沒做：F10–F18。**
- 基準：`node --test my-orca` 為 47 tests / 45 pass / 2 todo / 0 fail；`node --test mods/orca-workflow` 為 8 pass。

規格以 `docs/spec-v2-converged.md` 為準（**§8.2 與 §4.9 M6–M15**）；本檔沒涵蓋的情況，停下回報，不要自己決定。進度與證據寫在 `docs/tasks-v2-implementation.md`，待 owner 決定的事在該檔第 3 節。

## 給 owner：怎麼推進

**待你回答的事**（執行 model 不能代答）：F9 二選一（保留 E12／照 M13 拒絕並改 E12）；F5 紅燈原因偏離是否接受；F6、F8 要不要現在做（選項見台帳第 3 節）。

**派工**（原樣貼給執行的 model）：

```
工作目錄：/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel
請完整讀 docs/handoff.md，然後只做 F10、F11、F12、F13、F14、F15、F16、F17、F18（不含 F9、F6、F8）。
每項一個 commit，照第 2 節的固定流程，台帳貼指令的實際輸出。
遇到本檔沒寫的情況停下回報。全部完成後停止，回報摘要給我。
```

**驗收**（對方回報完成後，逐項看；驗收時不要改程式，要改就請對方改）：

1. 範圍：`git log --oneline 3298581..HEAD` 只有 F10–F18 各一個 commit（加台帳 commit）；`git diff --name-only 3298581..HEAD` 只能出現各 F 允許的檔案與 `docs/tasks-v2-implementation.md`。出現 `README.md`、`mods/orca-status/*`、`.agentflow`、`AGENTS.md` 就是不及格。（`fake-e2e.mjs` 只有 F14 可以改。）
2. 全套綠：`node --test my-orca && node --test mods/orca-workflow`，0 fail（`my-orca` 預期 47 + 新增測試數，另有 2 個 todo；workflow 8）。
3. 新測試在舊程式上是紅的（以 `3298581` 為舊程式，每個有測試的 F 各跑一次）：
   ```
   T=$(mktemp -d) && git archive 3298581 my-orca | tar -x -C "$T" \
     && cp my-orca/fN.test.mjs "$T/my-orca/" \
     && (cd "$T" && node --test my-orca/fN.test.mjs 2>&1 | grep -E "✖|ℹ (pass|fail)")
   ```
4. 程式檢查：F16 之後 `grep -rn "RunnerExit\|cmdInitCheck\|escapeRe" my-orca mods` 無結果；`node --check my-orca/my-orca.mjs` 通過；F11 若無 `herdr-app check` 就要標 `UNVERIFIED`。
5. 台帳每項有實際輸出（紅、綠各一份），不是「測試通過」之類的描述。

**判定**：全部符合 → 通過；只有台帳或 commit 範圍有問題 → 請對方只修那項；程式偏離 → 請對方還原重做，再偏離就換更強的 model；對方做了本檔沒寫的事或謊報結果 → 停用，改由更強的 model 接手。

**F6、F8、F9 的決策點**在台帳第 3 節；F10–F17 是小修；真 E2E、AT-03(b)、畫面驗證要 owner 在場。

## 1. 規則（違反任何一條，停手並回報）

1. 不重議：不用沙盒、全信任、靠 prompt 保護。不要問 owner 這些。
2. **不要跑 `my-orca/fake-e2e.mjs`**。**不要執行任何 `hc kill`、`hc rm`、`hc server stop`**（對任何 core）。全部用單元測試與假 hc／假 git。owner 的 core id 是 `4d8f77de81b61a7fe6e072fa653b27ba`，絕不可動。
3. 不要讀 `~/.config/opencode/`（含 API key）。
4. **只 `git add` 該 F 允許的檔案，用明確路徑**；不要 `git add -A`、`git add .`。**永不 commit `.agentflow` 或 `AGENTS.md`。** `README.md` 與 `mods/orca-status/*` 屬於別的 session：不要修改、不要 commit。commit 前一定跑：`git status --short` 和 `git diff --cached --name-only`，確認清單只有該 F 允許的檔案。
5. 不要對真的 remote push、不要開 PR。（唯一例外：F18 的測試在臨時資料夾對本機 bare remote push。）
6. **不要用 `git stash`**（stash 堆疊跟別的 session 共用）。
7. **不准改既有測試的期望值**，除非該 F 明文點名那個測試（只有 F6 的 `pushCheck` 測試與 F10 的 `model.test.js` 那一個 case）。
8. 對 owner 回覆：繁體中文、簡短、一次最多問 3 件事。
9. 用函式名稱找程式，不要靠行號（行號會漂移）。

## 2. 每個 F 的固定流程（一次只做一個 F）

```
1. 寫/放入測試
2. node --test my-orca        # 在【還沒修】的程式上必須紅，貼出失敗輸出
3. 修程式（只改該 F 允許的檔案）
4. node --test my-orca && node --test mods/orca-workflow     # 必須全綠，貼出輸出
5. git status --short ; git diff --name-only                  # 只能出現該 F 允許的檔案
6. git add <明確路徑> && git commit      # 一項一個 commit
7. 更新 docs/tasks-v2-implementation.md：新增一列 F<n>，貼上步驟 2 與 4 的實際輸出
```

- **證據一律是貼上來的指令輸出**，不要寫「測試通過」這類描述。
- commit 訊息用你自己的模型署名；不要用別人的署名。
- **步驟 4 出現任何預期以外的紅燈** → 還原該 F 動過的檔案：`git restore <那些檔案>`（新增的檔案用 `rm`）；台帳該列寫 `FAILED` 與失敗輸出；**跳過依賴它的項目**（F7 依賴 F4）；然後繼續下一個與它無關的 F；沒有無關的 F 就停止並回報。
- **步驟 2 紅燈寫不出來**（程式其實已正確）→ 台帳寫 `NOT REPRODUCED` 與你試過什麼，**不要改程式**，下一項。

## 3. Phase A、B

已完成並驗收，細節與證據見台帳 F1–F5。

## 4. Phase C

先決條件：`node --test my-orca && node --test mods/orca-workflow` 全綠。**F6–F9 的狀態見「現況」與台帳，這裡的說明只作背景；F6、F8、F9 沒有 owner 決定前不要動。**

**F6（已做：只有紅燈測試；重構等 owner）　`stage_head` 單一化。** 注意：現有測試放錯層，重構時要一併改寫（台帳第 3 節）。 現況：`state.repo.stage_head`（init 後從不更新）、`state.stage_head`、`dispatch.stage_head`（無人讀）三份。已知後果：reconcile 的 is-ancestor 退化成「init head 的後代」，退回到中間 commit 再 force push 會漏抓。**只**寫一個測試：「HEAD 是 init head 的後代、但不是最後一次 accepted head 的後代」→ `pushCheck`（有 export）應判 `ok:false`。現況上若紅不起來 → 台帳寫 `NOT REPRODUCED`。若紅了 → 台帳寫「紅燈測試已寫好、等待 owner 決定重構」，**停**。不要動 `stage_head` 的任何用法。

**F7（已完成）　開機掃描清殘留 worker。** `scanWorkers`：dispatch id 屬於某個已結束 attempt、且不等於 `state.dispatch.id` 的 live worker，先 `killOwned` 再 `ctx.hc.rm`（現況只標 `unknown_worker` 卻不 kill）。測試：`hc.list` 回一個 live、id 在 `task.attempts[].dispatch` 裡的 terminal；斷言有 kill 與 rm。允許檔案：`my-orca/my-orca.mjs`、`my-orca/f7.test.mjs`。

**F8（已做：只有紅燈測試；退避等 owner）　hc 失敗退避。** `waitForResult` 對 `HcError` 有退避，但 `dispatchTask`、`scanWorkers`、reconcile 的 `hc.list` 丟 `HcError` 會讓 Runner 直接崩。**只**寫測試：假 `hc.list` 丟 `HcError`，斷言 `await runLoop(ctx)` 不會 throw（用 `assert.doesNotReject`）。確認現況紅 → 台帳寫「紅燈測試已寫好、等待 owner 決定退避策略」，**停**。不要新增 helper。（設定值 `hc_retry_min` 已存在於 `DEFAULT_CONFIG`，預設 5。）

**F9　core 改綁（被擋住，等 owner）。** 原本的想法：`startRunner`／`cmdRun` 在 core id 不符時拒絕（`print(err, ...); return EXIT.reject;`，新增 `export function coreMatches(state, id)`）。但規格 §5 **E12** 寫「core id 不同、沒有進行中的 dispatch → 更新 `core_id` 繼續」，兩者相反。owner 二選一：(a) 保留 E12 與現況；(b) 拒絕，並同步改 E12（副作用：Herdr 重啟後 core id 會變，舊 run 不能再 start／run）。選 (b) 才照上面做，並補單元測試。

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
