# 修繕交接（現況）

**唯一工作目錄**：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`，分支 `worktree-workflow-stages-panel`。所有指令都在這裡執行，不要 `cd` 到別處、不要切換分支。

## 現況

修繕 F1–F18 **全部完成**（證據在 `docs/tasks-v2-implementation.md`，每項有紅／綠輸出與 commit）。基準：`node --test my-orca` 53 pass / 0 fail / 0 todo；`node --test mods/orca-workflow` 8 pass。

已定案的決定：F9 照規格 E12（沒有進行中 dispatch 時自動改綁 core）；F6 單一來源為 `state.repo.head`、`--accept-head` 取嚴格版；F8 退避沿用 `waitForResult`（`hc_retry_min`，到了安靜停下不改 state）。

**還沒做、需要 owner 在場**（第 4 節）：真 E2E、AT-03 (a)(b)、畫面驗證（I-17 DEFERRED）、重跑 `fake-e2e.mjs`。F5 紅燈原因與當初描述不同，見台帳 F5，等 owner 接受。

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

## 4. 不要做（需 owner 或更強 model）

- 8.2.5 真 E2E；AT-03 (a)(b)（真 tab、`tab.close` 最後一個 tab）；U6／U9／U10 畫面與 `watchFolder` 遞迴性；U11／U12。
- 重跑 `fake-e2e.mjs` 8 個模式（會起專屬 core）。
- 用截圖宣稱畫面「已看過」：台帳 I-17 是 DEFERRED，不要改成 DONE。

## 5. 完成的定義

1. 每個修繕項目有 commit，台帳該列貼了紅／綠實際輸出；`node --test my-orca && node --test mods/orca-workflow` 全綠。
2. `git log --stat` 檢查：所有 commit 只含該項允許的檔案與台帳；沒有 `README.md`、`mods/orca-status/*`、`.agentflow`、`AGENTS.md`。
3. A8／A9 保持「未經獨立驗證」；I-17 保持 DEFERRED。
