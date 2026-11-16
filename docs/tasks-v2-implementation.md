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
| I-04 | Runner R-A..R-H：派發、等待、M7、kill + M14、驗收、Tuning/rework、恢復對帳 | PARTIAL | F1–F9 完成（F9 照 E12）。Resume 在 identity 停止後的行為待 owner 決定，見下方「待 owner 決定」 |
| I-05 | `start / run / stop / status / config set`、M13 core 斷言 | PARTIAL | 自動改綁 core 待 F9 |
| I-06 | Planning tab 關閉，預設 `close_planning_tab=false` | PARTIAL | F5 完成：init 記 `core_id`、已關閉不重關。真 tab.close 行為未驗證（I-16 OWNER GATED），仍不要在真 repo 啟用 |
| I-07 | `fake-agent.sh` 與整合測試（`fake-e2e.mjs` 8 種模式） | DONE（未獨立驗證） | 實作者自述 8 種全 PASS；review 沒有跑它 |
| I-08 | `herdr-planning` skill | PARTIAL | 缺 8.2.3 七條 checklist，待 F17 |
| I-09 | `orca-workflow` UI：四燈、inspector、Peek/Resume/Stop | PARTIAL | Tuning 燈誤亮（F10）、缺圖示（F11）、跨 worktree 誤通知（F15） |
| I-10 | `layouts/orca.json` 四燈 block | DONE | |
| I-11 | 單元測試 | DONE | `my-orca` 42、`mods/orca-workflow` 8 |
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
| F3 | M7：上限到了也先 kill、掃描，才回 `unsettled` | DONE | commit `7be456d`。舊程式（`e279a4e`）跑 `node --test my-orca/f3.test.mjs`：`✖ F3: wait cap with a still-moving HEAD kills the worker, then reports unsettled`、`AssertionError: worker must be killed before unsettled (kills: 0)`、`ℹ tests 1 / ℹ pass 0 / ℹ fail 1`。修後同檔 `ℹ pass 1 / ℹ fail 0`；全套見下方 F5 列。測試的假 git 在 worker 啟動前 HEAD 與 run 相符（否則 run 先因 `tree_changed` 停在派發前，測不到 kill）。 |
| F4 | 每次 kill 先核對標籤並寫 `kill` 事件（`killOwned`） | DONE | commit `1da6eb8`。舊程式跑 `node --test my-orca/f4.test.mjs` 前兩個 case：`✖ F4: Resume does not kill a terminal whose dispatch label is someone else's`（`actual: 1, expected: 0`，舊程式在標籤不符時照樣 kill）、`✖ F4: Resume kills a terminal whose labels match, and records a kill event`（`actual: undefined, expected: true`，沒有 kill 事件）。修後兩者綠。`grep -n "hc.kill(" my-orca/my-orca.mjs` 只剩 `killOwned` 內一處（`883`）。`grep -n unsettled` 另有 `awaitWorker` 內的 `"unexpected wait state"` 一行，不在 `settleAndKill`，與 F3 無關。 |
| F5 | 記 `planning.core_id`；已關閉的 Planning tab 不重關 | DONE | commit `aa44f28`。**紅燈原因與 handoff 描述不同**：handoff 的 fixture 自己填了 `core_id`，case 1 在舊程式會是綠的，所以測試改成用 `planningFromTerminal` 的輸出餵 `closePlanningTab`，並為此把 `planningFromTerminal` 加上 `export`（`cmdInit` 會呼叫真的 hc，單元測試碰不到）。舊程式：`TypeError: orca.planningFromTerminal is not a function`（2 個 case）、`✖ F5: an already-closed Planning tab is not closed again`（`actual: 2, expected: 0`）。另用探針確認舊 init 的 planning 形狀（無 `core_id`）餵 `closePlanningTab` → `closePlanningTab -> skipped:gone`（handoff 描述的原因；探針見下方）。**這與驗收第 3 項字面要求（紅燈原因是 `skipped:gone`）不同；owner 已接受此偏離。**修後 `node --test my-orca`：`ℹ tests 42 / ℹ pass 42 / ℹ fail 0`；`node --test mods/orca-workflow`：`ℹ tests 8 / ℹ pass 8 / ℹ fail 0`（`aa44f28` 上）。 |
| F6 | `stage_head` 單一化 | DONE | owner 授權後由我完成。單一來源 = `state.repo.head`（最後一次接受的 head）：`acceptDev`、`rejectTask`、reconcile、`--accept-head` 不再傳過期的 `repo.stage_head`；`pushCheck` 拿掉該 fallback；`repo.stage_head` 與 `dispatch.stage_head` 的寫入已刪（舊 state.json 裡的欄位無害）。`state.stage_head`（Tuning 的 review 比對）保留。**`--accept-head` 取嚴格版**：base 為 `repo.head`，使用者 amend 過最後一個被接受的 commit 就接受不了（符合 V48）。測試改寫為 `pushCheck(state, info, git)` 不帶第 4 參數，舊程式（有 `repo.stage_head` fallback）下 `actual: true / expected: false`；修後綠。 |
| F7 | 開機掃描清殘留 worker | DONE | commit `5610e3f`。舊程式跑 `node --test my-orca/f7.test.mjs`：`✖ F7: a live worker from a finished attempt is killed, then removed`、實際 `[]`（沒 kill 也沒 rm）；第二個 case（dispatch 不在 state 的 worker：停下、不動它）舊程式就綠，當作回歸護欄。修後 `ℹ tests 2 / ℹ pass 2 / ℹ fail 0`。 |
| F8 | hc 失敗退避 | DONE | owner 授權後由我完成，採台帳建議 (a)：新增 `hcRetry`（沿用 `waitForResult` 的做法，每 `poll_s` 重試、滿 `hc_retry_min` 後 `{ stop, noStateChange }` 安靜停下，不改 state、再 start 即重試），用在 `dispatchTask`、`scanWorkers`、reconcile 的 `hc.list`。`f8.test.mjs` 去掉 `todo` 並用假時鐘改寫成 2 個 case（一直失敗不崩潰且 state 不變；失敗兩次後恢復並走到派發）。舊程式（`6c5cc7d`）兩個都 `✖`；修後 `ℹ pass 2 / ℹ fail 0`。 |
| F9 | core 改綁 | DONE（照 E12） | owner 決定保留 E12。把 `start`／`run` 兩處重複的改綁邏輯收成 `rebindCore`，新增 `my-orca/e12.test.mjs`（3 個 case）。`node --test my-orca`：`ℹ tests 50 / ℹ pass 48 / ℹ fail 0 / ℹ todo 2`。不拒絕、不改 E12。 |
| FIX-1 | 審查發現：`handleResult` 的 `const result` 被重新賦值（`cebc2dd` 造成） | DONE | commit `3298581`。`cebc2dd`（owner 在 Phase B 前的 commit）把 `let result` 改成 `const result`，但 bad-JSON 重讀迴圈仍賦值，結果檔寫到一半時 Runner 會 `TypeError` 崩潰，既有測試沒走到這條路。新增 `my-orca/badjson.test.mjs`：舊程式 `✖ …`、`Actual message: "Assignment to constant variable."`；修後 `node --test my-orca`：`ℹ tests 47 / ℹ pass 45 / ℹ fail 0 / ℹ todo 2`。 |
| FIX-2 | 審查（checker）發現：真的 `hc.list` 在 `hc ls` 失敗時回 `[]` | DONE | `makeHc` 的 `list` 不看 exit code，所以 F8 的 `hcRetry` 在正式環境永遠不會觸發，而且 core 連不上時 reconcile 會把 worker 當成已消失（記一次 `exit_without_result`、清掉 dispatch、留下孤兒 worker），`--accept-head` 的「先停 Runner」檢查也會悄悄放行。修：`hc ls` 非 0 就丟 `HcError`。新增 `my-orca/hclist.test.mjs`：舊程式 `✖ hc.list throws HcError when \`hc ls\` fails`；修後 `ℹ tests 55 / ℹ pass 55 / ℹ fail 0 / ℹ todo 0`。|
| FIX-3 | `runTuning` 少了 `delivered.hcFailure` 分支 | DONE | `waitDelivery` 因 `hc.get` 丟 `HcError` 回 `{ hcFailure }` 時，`runTuning` 會落到 `needsUser(undefined)`。補上與 `awaitWorker` 相同的一行（安靜停下、state 不變）。`my-orca/tuning-hc.test.mjs`：舊程式 `actual: 'needs_user'`（`✖`）；修後綠。全套 `my-orca` 56 tests / 0 fail。附帶發現（未改）：`runTuning` 在 launch 後有一個沒有保護的 `ctx.hc.get`，真的 `get` 失敗時回 `null` 不會丟，所以目前不會崩。 |
| F10 | Tuning 燈 development 期間不亮 | DONE | commit `6c5cc7d`。`model.js` 與 `my-orca.mjs` 的 `lights` 兩份都改成 `state?.stage === "tuning"`；`model.test.js` 該 case 期望改為 `pending`（handoff 唯一允許）。`node --test mods/orca-workflow`：`ℹ pass 8 / ℹ fail 0`。 |
| F11 | 缺圖示 | DONE | 同 commit。待驗收列改畫空心圈。`herdr-app check mods/orca-workflow`：`check passed: mods/orca-workflow`（該指令會產生 `gpui-kit.d.ts`、`jsconfig.json`，已刪除未提交）。**畫面未看過，I-17 仍 DEFERRED。** |
| F12 | `runTuning` 錯碼 | DONE | 同 commit。改用 `checked.code`。沒有單獨的測試（一行改動，`dispatchCheck` 的碼本身已有測試）。 |
| F13 | `--accept-head` 不可在 Runner 運行中 | DONE | 同 commit。`startRunner` 先查 `orca.role=runner` 的 live terminal，有就拒絕。`startRunner` 未 export，沒有單元測試。 |
| F14 | `fake-e2e.mjs` 禁用清單 | DONE（未執行） | 同 commit。開頭用不帶 `HC_SESSION` 的 env 讀 owner core id，放進 `MY_ORCA_FORBID_CORE_IDS`；專屬 core 與它相同就 abort。**`cleanup()` 在確認專屬 core 不同於 owner 的 core 之前不碰 hc**（`ownCoreVerified`；abort 後 `.finally` 仍會呼叫 `cleanup()`，它會 `hc rm` 與 `hc server stop`，可能動到 owner 的 core）。只跑了 `node --check`，**沒有執行**。 |
| F15 | UI 跨 worktree 誤通知 | DONE | 同 commit。`load()` 在 `this.wtId = wtId` 之前換 worktree 就重設 `lastStatus`。無測試（UI）。 |
| F16 | 死碼 | DONE | 同 commit。刪 `escapeRe`、`RunnerExit`、`cmdInitCheck`、`lastChanged`、`hc.json`、`makeRunnerContext` 的 `exits`；刪前 `grep -rn` 確認無其他引用；`node --check` 通過，全套綠。 |
| F17 | SKILL.md Constraints checklist | DONE | 同 commit。Step 4 之前加一節，§8.2.3 七條原文照抄，要求逐條確認後才可 `init`。 |
| F18 | 真 git happy path | DONE | commit `0756e1f`。`my-orca/f18.test.mjs`：臨時 repo + bare upstream，假 worker 真的 commit／push；push 的 → `accepted` 且 `repo.head` 為新 HEAD；只 commit 不 push → `needs_user(unpushed)`。`ℹ pass 2 / ℹ fail 0`。 |

