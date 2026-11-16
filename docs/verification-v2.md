# Spec v2 實作驗證標準（給下一個 model）

日期：2026-11-16
驗證對象：`docs/spec-v2-converged.md` 的 v1（`my-orca`、`herdr-planning`、`orca-workflow`）
實作位置：`my-orca/`、`skills/herdr-planning/`、`mods/orca-workflow/`、`layouts/orca.json`
驗證者：獨立 model。不要預設實作者的說法正確；以下每一項都要自己跑、自己看輸出。

## 0. 先讀什麼

1. `docs/spec-v2-converged.md` 的 2、3、4、5、8 節。這是唯一規格。
2. `docs/tasks-v2-implementation.md` 的狀態與證據；把宣稱當作待驗證，不是結論。
3. 本檔。每一條都附可重跑指令或明確的人工觀察。

## 1. 驗證的邊界（先同意再開工）

**可以做的**

- 讀專案內所有檔案。
- 跑 `node --test`、`node --check`、`herdr-app check`、`git diff --check`。
- 跑 `node my-orca/fake-e2e.mjs`。它會用**專屬 core**（`HC_SESSION` + 暫存 XDG）與本機 bare remote；正常結束會自己停 core、刪暫存資料夾。
- 在 `/tmp` 建立拋棄式 repo 測 CLI。
- 用 `hc` 的唯讀指令（`ls`、`get`、`read`、`server status`）觀察，但**只能觀察專屬 core**。

**不可以做的**

- 不要對 owner 的 core 執行 `kill`、`rm`、`server stop/restart`、`update`。
- 不要啟動真的 opencode／claude／codex session，不要花 owner 的額度；唯一例外是 owner 明確在場要求跑第 7 步真 E2E。
- 不要讀出、貼出或寫入任何 API key（包含 `~/.config/opencode/` 下的設定）。
- 不要修改 owner 的 `programs.json`、`settings.json`、`keys.json`、`~/.config/herdr-core/`。
- 不要為了讓測試過而改測試、放寬 assertion、吞錯誤或加 lint/type 抑制。發現實作錯就修實作，並回報改了什麼。

**安全開專屬 core 的形狀**（V36、V60；socket 路徑上限 103 bytes，路徑要短）

```sh
d=/tmp/mo-verify-$$
mkdir -p "$d/c" "$d/s" "$d/d"
HC_SESSION=mo-verify-$$ XDG_CONFIG_HOME="$d/c" XDG_STATE_HOME="$d/s" XDG_DATA_HOME="$d/d" hc server status --json
# ... 所有 hc 指令都帶同一組 HC_SESSION/XDG ...
HC_SESSION=mo-verify-$$ XDG_CONFIG_HOME="$d/c" XDG_STATE_HOME="$d/s" XDG_DATA_HOME="$d/d" hc server stop
rm -rf "$d"
```

在跑任何東西之前，先記下 owner core 的 `hc ls --json`（不帶 `HC_SESSION`）與
`hc server status --json` 的 `core.id`。整輪驗證結束再比一次；owner 的 live terminal
清單與 core id 必須不變。

## 2. 必跑的自動檢查（全部要綠）

| # | 指令 | 通過標準 | 這在證明什麼 |
|---|---|---|---|
| A1 | `node --check my-orca/my-orca.mjs` | exit 0 | 單檔 Runner 可解析 |
| A2 | `node --test my-orca` | 34 tests、0 fail | 純邏輯、M13–M15、原子寫入、profile、驗證、fake-core happy path |
| A3 | `node --test mods/orca-workflow` | 8 tests、0 fail | 四燈與 inspector 的純資料層 |
| A4 | `herdr-app check mods/orca-workflow` | `check passed` | mod 的 API／語法檢查 |
| A5 | `node --check mods/orca-workflow/main.js` | exit 0 | UI 檔可解析 |
| A6 | `node -e 'JSON.parse(require("fs").readFileSync("layouts/orca.json","utf8"))'` | exit 0 | layout 是合法 JSON |
| A7 | `git diff --check` | 無輸出 | 沒有空白錯誤 |
| A8 | `node my-orca/fake-e2e.mjs` | 每個 `PASS`，最後 `All fake integration checks passed` | 專屬 core 上 init → Runner → dev → Tuning → ready，含 commit/push、kill 稽核、無 live worker |
| A9 | 下列 8 個 fake 模式各跑一次 | 每個 `PASS`，exit 0 | 失敗路徑與 ack／rework／direct fix |

A8 的 `report` 加上下列 7 個模式，共 8 個（都在專屬 core 上；用完自己清；實作時 8 個都已跑過）：

