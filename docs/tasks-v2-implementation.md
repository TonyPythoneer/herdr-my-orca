# 實作任務台帳

分支：`worktree-workflow-stages-panel`　規格：`docs/spec-v2-converged.md`（§8.2 為準）　修繕指令：`docs/handoff.md`

規則：

1. 做完一項立刻更新該列的狀態與證據。
2. 狀態只用：`TODO`、`IN PROGRESS`、`DONE`、`PARTIAL`、`FAILED`、`NOT REPRODUCED`、`OWNER GATED`、`DEFERRED`。
3. 證據要貼**指令的實際輸出**（紅燈、綠燈各一份），不要只寫描述。
4. 規格衝突寫在這裡，不要默默改設計。

## 1. 功能（c958d8e 實作）

「未獨立驗證」＝實作者自述，Fable 5.2 review 沒有重跑。

| ID | 工作 | 狀態 | 備註 |
|---|---|---|---|
| I-02 | `my-orca` 純邏輯：state/config 原子寫入、防雙寫、handoff/tasks 驗證、profile 白名單、secrets 掃描 | DONE | 單元測試 |
| I-03 | `my-orca init`：環境檢查、upstream 自動建立、`push --dry-run`、預設分支拒絕 | DONE | review 對照 8.2.2 為 OK |
| I-04 | Runner R-A..R-H：派發、等待、M7、kill + M14、驗收、Tuning/rework、恢復對帳 | PARTIAL | F1、F2 完成；F3、F4、F6、F7、F8、F9 未做 |
| I-05 | `start / run / stop / status / config set`、M13 core 斷言 | PARTIAL | 自動改綁 core 待 F9 |
| I-06 | Planning tab 關閉，預設 `close_planning_tab=false` | PARTIAL | 啟用時一律 `skipped:gone`，待 F5 |
| I-07 | `fake-agent.sh` 與整合測試（`fake-e2e.mjs` 8 種模式） | DONE（未獨立驗證） | 實作者自述 8 種全 PASS；review 沒有跑它 |
| I-08 | `herdr-planning` skill | PARTIAL | 缺 8.2.3 七條 checklist，待 F17 |
| I-09 | `orca-workflow` UI：四燈、inspector、Peek/Resume/Stop | PARTIAL | Tuning 燈誤亮（F10）、缺圖示（F11）、跨 worktree 誤通知（F15） |
| I-10 | `layouts/orca.json` 四燈 block | DONE | |
| I-11 | 單元測試 | DONE | `my-orca` 36、`mods/orca-workflow` 8 |
| I-12 | `herdr-app check mods/orca-workflow` | DONE（未獨立驗證） | 畫面未人工看過 |
| I-13 | README Workflow 一節 | DONE | |
| I-15 | 真 E2E（8.2.5） | OWNER GATED | 要 owner 同意時間與額度 |
| I-16 | AT-03 (b) 最後一個 tab／多 pane | OWNER GATED | 要 owner 在場 |
| I-17 | AT-15/16/17 截圖人工確認、U6 peek 畫面 | DEFERRED | 不要宣稱畫面已看過 |

## 2. 修繕（F-items）

證據欄貼實際輸出。F1、F2 在 commit `28efc93`（同一 commit）。

| ID | 內容 | 狀態 | 證據 |
|---|---|---|---|
| F1 | E47：result 的 dispatch 不符 → `needs_user(exit_without_result)`，不再無限重派 | DONE | 舊程式（`b5503a3`）跑 `node --test my-orca/f1f2.test.mjs`：`✖ F1: a result for another dispatch (E47) stops with exit_without_result, no re-dispatch`、`ℹ tests 2 / ℹ pass 0 / ℹ fail 2`。修後：`node --test my-orca` `ℹ tests 36 / ℹ pass 36 / ℹ fail 0`；`node --test mods/orca-workflow` `ℹ tests 8 / ℹ pass 8 / ℹ fail 0`。探針：`E47 launches: 1`（修前 7）。 |
| F2 | Resume 後 +2 次嘗試（M9） | DONE | 同上舊程式：`✖ F2: Resume after task_failed grants +2 attempts (M9)`。修後同上綠燈。探針：`launchesInResume: 2`、`resume_extra: 2`、`attempts: 4`（修前 1、null、3）。 |
| F3 | M7：上限到了也先 kill 再回 `unsettled` | TODO | |
| F4 | 每次 kill 先核對標籤並寫 `kill` 事件（`killOwned`） | TODO | |
| F5 | 記 `planning.core_id` | TODO | |
| F6 | `stage_head` 單一化（只寫紅燈測試） | TODO（Phase C） | |
| F7 | 開機掃描清殘留 worker | TODO（Phase C，依賴 F4） | |
| F8 | hc 失敗退避（只寫紅燈測試） | TODO（Phase C） | |
| F9 | 不自動改綁 core | TODO（Phase C） | |
| F10–F18 | Tuning 燈、缺圖示、錯碼、`--accept-head`、fake-e2e 禁用清單、UI 通知、死碼、SKILL checklist、真 git happy path | TODO（Phase C） | |