## 3. 待 owner 決定

**F4b（未套用）：`resumeState` 在 `killOwned` 要求停止（identity／core_mismatch）後該回什麼？**

handoff 寫 `return { ok: true }`，F4 照做。副作用：runLoop 接著跑 reconcile，任務已有 1 次嘗試時會再記一次 `exit_without_result`，把 `identity` 覆寫成 `task_failed`（`core_mismatch` 舊路徑同病）。試過 `return { ok: false, detail }`（讓 runLoop 在 "still needs the user" 就停），但 `state.dispatch` 永遠留著，每次 Resume 都再撞同一個 identity，無法自行脫困，所以**沒有套用**（commit 已撤掉）。兩種行為對照（探針：同一個假 hc，Resume 兩次）：

```
ok:false  resume #1: needs_user=identity   dispatch=d1   attempts=1 status=needs_user
          resume #2: needs_user=identity   dispatch=d1   attempts=1 status=needs_user   ← 卡死
ok:true   resume #1: needs_user=task_failed dispatch=null attempts=2 status=needs_user   ← 代碼被覆寫
          resume #2: needs_user=undefined  dispatch=086febef attempts=2 status=working   ← 能前進
```

要的行為大概是：identity 停止時**保留 `identity` 代碼**，但 Resume 要有辦法脫困（例如 Resume 時放棄追蹤那個不屬於我們的 terminal、清 dispatch，但不殺它）。這屬規格決策，沒有自己決定。