```sh
ORCA_FAKE_MODE=report          node my-orca/fake-e2e.mjs   # 完整 happy path（= A8）
ORCA_FAKE_MODE=commit-nopush node my-orca/fake-e2e.mjs   # needs_user/unpushed
ORCA_FAKE_MODE=noresult      node my-orca/fake-e2e.mjs   # needs_user/exit_without_result
ORCA_FAKE_MODE=block         node my-orca/fake-e2e.mjs   # needs_user/blocked
ORCA_FAKE_MODE=failtest      node my-orca/fake-e2e.mjs   # needs_user/task_failed（兩次嘗試）
ORCA_FAKE_MODE=noack         node my-orca/fake-e2e.mjs   # 完成（缺 ack 不算失敗）
ORCA_FAKE_VERDICT=rework-once node my-orca/fake-e2e.mjs  # 完成，cycles=1，R1-01 accepted
ORCA_FAKE_MODE=fix-once      node my-orca/fake-e2e.mjs   # 完成，cycles=1，stale review + pass
```

A8 失敗時，先看它印出的 state 與 events，再判斷是實作錯、環境錯（`herdr-app` 沒開、
`opencode` 不在 PATH）或測試 harness 錯。不要直接重跑掩蓋。

A8 會建立並刪除 `/tmp/mo-fake-<pid>`；若它中途被殺，請手動用同一組 `HC_SESSION` 停掉
專屬 core，再刪資料夾。**不要**用 owner 的 core 清。

## 3. 靜態／原始碼檢查（逐條看，附行號）

| # | 檢查 | 通過標準 |
|---|---|---|
| S1 | 作廢的試作碼已移除 | `grep -R "isRunnable\\|preflight\\|RISKY" my-orca` 沒有結果（8.2.4） |
| S2 | Runner 不 commit／push | `my-orca.mjs` 的 Runner 路徑（`runLoop` 及其呼叫）沒有 `git commit`、`git push`、`reset`、`stash`、`checkout`、`clean`；唯一的 push 在 `init` 的 `push -u` |
| S3 | 破壞性 hc 都過 M13 | `cmdRun` 建 `makeHc({expectCoreId: state.core_id})`；`settleAndKill` 的 kill 失敗若是 `CoreGuardError` 會 `needs_user`（`core_mismatch`），不會繼續驗收；kill 前核對 `orca.run`／`orca.dispatch`／`orca.role`／`created_ms`，`hc get` 取不到 terminal 時不對該 address 下 kill；`removeWorker` 同樣核對身分，不符只記 `rm_skipped`；`cmdStop` 先比 core id |
| S4 | state 不含 secrets／argv／畫面 | `state.profile` 只有 `cli/model/effort`；`events.jsonl` 沒有環境或完整 argv；`logs/` 才存畫面且截到 64 KiB |
| S5 | 原子寫入與第二寫入者 | `writeState` 是 tmp + fsync + rename，`expectedUpdated` 不同時丟 `StaleStateError`；測試 A2 有覆蓋 |
| S6 | worker 環境 | `workerEnvPrefix` 拿掉 `HC_TERMINAL_ID`、`HC_SCOPE`、三個 `XDG_*`，保留 `HC_SESSION`，加 `GIT_TERMINAL_PROMPT=0`、`ORCA_DISPATCH`；Tuning 另拿掉 `CLAUDE_CODE_*` |
| S7 | CLI 表逐字相符 | `profileArgv` 的 claude／codex argv 與 4.5 表相同；dev 是 `opencode --auto --standalone --prompt`；A2 有單元測試 |
| S8 | 設定範圍 | `CONFIG_RULES` 的 9 個鍵與 4.9 相同；預設 `close_planning_tab=false`；A2 有測試 |
| S9 | 預設分支拒絕 | `cmdInit` 在 `git push -u` **之前**判斷 upstream／branch 是否為 `origin/HEAD`（或未知時的 `main`/`master`），拒絕時不應已 push |
| S10 | planning tab 預設不關 | `DEFAULT_CONFIG.close_planning_tab === false`；A8 的 state 顯示 `skipped:disabled` |

## 4. 行為驗證（依規格章節）

以下每一列都要有「怎麼做／看哪裡／通過標準」。A2 的測試名稱可直接對應；沒被 A2
覆蓋的，用拋棄式 repo 加專屬 core 手動做，或明確標 `NOT TESTED`。

### 4.1 init（4.4、8.2.2、D14、D15、S21、E31–E36）

