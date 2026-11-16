# 修繕交接（現況）

**唯一工作目錄**：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`，分支 `worktree-workflow-stages-panel`。所有指令都在這裡執行，不要 `cd` 到別處、不要切換分支。

## 現況

修繕 F1–F18 **全部完成**（證據在 `docs/tasks-v2-implementation.md`，每項有紅／綠輸出與 commit）。基準：`node --test my-orca` 56 pass / 0 fail / 0 todo；`node --test mods/orca-workflow` 8 pass。

已定案的決定：F9 照規格 E12（沒有進行中 dispatch 時自動改綁 core）；F6 單一來源為 `state.repo.head`、`--accept-head` 取嚴格版；F8 退避沿用 `waitForResult`（`hc_retry_min`，到了安靜停下不改 state）。

**下一步：第 3a 節的 FIX-4 – FIX-7**（review 發現，尚未動工，不需要 owner 在場）。

**還沒做、需要 owner 在場**（第 4 節）：真 E2E、AT-03 (a)(b)、畫面驗證（I-17 DEFERRED）、重跑 `fake-e2e.mjs`。F5 紅燈原因與當初描述不同，owner 已接受。

規格以 `docs/spec-v2-converged.md` 為準（§8.2 與 §4.9 M6–M15）；本檔沒涵蓋的情況，停下回報，不要自己決定。


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

## 3. 已完成的修繕

F1–F18 的做法、測試與證據都在台帳；本檔不再重複。新的修繕項目請照第 1、2 節的規則與流程另開。

## 3a. 待修（review `e279a4e..554a131` 發現，尚未動工）

照第 2 節流程，一項一個 commit，順序 FIX-5 → FIX-6 → FIX-4 → FIX-7。每項允許的檔案：`my-orca/my-orca.mjs`、該項新增的測試檔、`docs/tasks-v2-implementation.md`。四項都是讀程式推得，還沒有紅燈測試；紅燈寫不出來就照第 2 節記 `NOT REPRODUCED`。

### FIX-5　Resume 時結果檔已存在，Runner 處理完就退出

- **現象**：`resumeState` 在「dispatch 的結果檔已存在」時 `return handleResult(...)`，回傳值是 `{accepted}`／`{retry}`／`{stop}`，沒有 `ok`。`runLoop` 的 `if (!resumed.ok)` 因此一律成立，印 `still needs the user: undefined` 後結束。state 是 `working` 但沒有 Runner，要再 start 一次。F3 的 `unsettled`（worker 已殺、結果檔在）按 Resume 就會走到這裡。
- **測試**（`my-orca/fix5.test.mjs`，fixture 參考 `f4.test.mjs`）：state 為 `needs_user`、有 dev dispatch、結果檔存在且 `status: "done"`、假 git 的 HEAD 已前進並已 push；兩個 task。跑 `runLoop`，斷言第一個 task 被接受**而且**第二個 task 有被派發（假 hc 的 `run` 被呼叫）。舊程式：第二個 task 沒被派發。
- **修法**：`resumeState` 那一行改成先 `await handleResult(...)`，結果有 `stop` 就回 `{ ok: false, detail: ctx.state.needs_user?.code }`，否則回 `{ ok: true }`。不要改 `runLoop`。

### FIX-6　`cmdRun` 讀不到 core id 時 core 防護失效

- **現象**：`cmdRun` 的 `rawHc.coreId()` 回 `null` 且沒有 dispatch 時，`rebindCore` 把 `state.core_id` 寫成 `null`；接著 `makeHc({ expectCoreId: null })` 沒有 `guarded`，`kill`／`rm` 不受保護，`MY_ORCA_FORBID_CORE_IDS` 也失效。`startRunner` 有 `if (!currentCore)` 檢查，`cmdRun` 沒有。
- **測試**（加在 `my-orca/e12.test.mjs`）：`rebindCore({ core_id: "old", dispatch: null }, null)` 必須回 `false` 且 `core_id` 仍是 `"old"`。舊程式：回 `true`、`core_id` 變 `null`。
- **修法**：`rebindCore` 開頭加 `if (!currentCore) return false;`；`cmdRun` 在呼叫它之前加與 `startRunner` 相同的檢查（印 `run: cannot read the Herd core id`，回 `EXIT.env`）。

### FIX-4　真的 `hc.get` 失敗時回 `null`，分不出「不存在」和「hc 壞了」

- **現象**：`makeHc` 的 `get` 只要 exit 非 0 就回 `null`。後果：
  - `list` 內 `addresses.map(get).filter(Boolean)` 會把 get 失敗的 live worker 丟掉 → `reconcile` 當成 worker 消失（記 `exit_without_result`、清 dispatch、留孤兒），`dispatchTask` 的 live worker 檢查也漏看。
  - `waitForResult`／`waitDelivery` 的 hc 失敗分支（F8、FIX-3）在正式環境走不到：core 斷線會變成 `stopped_without_result` 或 `undelivered`，而不是安靜停下。
- **已確認的 hc 行為**（唯讀指令實測）：terminal 不存在時 `hc get <addr> --json` exit 3，stdout 是 `{"error":{"kind":"not_found",...}}`；`hc ls` 沒有符合項目時 exit 0。
- **測試**（`my-orca/fix4.test.mjs`，寫法參考 `hclist.test.mjs`，用 `makeHc({ exec })` 注入假 exec）：
  1. `get` 遇到 exit 3 + `error.kind === "not_found"` → 回 `null`。
  2. `get` 遇到其他非 0（例如 exit 1、stdout 空）→ 丟 `HcError`。舊程式：回 `null`。
  3. `list` 的 `ls` 成功但其中一個 `get` 非 `not_found` 失敗 → 丟 `HcError`。舊程式：回少一筆的陣列。
- **修法**：`get` 改成 `not_found` 回 `null`、其他非 0 丟 `HcError`。**改完必須逐一檢查所有 `get` 的呼叫點**（`grep -n "hc.get(\|rawHc.get(\|\.map(get)" my-orca/my-orca.mjs`），沒接 `HcError` 的要補：
  - `settleAndKill`、`killOwned`：目前只接 `CoreGuardError` 其餘重丟，會讓 Runner 崩潰。改用 `hcRetry` 包住，`gaveUp` 就回 `{ stop: true }`（不改 state）。
  - `dispatchTask`、`runTuning` 在 launch 之後那個讀 `created_ms` 的 `get`：用 `hcRetry`，`gaveUp` 回 `{ stop: true, noStateChange: true }`。
  - `closePlanningTab` 的四個 `get`：`HcError` 視為這次不關，直接 `return "skipped:hc"`，**不要寫進 `planning.closed`**（下次還能再試）。
  - `cmdRun` 的 `rawHc.get(self)`：接住後印錯誤、回 `EXIT.env`。
  - `saveScreen`、`removeWorker`、`waitForResult`、`waitDelivery` 已經有 catch，不用動。
- 這項會動到很多路徑，步驟 4 出現預期外紅燈就照第 2 節還原並記 `FAILED`，不要硬修。

### FIX-7　`launchWorker` 的 `name_taken` 路徑沒接 `HcError`（輕微）

- **現象**：FIX-2 之後這裡的 `ctx.hc.list` 會丟 `HcError`，沒有 `hcRetry` 也沒有 catch，Runner 崩潰，dispatch 留在 `intent`（下次 start 時 `reconcile` 能接手）。
- **測試**（`my-orca/fix7.test.mjs`，fixture 參考 `f8.test.mjs`）：假 hc 的 `run` 回 `name_taken`、`list` 在該次呼叫丟 `HcError`；`runLoop` 不可 reject。舊程式：reject。
- **修法**：那個 `list` 用 `hcRetry` 包住；`gaveUp` 時 `launchWorker` 回 `{ hcFailure: true }`，`dispatchTask` 與 `runTuning` 看到就回 `{ stop: true, noStateChange: true }`。

## 4. 不要做（需 owner 或更強 model）

- 8.2.5 真 E2E；AT-03 (a)(b)（真 tab、`tab.close` 最後一個 tab）；U6／U9／U10 畫面與 `watchFolder` 遞迴性；U11／U12。
- 重跑 `fake-e2e.mjs` 8 個模式（會起專屬 core）。
- 用截圖宣稱畫面「已看過」：台帳 I-17 是 DEFERRED，不要改成 DONE。

## 5. 完成的定義

1. 每個修繕項目有 commit，台帳該列貼了紅／綠實際輸出；`node --test my-orca && node --test mods/orca-workflow` 全綠。
2. `git log --stat` 檢查：所有 commit 只含該項允許的檔案與台帳；沒有 `README.md`、`mods/orca-status/*`、`.agentflow`、`AGENTS.md`。
3. A8／A9 保持「未經獨立驗證」；I-17 保持 DEFERRED。