**F5 探針**（在 `aa44f28` 之前的 `planningFromTerminal` 形狀上重現 `skipped:gone`）：

```js
import * as orca from "./my-orca/my-orca.mjs";
const labels = { "herdr.tab": "tab9", "herdr.space": "sp1" };
const planning = { address: "t1", created_ms: 1, tab: "tab9", space: "sp1", agent_pid: 42, turn: 0, closed: null }; // 舊形狀，無 core_id
const hc = { coreId: () => "c1", get: () => ({ address: "t1", state: "live", status: { state: "idle" }, turn: 1, created_ms: 1, labels, foreground: { pid: 42 } }) };
const config = orca.resolveConfig({ close_planning_tab: true }).config;
const ctx = orca.makeRunnerContext({ stateDir: process.env.TMPDIR, state: { run_id: "r1", planning }, hc, git: {}, config, event: async () => {}, sleep: async () => {}, clock: () => 0 });
console.log("closePlanningTab ->", await orca.closePlanningTab(ctx, { app: () => ({ status: 0, stdout: "" }), wait: false }));
// 舊程式與新程式都印 skipped:gone（因為 fixture 沒 core_id）；新程式的 init 已不會產生這種形狀
```

**範圍注意**：驗收第 1 項的 `e279a4e..HEAD` 另含三個不屬於 Phase B 的 commit（`cebc2dd` 動 `my-orca.mjs`、`3375f09` 動 docs、`dd71296` 動 `layouts/orca.json`）。Phase B 實際範圍是 `dd71296..HEAD`。

**F6、F8：** 已由我完成並採用建議值，見上表（`--accept-head` 取嚴格版；退避取 (a)）。若要改成寬鬆版／立即 `needs_user`，是小改動。

**F9：** 已決定照 E12，見上表。

**F7 備註（不擋）：** `scanWorkers` 的 `created_ms` 來自列表本身，所以 `killOwned` 的 `created_ms` 檢查在這條路徑永遠通過；標籤檢查仍有效。`f7.test.mjs` 第二個 case 只斷言沒有 kill／rm，沒斷言 `needs_user.code === "unknown_worker"`，護欄偏弱。