| # | 情境 | 通過標準 | 方式 |
|---|---|---|---|
| I1 | 合格 handoff/tasks | exit 0；`handoff ok: N task(s)…`；state 目錄不存在（`--check`） | A2 `handoff needs all ten…`、`tasks.json validates…`；`init --check` |
| I2 | 缺章節、缺 test、重複 id、空清單、空測試、循環、manual-only acceptance | exit 1，訊息指出哪個 task／章節／acceptance；不寫 state | A2；也可用 `/tmp` 樣本實跑 |
| I3 | secrets（`sk-`、`AKIA`、`ghp_`、PRIVATE KEY） | exit 1；只報檔名與行號；不印命中的字串 | A2；實跑時自己看輸出 |
| I4 | detached HEAD／bare repo／非 git | exit 1 | `/tmp` repo 實跑 |
| I5 | 沒有 upstream | `init` 先 `git push -u origin <branch>`，再 `push --dry-run`；失敗回 `no_upstream`／`remote_unreachable`／`not_fast_forward`／`push_failed` | 拋棄式 repo + bare remote；A8 的「upstream created」 |
| I6 | upstream 是預設分支（main） | 拒絕，且不應先 push 到 main | 用 branch `main` 的 `/tmp` repo 實跑；看 remote 沒有新 commit |
| I7 | 開始時工作樹髒 | 不拒絕；state `dirty_at_start` 有檔名；第一個 stage 的 commit 含它 | A8 可在 init 前 touch 一個檔再跑，或手動 |
| I8 | `HC_TERMINAL_ID` 不存在／CLI 不是 claude/codex／argv 沒有 model | exit 1，訊息明確；`--model/--effort` 可補 | 在 host（非 hc terminal）跑 init；A2 profile tests |
| I9 | 沒有 `hc`／`opencode`／App | exit 3（環境），不寫 state | 用 PATH shim 或暫時的 `HERDR_APP_HOME` |
| I10 | 同 worktree 已有 `working`／`needs_user` run | 拒絕（D11） | 先 `--no-start` 造 state，再跑一次 |
| I11 | 舊 `completed` run | 整包移到 `archive/<wt-id>-<utc>`，再建新 run | 手動 |

### 4.2 Runner R-A 到 R-H（4.4、4.9、M6–M15）

| # | 規則 | 通過標準 | 方式 |
|---|---|---|---|
| R1 | R-A 意圖先行 | state 先有 `dispatch.phase=intent`，才有 terminal；terminal 名稱 `orca-d-<id>`；標籤 4 個 | A8 events：`intent` 在 `launched` 前；`hc get` 看標籤（A8 結束前） |
| R2 | 送達證據三選一 | ack、曾 `working`、`started:true` 任一即可；**缺 ack 不算失敗** | A2 `worker environment…`；A9 `noack` 已完成 |
| R3 | 120 秒無證據 | `needs_user`（`undelivered`），不重送，terminal 留著 | fake 的 `silent` 模式；人工把 `ack_timeout_s` 設小 |
| R4 | result 解析 | 大小 >256 KiB、JSON 壞、`dispatch` 不符 → 不接受 | A2 `runShell…`；手動塞壞 result |
| R5 | M7 靜止後才 kill | 看到 result 後先等 terminal 離開 working 或連續兩次 git 不變（上限 60 秒），再 kill；kill 後 M14 sweep | 程式碼 `settleAndKill`；A8 events 的 `kill`→`sweep`→`accepted` |
| R6 | R-C 驗收 | Runner 自己重跑 `test` exit 0；porcelain 空；branch 未變；新 HEAD 是紀錄 head 的後代且 commit ≥1；R-H 四項 push 檢查 | A8；A2 happy path；`commit-nopush` 應進 `needs_user(unpushed)` |
| R7 | 測試弄髒工作樹 | `rejected:test_dirtied_tree`，不是 accepted | 把 task 的 test 改成 `touch dirt`（非 ignore） |
| R8 | 兩次上限 | 同 task 被拒 2 次 → `needs_user(task_failed)`；Resume 只加 2 次 | A9 `failtest` 已跑到 `task_failed`；Resume 加成未測 |
| R9 | R-D | HEAD 移動、branch 切換、工作樹髒、ahead>0 → `needs_user`（`tree_changed`／`unpushed`），不自動 reset | A2 `dispatchCheck…`；手動在兩個 task 間改檔 |
| R10 | R-E pass | criteria 覆蓋全部 acceptance 且 pass；Runner 自己重跑每條 verify；clean；HEAD 未動；push 檢查 | A8；A2 happy path |
| R11 | R-E rework | `new_tasks` 1–10；id 由 Runner 指定 `R<cycle>-<nn>`；cycles+1；超過上限 `rework_exhausted` | A9 `rework-once`：cycles=1、R1-01 accepted；上限未測 |
| R12 | Tuning 直接修 | HEAD 在 Tuning 期間前進 → review stale、cycles+1、重新 Tuning；未 push → `needs_user(unpushed)` | A9 `fix-once`：cycles=1、stale review + pass |
| R13 | M13 | 任何 kill/rm 的 core id 不等於 state.core_id → 拒絕，`needs_user(core_mismatch)` | A2 M13 tests；`cmdRun` 的 guard |
| R14 | M14 | kill 後掃 `ORCA_DISPATCH`，4 輪 TERM→KILL；掃不乾淨 → `needs_user(sweep_incomplete)` | A2 M14 tests；A8 的 `sweep` 事件 |
| R15 | R-F 恢復 | live worker 認養；result 存在 → 驗收；乾淨且 HEAD 未動 → 重派；髒／HEAD 動了 → `partial_changes`／`unpushed`；`--accept-head` 接受新 baseline | 程式碼 `reconcile`／`resumeState`；A2 happy path 不覆蓋重啟，需人工用 `kill -9` Runner 或專屬 core 擴充 |
| R16 | 名稱鎖 | 第二個 `my-orca start` 回 0（`name_taken`），不產生第二個 Runner | 專屬 core 上同時跑兩次；或看 `startRunner` |
| R17 | stop／Resume | `stop` 不改 state；Resume 先看 result、再 kill 保留的 worker、再重派；狀態 `working` | 程式碼；專屬 core 手動 |

