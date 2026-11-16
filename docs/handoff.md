# 修繕交接（現況）

**唯一工作目錄**：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`，分支 `worktree-workflow-stages-panel`。所有指令都在這裡執行，不要 `cd` 到別處、不要切換分支。

## 現況

`my-orca` Runner、planning skill、四燈 UI 已實作（`c958d8e`），經 review 發現失敗路徑（reject、Resume、reconcile）有錯。修繕分階段進行：

- **Phase A（F1 E47 無限重派、F2 Resume +2）：已完成並驗收**，commit `28efc93`、`e279a4e`。測試在 `my-orca/f1f2.test.mjs`。
- **Phase B（F3、F4、F5）：下一步。**
- **Phase C（F6–F18）：只有 owner 明說才做。**

規格以 `docs/spec-v2-converged.md` 為準（**§8.2 與 §4.9 M6–M15**）；本檔沒涵蓋的情況，停下回報，不要自己決定。進度與證據寫在 `docs/tasks-v2-implementation.md`。

## 給 owner：怎麼推進

**派工**（原樣貼給執行的 model）：

```
工作目錄：/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel
請完整讀 docs/handoff.md，然後只做 Phase B：F3、F4、F5。
每項一個 commit，照第 2 節的固定流程，台帳貼指令的實際輸出。
F5 的測試若紅燈原因與 handoff 描述不同，請停下回報，不要自己改測試條件。
三項都完成後停止，不要進 Phase C，回報摘要給我。
```

**驗收**（對方回報完成後，逐項看；驗收時不要改程式，要改就請對方改）：

1. 範圍：`git log --oneline e279a4e..HEAD` 應為 3 個功能 commit（F3、F4、F5）；`git diff --name-only e279a4e..HEAD` 只能出現 `my-orca/my-orca.mjs`、`my-orca/f3.test.mjs`、`my-orca/f4.test.mjs`、`my-orca/f5.test.mjs`、`docs/tasks-v2-implementation.md`。出現 `README.md`、`mods/orca-status/*`、`.agentflow`、`AGENTS.md`、`fake-e2e.mjs` 就是不及格。
2. 全套綠：`node --test my-orca && node --test mods/orca-workflow`（預期 my-orca 36 + 新增測試數、workflow 8，0 fail）。
3. 新測試必須在舊程式上是紅的（以 `e279a4e` 為舊程式；`f3`、`f4`、`f5` 各跑一次）：
   ```
   T=$(mktemp -d) && git archive e279a4e my-orca | tar -x -C "$T" \
     && cp my-orca/f3.test.mjs "$T/my-orca/" \
     && (cd "$T" && node --test my-orca/f3.test.mjs 2>&1 | grep -E "✖|ℹ (pass|fail)")
   ```
   F5 的紅燈原因必須是 `core_id` 為 undefined 導致 `skipped:gone`。
4. 程式檢查：`grep -n "hc.kill(" my-orca/my-orca.mjs` 只應出現在 `killOwned` 內；`grep -n "unsettled" my-orca/my-orca.mjs` 應看到 `let unsettled`、`unsettled = true;`，以及函式最後的 `if (unsettled) {…}`，且不再有 kill 之前的 unsettled 回傳；`grep -n 'closed === "closed"' my-orca/my-orca.mjs` 應有結果。
5. 台帳每項有實際輸出（紅、綠各一份），不是「測試通過」之類的描述。

**判定**：全部符合 → 通過；只有台帳或 commit 範圍有問題 → 請對方只修那項；程式偏離 → 請對方還原重做，再偏離就換更強的 model；對方做了本檔沒寫的事或謊報結果 → 停用，改由更強的 model 接手。

Phase C 的決策點：**F9** 照規格 M13 是對的，但 Herdr 重啟後 core id 會變，舊 run 就不能再 `start`／`run`，先確認你接受；**F6、F8** 只寫紅燈測試，之後要不要真的重構、退避要有人決定；F10–F17 是小修；真 E2E、AT-03(b)、畫面驗證要 owner 在場。

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

## 3. Phase B（現在要做的）

### F3　M7：上限到了，也要先 kill、掃描，才回 `unsettled`

允許檔案：`my-orca/my-orca.mjs`、`my-orca/f3.test.mjs`（新增）。

背景：`settleAndKill` 在等待迴圈之後，若 HEAD 或工作樹「還在變」就立刻 `needsUser("unsettled")` 並 return——**在 kill 之前**，worker 被留著繼續改檔。規格 §4.9 M7 上限：照樣 kill → M14 sweep → 完整檢查；最後仍在變才 `unsettled`。

**修法**：在 `settleAndKill` 內

1. 在函式開頭 `let lastChanged = null;` 那行下面加 `let unsettled = false;`。
2. 把
   ```js
       lastChanged = finalInfo;
       // keep moving: do not accept an unsettled tree
       if (await needsUser(ctx, "unsettled", "HEAD or the working tree was still changing after the result appeared")) return { stop: true };
   ```
   換成 `unsettled = true;`。外層 `if (finalInfo.ok && prev !== …) { … }` 與緊鄰的 `lastChanged = finalInfo;` 這一行**都保留不動**。
3. 在函式最後 `return { stop: false, info };` 的**前一行**加：
   ```js
     if (unsettled) { await needsUser(ctx, "unsettled", "HEAD or the working tree was still changing after the result appeared"); return { stop: true }; }
   ```

**測試**（`my-orca/f3.test.mjs`）：沿用 `my-orca/f1f2.test.mjs` 的 `world()` 與 `setup()`（整段複製到新檔頂部），改兩處：`git.info` 每次回傳不同的 `head`（用計數器），`hc.get` 讓 terminal 永遠 `status.state === "working"`，`clock` 每次呼叫 +31000 ms。斷言：`hc.kill` 至少被呼叫 1 次，且 `state.needs_user.code === "unsettled"`。（寫法以 `world()` 為準：`kill` 是 `hc` 物件上的函式，把它換成會計數的函式。）

### F4　每一次 kill 都先核對標籤、並寫 `kill` 事件（R-G）

允許檔案：`my-orca/my-orca.mjs`、`my-orca/f4.test.mjs`（新增）。

背景：`settleAndKill` 的 kill 區段正確（先 `hc.get` 核對 `orca.run`/`orca.dispatch`/`orca.role`/`created_ms`，通過才 kill，並寫 `kill` 事件）；但 `resumeState` 內有一處 `try { if (d.address) ctx.hc.kill(d.address); } catch …` **直接 kill、沒核對、沒事件**。

**修法**：

1. 新增函式（放在 `removeWorker` 之前），內容是把 `settleAndKill` 中從 `let canKill = false;` 到 `await ctx.event("kill", …)` 的整段搬進來：
   ```js
   async function killOwned(ctx, dispatch) {
     // returns { stop: true } when the caller must stop (identity / core mismatch); otherwise { killed }
     … (搬過來的程式碼；原本的 `return { stop: true }` 保持不變；結尾 `return { killed: canKill };`)
   }
   ```
2. `settleAndKill` 中被搬走的位置改成：`const k = await killOwned(ctx, dispatch); if (k.stop) return { stop: true };`
3. `resumeState` 中把那個 `try { if (d.address) ctx.hc.kill(d.address); } catch (e) { … }` 整塊換成：`const k = await killOwned(ctx, d); if (k.stop) return { ok: true };`（原本核心不符時也是 `return { ok: true }`）。

**測試**（`my-orca/f4.test.mjs`）：用 `world()` 的形式，兩個 case：(a) `hc.get` 回傳的 terminal，`labels["orca.dispatch"]` 是別的值 → 斷言 `hc.kill` **沒被呼叫**、`needs_user.code === "identity"`；(b) 標籤相符 → 斷言 `hc.kill` 被呼叫，且事件收集陣列裡有一筆 `kill` 事件含 `address`。（事件用 `makeRunnerContext` 的 `event` 參數收集：`event: async (name, e) => events.push([name, e])`。）

### F5　`planning.core_id` 要被記下來

允許檔案：`my-orca/my-orca.mjs`、`my-orca/f5.test.mjs`（新增）。

背景：`closePlanningTab` 比對 `p.core_id`，但 `planningFromTerminal` 從不寫入它 → `close_planning_tab=true` 時一律 `skipped:gone`，功能不會動。

**修法**：

1. `planningFromTerminal(term)` 改簽名 `planningFromTerminal(term, coreId)`，回傳物件裡 `closed: null,` 之前加 `core_id: coreId,`。
2. `cmdInit` 裡 `planning: planningFromTerminal(planningTerm),` 改成 `planning: planningFromTerminal(planningTerm, coreId),`（`coreId` 在同一函式內已存在，同一個物件的 `core_id: coreId,` 就在附近）。
3. `closePlanningTab` 開頭，`const p = ctx.state.planning;` 下一行加：`if (p?.closed === "closed") return "closed";`（**只**跳過已關閉的；不要擴大成「任何 closed 值」，否則事後把 `close_planning_tab` 改成 true 就永遠不會關）。

**測試**（`my-orca/f5.test.mjs`）：`closePlanningTab` 有 export。造 `ctx`（`makeRunnerContext`）：`state.planning = { address:"t1", core_id:"c1", tab:"tab9", closed:null, created_ms:1, turn:0 }`，`config.close_planning_tab = true`，`hc.coreId = () => "c1"`，`hc.get` 回一個 `state:"live"`、`status:{state:"idle"}`、`created_ms:1` 的 terminal，`app` 參數傳會記錄呼叫的假函式（`closePlanningTab(ctx, { app: fake, wait: false })`）。斷言：回傳 `"closed"`、`fake` 收到的 args 含 `"tab.close"`。再一個 case：`planning.closed = "closed"` → `fake` 一次都沒被呼叫。**先在現況上跑，確認紅的原因是 `core_id` 為 undefined → `skipped:gone`**；紅燈原因不同就停手回報（`closePlanningTab` 後半段的條件可能比這裡寫的多，以實際程式為準）。

### Phase B 結束：停

把 F1–F5 的結果（每項的紅/綠輸出、commit hash）寫進台帳，向 owner 回報一段摘要，**然後停止**。等 owner 說「繼續」才進 Phase C。

## 4. Phase C（只有 owner 明說繼續才做）

先決條件：Phase A、B 都已 commit，`node --test my-orca && node --test mods/orca-workflow` 全綠。

**F6　`stage_head` 單一化 — 只寫紅燈測試就停，不要重構。** 現況：`state.repo.stage_head`（init 後從不更新）、`state.stage_head`、`dispatch.stage_head`（無人讀）三份。已知後果：reconcile 的 is-ancestor 退化成「init head 的後代」，退回到中間 commit 再 force push 會漏抓。**只**寫一個測試：「HEAD 是 init head 的後代、但不是最後一次 accepted head 的後代」→ `pushCheck`（有 export）應判 `ok:false`。現況上若紅不起來 → 台帳寫 `NOT REPRODUCED`。若紅了 → 台帳寫「紅燈測試已寫好、等待 owner 決定重構」，**停**。不要動 `stage_head` 的任何用法。

**F7　開機掃描清殘留 worker（依賴 F4；F4 若 FAILED 就跳過）。** `scanWorkers`：dispatch id 屬於某個已結束 attempt、且不等於 `state.dispatch.id` 的 live worker，先 `killOwned` 再 `ctx.hc.rm`（現況只標 `unknown_worker` 卻不 kill）。測試：`hc.list` 回一個 live、id 在 `task.attempts[].dispatch` 裡的 terminal；斷言有 kill 與 rm。允許檔案：`my-orca/my-orca.mjs`、`my-orca/f7.test.mjs`。

**F8　hc 失敗退避 — 只寫紅燈測試就停。** `waitForResult` 對 `HcError` 有退避，但 `dispatchTask`、`scanWorkers`、reconcile 的 `hc.list` 丟 `HcError` 會讓 Runner 直接崩。**只**寫測試：假 `hc.list` 丟 `HcError`，斷言 `await runLoop(ctx)` 不會 throw（用 `assert.doesNotReject`）。確認現況紅 → 台帳寫「紅燈測試已寫好、等待 owner 決定退避策略」，**停**。不要新增 helper。（設定值 `hc_retry_min` 已存在於 `DEFAULT_CONFIG`，預設 5。）

**F9　不自動改綁 core（owner 已決定：照 M13 原文，拒絕）。** 在 `startRunner`：`if (!state.dispatch && state.core_id !== currentCore) { state.core_id = currentCore; await writeState(...) }`；在 `cmdRun`：`if (state.core_id !== currentCore) { if (!state.dispatch) { state.core_id = currentCore; … } else … }`。兩處都刪掉改寫，改成 `print(err, \`start: run belongs to core ${state.core_id}; set HC_SESSION\`); return EXIT.reject;`（`cmdRun` 的前綴用 `run:`）。`EXIT.reject` 已存在（`const EXIT = { ok:0, reject:1, usage:2, env:3 }`）。新增純函式 `export function coreMatches(state, id) { return state.core_id === id; }`，並用它判斷，加一個單元測試。副作用要告訴 owner：Herdr 重啟後 core id 會變，舊 run 就不能再 start/run，需要使用者自己處理。

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
3. `docs/tasks-v2-implementation.md`：Phase B 完成後，把 I-04、I-06、I-09 改成「部分完成」並指向對應的 F；A8／A9 保持「未經獨立驗證」。
4. `git log --stat` 檢查：所有 commit 只含該 F 允許的檔案與台帳；沒有 `README.md`、`mods/orca-status/*`、`.agentflow`、`AGENTS.md`。

**風險提醒**：F1–F5 完成前，不要在真 repo 啟用 `close_planning_tab`，也不要依賴 Resume 的第二次機會。