### 4.3 UI（4.8、D8、D9、AT-15–18）

| # | 檢查 | 通過標準 | 方式 |
|---|---|---|---|
| U1 | 四燈資料 | 四盞燈、固定顏色、accepted/total；Planning 1/1；Ready 0/1 或 1/1 | A3 |
| U2 | 狀態不只靠顏色 | complete check、working pulse、pending ring、needs_user triangle、failed alert | `main.js` 的 `lamp`；`herdr-app check` |
| U3 | 空狀態 | 沒有 run 顯示「No workflow in this worktree · run /herdr-planning」 | A3；實際開 inspector 看 |
| U4 | Inspector | task／acceptance／attempts／Peek／Resume／Stop／rework 上限 | `herdr-app check`；實際看畫面（人） |
| U5 | 只寫 config | UI 用 `writeTextFile(..., expected)`，不寫 state；1–9 整數；stale 時重讀 | 程式碼 `saveRework`；A3；實際輸入 0/10/非數字 |
| U6 | 通知 | 只在 status 轉 `needs_user`／`completed` 時通知一次，以 `updated` 去重 | 程式碼 `notifyTransition`；實際看 |
| U7 | watchFolder／timer | 外部 tmp+rename 會觸發；失敗時 5 秒 timer 仍在 | U9／U10 未驗；本輪以 timer 為保底 |
| U8 | Peek | 背景 worker 可 Peek，不新增 tab | U6 未驗；需人看畫面 |

### 4.4 邊界情況（第 5 節）

至少抽驗這些；沒驗的要在報告標 `NOT TESTED`：

- S1（沒有 core）、S4（handoff 不完整）、S6（不理 prompt）、S7（blocked）、S9（結束沒 result）、S10（測試失敗）、S13（雙 start）、S14（address 指向別的 terminal 不 kill）、S15（切 branch）、S17（rework 用完）、S21（沒有 upstream／dry-run 失敗）。
- E3（兩個 init 搶同一 worktree）、E4（worktree move）、E5（worktree 刪除）、E7（同 repo 兩個 worktree）、E14（Planning tab 先被關）、E23（blocked tasks）、E25（2 MiB result）、E28（test 卡住）、E31（detached/bare）、E38（UI 讀到壞 JSON）、E41–E43（secrets 不進 state/events）、E46（交結果後繼續改檔）、E47（別的 dispatch 的 result）、E51（不可寫）、E52（刪狀態資料夾）、E58（stop 在 worker 執行中）。

## 5. AT 對照表（用規格 8.1 的證明方式）

| AT | 本輪可宣稱 | 證據 | 仍需什麼 |
|---|---|---|---|
| 01 profile | PASS | A2 profile tests | owner 各開一次 claude/codex（U11/U12） |
| 02 handoff | PASS | A2 handoff/tasks | — |
| 03 Planning tab | NOT TESTED（預設關閉） | 程式碼 `closePlanningTab`；A8 `skipped:disabled` | owner 開測試 tab 跑 (a)(b)(c)；最後 tab 需人 |
| 04 不進視窗 | PASS（機制） | A8 無新增 tab；fake worker 是 `--no-parent` | 真 opencode 的 E2E 那一半 |
| 05 dispatch | PASS | A8、A2 happy path | — |
| 06 result/ack | PASS（fake） | A8；A2 happy path | 真 opencode 的遵從率 3/3 |
| 07 one worker | PASS（機制） | A8；R-A 檢查 | — |
| 08 verification | PASS（fake） | A8；A2 happy path | 真 opencode 那一半 |
| 09 Tuning argv | PASS | A2 `profile argv…` | 真的 Tuning terminal `hc get` |
| 10 independent acceptance | NOT TESTED | — | 唯一一次真 E2E |
| 11 rework | PASS（fake） | A2 M15；A9 `rework-once` cycles=1、R1-01 accepted | 真 E2E 的 1 輪 rework |
| 12 rework limit | PASS（單元） | A2；程式碼 `applyRework` | fake/專屬 core 做到上限 |
| 13 direct fix | PASS（fake） | A9 `fix-once`：cycles=1、stale review + pass | 真 E2E 一次 |
| 14 ready gate | PASS（fake） | A8；A2 happy path | 真 E2E |
| 15–18 UI | PARTIAL | A3、`herdr-app check` | 人看截圖、實際按 Peek/Resume/Stop |
| 19 one worker | PASS（機制） | R-A；A8 | — |
| 20 two worktrees | NOT TESTED | — | 專屬 core 兩個 worktree |
| 21 blocked | PASS（fake） | A9 `block`；V72 | 真 opencode 的延遲量測 |
| 22 user terminals | PASS（fake） | A8 前後無新 tab | 真 E2E 的完整比對 |
| 23 every stage pushed | PASS（fake） | A8 remote log、ahead 0 | 真 E2E |

**不要**把「fake 通過」寫成「真 opencode 通過」。AT-10 與 AT-04/06/08/09/11/22 的「真
opencode 那一半」只有唯一一次真 E2E 能證明。

## 6. 人工／owner 才能做的（本輪不要求）

1. 真 E2E（8.2.5）：3 個 dev task + 1 條故意不過的 acceptance + 本機 bare remote +
   專屬 core + 真實 opencode 額度。需要 owner 同意時間。
2. AT-03 (b)：最後一個 tab、多 pane、`tab.close` 確認框。需要 owner 在場開測試 tab。
3. U6：Peek 在畫面上真的顯示背景 terminal；U9／U10：`writeTextFile`、`watchFolder`。
4. U11／U12：owner 各開一次 claude 與 codex，確認 `/herdr-planning` 與 `foreground.argv`。
5. U14：真 model 的 ack/result 遵從率（E2E 量 3/3）。
6. 真的沒有 pty 的 git 憑證行為；pre-push hook 失敗。

## 7. 判定與回報格式

請用這份模板回報（繁體中文台灣）：

```md
# Verification report
- 日期／model／Node／hc／herdr-app：
- 分支／commit：
- Owner core id 前後是否相同：
- A1–A8：逐項 PASS/FAIL（附指令與關鍵輸出）
- S1–S10：PASS/FAIL/NOT APPLICABLE（附檔案:行號）
- 行為表 I/R/U：每一列 PASS/FAIL/NOT TESTED，附證據
- AT 表：PASS/FAIL/NOT TESTED
- 發現的問題：嚴重度／重現步驟／預期／實際／修正建議
- 未驗證與限制：
- 結論：可接受 / 有條件接受（列條件）/ 不可接受
```

判定規則：

- A1–A8 任一 FAIL，除非是環境（`herdr-app` 沒開、`opencode` 不在 PATH）且已證明，
  否則結論不可為「可接受」。
- 行為表任何「會誤判成功」的 FAIL（R5–R7、R10、R13、R14、U5）一律不可接受，即使
  其他全綠。
- 「NOT TESTED」不是 PASS；不要用「應該可以」補。
- 若發現規格本身矛盾，先引用 `docs/spec-v2-converged.md` 的章節與原文，分開記「實作
  偏離」與「規格待決」，不要把兩者混成一個 bug。

## 8. 失敗分類（8.2.4）

每個 FAIL 標一類：

- `environment`：缺少 CLI／App 沒開／專屬 core 起不來／remote 不可達。
- `policy`：Runner 拒絕了規格要求它拒絕的東西，或驗收條件不成立。
- `model`：真 agent 沒照 dispatch 做（ack/result/commit）。
- `runner`：Runner 的狀態機、計時、恢復、清理、寫入有 bug。
- `inconclusive`：證據不足，不能判定。

不要用「換大 model 就過」當原因；先分類，再修。
