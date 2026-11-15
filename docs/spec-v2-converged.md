# Spec v2 收斂版（第二輪 CTO 收斂）

進度：已完成 2、3、4、5、6、7；未完成 1、8

日期：2026-11-16
分支：`worktree-workflow-stages-panel`
輸入：`docs/spec-v2.md`、`docs/spec-v2-review.md`、`docs/spec-v2-progress.md`

## 1. 結論與能否開工（哪些被卡住）

待補

## 2. AT-03 的處理（白話 + 精確規則 + 改寫後的 AT-03）

### 2.1 白話

原本的規格同時寫了兩句互相打架的話：「Planning 是 workflow 自己開的 session，做完要自動關掉」，以及「user 自己開的 terminal 絕對不能自動關」。但你已經決定 Planning 一定是你自己在看得到的 tab 裡啟動的，所以照原文不管關或不關都會違反其中一句，這一條測試怎麼做都不可能老實打勾。

解法是把規則改成一句可以檢查的話：**只有你用來跑 Planning 的那一個 tab，在交接文件檢查通過、進度存檔之後，由 Runner 關掉；只要它看起來還有別的用途就不關，只在面板留一行說明；你開的其他 terminal 永遠不碰。**

### 2.2 精確規則

**誰關**：只有 Runner（不含 AI 的那個程式）。Skill、agent、UI 都不關任何東西。

**何時關**：以下四件事都成立之後：
1. `my-orca init` 的 handoff 檢查全部通過；
2. `state.json` 已寫入磁碟（`stage: development`，並含 `planning` 紀錄）；
3. Runner 已啟動並持有 `orca-r-<wt-id>` 這個名稱（Runner 是 `--no-parent`，所以關 tab 不會連它一起殺掉，V21）；
4. Planning terminal 的狀態已離開 `working`（呼叫 `init` 的那一輪已結束）。Runner 每 10 秒 `hc get` 一次，最多等 120 秒；還在 `working` 就不關。

**用什麼識別**：`init` 執行時（在 Planning terminal 裡，`$HC_TERMINAL_ID` 就是它的 address）記下 `address`、`created_ms`、`labels["herdr.tab"]`、`labels["herdr.space"]`、`foreground.pid`、`turn`，以及當時的 core id（V10、V12）。

**關之前重新核對（任一條不成立就不關，並把原因寫進 `planning.closed`）**：

| # | 檢查 | 擋掉的情況 | `planning.closed` |
|---|---|---|---|
| a | 目前 core id 與紀錄相同；`hc get <address>` 存在且 `state: live` | core 換了、tab 已被 user 關掉 | `skipped:gone` |
| b | `created_ms` 與紀錄相同 | address 指到別的 terminal | `skipped:identity` |
| c | `herdr.tab`、`herdr.space` 標籤與紀錄相同 | terminal 被移到別的 tab | `skipped:moved` |
| d | `foreground.pid` 與紀錄相同 | agent 已退出，user 正在同一個 shell 做別的事 | `skipped:agent_exited` |
| e | `status.state` 是 `done` 或 `idle`，且 `turn` 等於紀錄值 + 1 | user 在 Planning 結束後又送了訊息（還在用這個 session） | `skipped:in_use` |
| f | `herdr-app ls` 裡該 tab 恰好只有這一個 terminal，且 `sub_agents` 是空的 | tab 有分割出來的其他 pane，或 Planning agent 自己起了子 agent | `skipped:other_work` |
| g | 該 space 還有別的 tab | 關掉最後一個 tab 會連 space 一起關、還會跳確認框（`AGENTS.md:563`） | `skipped:last_tab` |
| h | `herdr-app ls` 呼叫成功 | App 沒開，無法確認 f、g | `skipped:app_unavailable` |
| i | `config.json` 的 `close_planning_tab` 是 `true` | user 選擇不關；或功能尚未啟用（M4：U5 探針與 AT-03 (a)、(b) 通過之前，預設值是 `false`；通過之後預設改為 `true`） | `skipped:disabled` |

**怎麼關**：`herdr-app do tab.close --id <紀錄的 tab id>`（一定帶明確的 id，不用「目前聚焦的 tab」這個預設；不帶 `confirmed`）。之後 `hc get <address>` 應為 `finished` 或查無 → `planning.closed = "closed"`，寫一筆 `kill` 事件。指令失敗 → `skipped:close_failed`。

**不關不算錯**：任何 `skipped:*` 都不影響 workflow 繼續；inspector 顯示「Planning tab 保留：<原因>」。

**誠實列出的限制**：(1) 檢查與關閉之間有不到一秒的空窗，user 剛好在這瞬間開始打字的話，草稿會跟著 tab 消失；(2) `tab.close` 的實際效果本輪沒有實測（禁止新增 tab），見 U5，實作第 4 步要先跑那個探針；(3) 關掉 tab 之後 Planning 的對話就看不到了，交接內容以 `handoff.md` 為準。

### 2.3 改寫後的 AT-03（取代原文「Planning's workflow-owned session closes safely」）

> **AT-03 Planning tab 只在安全時被關閉。** 全部在拋棄式 repo、專用的測試 tab 進行。
>
> - **(a) 正常關閉**：`/herdr-planning` 完成且 handoff 通過後 150 秒內，該 tab 消失；`hc get <address>` 為 `finished`；`state.planning.closed == "closed"`；Runner 的 terminal 仍 `live`；其他 space 與 tab 的數量和 id 不變。
> - **(b) 不該關的五種情況各測一次**，tab 必須還在，且 `planning.closed` 是對應的值：tab 多了一個 pane（`skipped:other_work`）；Planning 結束後又送了一則訊息（`skipped:in_use`）；agent 已退出只剩 shell（`skipped:agent_exited`）；它是 space 唯一的 tab（`skipped:last_tab`）；`close_planning_tab=false`（`skipped:disabled`）。
> - **(c) handoff 檢查失敗**：tab 不關，`state.json` 不存在，Runner 沒有啟動。
> - **(d) 稽核**：整個 run 結束後，`events.jsonl` 裡每一筆 `kill` 事件的對象，要嘛帶 `orca.run=<本 run>` 標籤，要嘛就是 (a) 記錄的那一個 address + `created_ms`；沒有第三種。
>
> (a)、(b) 可以用「測試 tab 裡跑 `fake-agent.sh`」完成（不必真的跑 Planning），所以可重複、不花額度。(a) 需要 owner 同意在自己的視窗開一個測試 tab。

AT-22（「User-owned terminals … are preserved」）同步改寫為：「除了 AT-03 (a) 那一個 terminal 之外，run 前後 `hc ls --json` 中不帶 `orca.run` 標籤的 terminal 完全相同；run 前後 `git stash list` 相同，且 `base_head` 仍是 `HEAD` 的祖先。」

## 3. owner 還需決定的核心問題（最多 3 個）與已委派的問題（預設 + 規則）

### 3.1 需要 owner 決定的三件事

**Q1. opencode 用什麼旗標啟動？（卡住：dev 派發的那一行設定）**
決定 4 說「沿用 `programs.json` 的全權限參數」，但 `programs.json` 裡沒有 opencode（V27），沒有東西可沿用。
- **建議：`opencode --auto`**（「Auto-approve permissions that are not explicitly denied」，V25）；若前置測試 P1 顯示不加 `--standalone` 時 kill 不掉它的工具指令（U3），再加 `--standalone`。
- 理由：與決定 4 對 claude、codex 的立場一致；背景 session 沒人回答提問，不加 `--auto` 只會讓每個 task 卡到 60 分鐘上限。
- 你要知道的代價：opencode 互動模式沒有 `--model`（V25），dev 用的是你 opencode 設定檔的預設 model，workflow 無法逐次指定。

**Q2. 開始時 worktree 有還沒 commit 的變更怎麼辦？（卡住：`my-orca init` 與 Runner 的 git 規則）**
- **建議：直接拒絕**，訊息是「請先 commit 或 stash，再執行一次」。
- 理由：worker 是全權限、會自己 `git add` + commit。只有從乾淨的工作樹開始，之後每一個變更才分得出是 workflow 做的還是你做的；「規格 #20：unexpected partial modifications」與「不可覆蓋 user 既有變更」才有辦法用三個唯讀 git 指令檢查。允許髒的工作樹的話，你的未提交變更很可能被 worker 一起 commit 進去，而 Runner 沒有可靠的方法擋。
- 另一個選項（不建議）：允許，並記下當時的髒檔清單、要求 worker 不要碰。這只是寫在 prompt 裡的請求，無法強制。

**Q3. 四盞燈放在哪裡？（只卡住第 8 步的 UI，不卡 Runner；不回答就用建議值）**
- **建議 A：sidebar 最下面、設定列（`sidebar-footer`）的上方，新增一條 28px**。每盞燈是「圓點 + 短名稱（Plan / Dev / Tune / Ready）+ `07/12`」；sidebar 窄於 260px 時只留圓點與數字，名稱改成 tooltip。理由：打開 inspector 的 workflow 按鈕就在正下方；最底下的狀態列在窄視窗已經排滿用量資訊。代價：sidebar 收起來時看不到燈。
- 選項 B：最底下 24px 狀態列的左邊（把 `status` 那一列拆成兩格）。優點：sidebar 收起來也看得到、放得下完整名稱；代價：擠壓現有的用量顯示。

### 3.2 已委派給實作 subagent 的問題（附預設與必須遵守的規則）

第一輪的 8 個問題：1、2、3 已由 owner 拍板（決定 1、3、4）；4、5、6、7、8 處置如下，另加這一輪新出現的。

| # | 問題 | 預設 | 實作時必須遵守的規則 |
|---|---|---|---|
| D1 | （第一輪 Q4）opencode 不回報 7501 時怎麼辦 | 不需要選：完成判定一律看 result 檔（4.4 R-B） | Runner 本體不得依「有沒有回報」分支；差異只能出現在 4.5 的 CLI 設定表 |
| D2 | （第一輪 Q5）dev 階段的 model | opencode 設定檔的預設 model；inspector 顯示「opencode（config default）」 | 不得讀取或複製 `~/.config/opencode/` 內任何檔案的內容（裡面有 API key）；不得把 model 名稱寫死 |
| D3 | （第一輪 Q6）commit 慣例 | 每個 task 一個以上的 commit，訊息以 `orca(<task-id>): ` 開頭 | Runner 自己不 commit；交結果時工作樹必須乾淨；指示檔明寫「不得 push、不得切換 branch、不得改動其他 worktree、不得 amend 或 rebase 既有 commit」 |
| D4 | （第一輪 Q8）mod 命名 | 不新增 mod：四燈列是 `orca-workflow` 加 `props: {strip: true}` | 不得使用 `my-orca-status` 這個名稱（與既有的 `orca-status` 太像）；在 README 的已知偏離寫明 |
| D5 | 狀態資料夾與 ID | 4.3 的配置；`wt-id` = sha256(absolute git-dir) 前 12 碼；`run_id` = `<wt-id>-<UTC yyyymmddHHMMSS>`；dispatch id = 8 碼隨機 hex | 所有路徑先 `realpath`；不得用 repo 名稱或 branch 名稱當路徑的一部分；`state.json` 一律「寫暫存檔 → fsync → rename」 |
| D6 | 各種時間上限 | ack 120 秒；dev、tuning 各 60 分鐘；單一測試指令 15 分鐘；輪詢 10 秒；`hc` 失敗重試 5 分鐘 | 每一個等待都要有上限；逾時一律進 `needs_user`，既不是成功也不是失敗；用單調時鐘（`process.hrtime` / `performance.now`）計時，牆上時間只拿來顯示；數值放 `config.json` 並檢查範圍 |
| D7 | Planning 那盞燈的數字 | 閘門 `1/1`（handoff 檢查通過才有 run，所以一出現就是完成） | 不得用 agent 的 `done` / `idle` 增加任何計數 |
| D8 | UI 怎麼改 rework 上限 | UI 檢查是 1 到 9 的整數後 `writeTextFile(config.json, …, expected)`；Runner 讀取時再檢查一次 | UI 不得寫 `state.json`；`writeTextFile` 不能用（U9）就改 `fs/promises`；寫入被拒（`expected` 過期）要重讀再讓 user 重試 |
| D9 | `needs_user` 與 `ready_for_review` 的通知 | mod 偵測到 `state.json` 的 `status` 轉變時呼叫一次 `notify()` | 以 `state.updated` 去重，同一次轉變只通知一次；不自己播聲音 |
| D10 | 安裝位置 | skill：`~/.agents/skills/herdr-planning/` + 複製到 `~/.codex/skills/`；`my-orca`：repo 內 + `~/.local/bin` 的 symlink | 不得寫入 `~/.config/herdr-core/`；不得修改 `programs.json`、`settings.json`、`keys.json` |
| D11 | 封存 | 完成的 run 留在原地；同一個 worktree 下次 `init` 時整包搬到 `archive/` | 永不刪除任何 run 的資料；`init` 遇到 `status` 是 `working` 或 `needs_user` 的既有 run 要拒絕 |
| D12 | 單一 task 的嘗試次數 | 最多 2 次；第 2 次附上第 1 次的失敗輸出 | 沒有 user 介入不得有第 3 次；重派之前必須通過 4.4 R-D 的 git 檢查 |
| D13 | 每輪 rework 新增的 task 數 | 上限 10 個，ID 由 Runner 指定為 `R<cycle>-<nn>` | 超過上限進 `needs_user`（`rework_too_large`），不得截斷後繼續 |
| D14 | handoff 檢查的定義（AT-02） | `handoff.md` 含規格的 10 個章節標題；`tasks.json`：1 到 100 個 task，每個有唯一 `id`（`^[A-Z]+-\d+$`）、`title`、非空的 `test` 指令、`deps` 都指向存在的 id 且沒有循環；至少 1 條 acceptance，每條有 `verify` 指令或 `manual: true`，且至少 1 條有 `verify`（`ready_for_review` 不能只靠 AI 自己的判斷）；初始 task 的 id 不得以 `R<數字>-` 開頭（保留給 rework） | 檢查失敗時不得寫入任何狀態；錯誤訊息要指出是哪一個 task 或哪一個章節。M2：skill 在呼叫 `init` 之前必須把 task 的 id、標題、`test` 指令與 acceptance 的 `verify` 指令列給 user 並取得同意；`init` 拒絕空測試（`true`、`:`、`exit 0`、單純的 `echo`） |
| D15 | secrets | `init` 用幾個常見金鑰樣式（`sk-`、`AKIA`、`ghp_`、`-----BEGIN … PRIVATE KEY`）掃 `handoff.md`、`tasks.json`，命中就拒絕並只報行號 | `state.json`、`events.jsonl` 不得保存：完整 argv、環境變數、terminal 畫面；畫面只進 `logs/` 且截到 64 KiB；錯誤訊息不得印出命中的字串本身。這只是盡力而為的過濾，README 要寫明 |
| D16 | Runner 的輸出 | Runner 的 stdout 每個轉移印一行（時間、事件、task id）；`hc read orca-r-<wt-id>` 就是 log | 不印 prompt 內容、不印測試輸出全文（只印 exit code 與 `logs/` 路徑） |

## 4. 收斂後的 v1 範圍（做 / 延後）與 v1 面板的保留 / 改寫 / 刪除

### 4.1 一句話的核心

User 在自己的 tab 用 `/herdr-planning` 做完規劃；之後一個不含 AI 的小程式（Runner）用 opencode 一次做一個 task、做完交給原本那個 model 驗收、最多來回三次；四盞燈顯示進度。

### 4.2 元件（只有三個）

| 元件 | 內容 | 位置（預設） |
|---|---|---|
| `my-orca` | 單一 Node 檔、零相依。子指令：`init`（由 skill 呼叫）、`start`（啟動或恢復 Runner）、`run`（Runner 迴圈本體，只能在名為 `orca-r-<wt-id>` 的 hc terminal 內執行）、`stop`、`status [--json]`、`config set` | repo 的 `my-orca/my-orca.mjs`，symlink 到 `~/.local/bin/my-orca` |
| `herdr-planning` skill | 唯一的 skill。規劃 → 寫 `handoff.md` + `tasks.json` → 呼叫 `my-orca init` → 把 `init` 印出的 profile 念給 user | `~/.agents/skills/herdr-planning/`（claude 經 symlink 讀到），另複製到 `~/.codex/skills/` |
| `orca-workflow` mod | 同一個 mod 兩種畫法：`props().strip` 為真時畫四燈列，否則畫 inspector 對話框（沿用 `orca-chrome` 用 `props().footer` 分兩種畫法的既有做法） | `mods/orca-workflow/` |

Dev 與 Tuning **沒有** skill 也**沒有** hc template：它們的指示是 Runner 寫在狀態資料夾的 `dispatch/<dispatch-id>.md`，啟動時以 argv 帶入一句固定的指標 prompt（「讀 `<絕對路徑>` 並完全照做」）。這偏離規格的「三個 skill」與「Prefer Agent Templates」，理由是 V16：template 對不回報 7501 的程式根本不送第一則訊息，會讓整條派發路徑卡在 opencode 的前置測試上；argv 路徑對 claude（V10，App 自己就這樣啟動）與 codex（V26）已有依據，對 opencode 是 `--prompt`（U2）。

### 4.3 狀態檔

```text
~/.config/herdr-app/my-orca/
  config.json                 # UI 可寫的設定：max_rework_cycles 等（見 3.2 的 D6、D8）
  index.json                  # { "<absolute git-dir>": "<wt-id>" }，讓 UI 不必自己算 hash
  <wt-id>/                    # wt-id = sha256(absolute git-dir) 的前 12 碼（V28）
    state.json                # 唯一的執行狀態；只有 Runner（與建立它的 init）會寫，tmp + rename
    events.jsonl              # 只增不改的轉移紀錄；UI 不讀
    handoff.md  tasks.json    # init 時複製進來，之後不改
    dispatch/<id>.md          # 給 worker 的指示
    results/<id>.ack          # worker 的第一個動作：建立這個空檔（送達確認）
    results/<id>.json         # dev worker 的結果
    reviews/<id>.json         # tuning 的判定
    logs/<id>.txt             # 失敗時 `hc read` 的最後畫面（截到 64 KiB）
  archive/<wt-id>-<utc>/      # 同一個 worktree 下次 init 時，舊的整包搬來這裡；永不刪除
```

`state.json` 的欄位（`schema: 1`）：`run_id`、`core_id`、`repo{git_dir, common_dir, toplevel, branch, base_head, head}`、`profile{cli, model, effort, argv}`、`planning{address, created_ms, tab, space, agent_pid, turn, closed}`、`stage`（`development | tuning | ready_for_review`）、`status`（`working | needs_user | failed | completed`）、`needs_user{code, detail, at}`、`rework{cycles}`、`tasks[]`（`id, kind, title, test, deps, cycle, state, attempts[]`）、`acceptance[]`（`id, text, verify | manual`）、`reviews[]`、`dispatch`（進行中的那一個：`id, kind, task, name, address, phase`）、`updated`。

砍掉的規格欄位：`revision`、`execution_stage`、`progress.*`、`development.queue`、`development.active_task_id`、`max_concurrent_workers` 等固定值。四盞燈的數字在讀取端由 `tasks[]`、`acceptance[]`、`reviews[]` 算出。

### 4.4 Runner 的規則（取代規格的 20 條）

**R-A 派發（防重派）**：先把 `dispatch{id, phase:"intent"}` 寫進 `state.json` → 寫 `dispatch/<id>.md` → `hc run --bg --no-parent --no-notify --json --name orca-d-<id> --label orca.run=<run_id> --label orca.dispatch=<id> --label orca.task=<task> --label orca.role=<dev|tuning> --cwd <toplevel> -- <CLI argv…> "<指標 prompt>"`（呼叫時拿掉 `HC_TERMINAL_ID`，V17）→ 把 address 寫回、`phase:"launched"` → 等送達證據（上限 120 秒）→ `phase:"acked"`。送達證據三選一（M1）：`results/<id>.ack` 存在；以 `hc send` 送達時回傳 `started:true`；argv 啟動後 `hc get` 曾看到 `status.state == "working"`。名稱 `orca-d-<id>` 由 core 保證 live 期間唯一（V5），所以同一個 dispatch 不可能有兩個活的 worker；`name_taken` 視為「已經啟動過」，改走認養。派發前另外確認 `hc ls --json --label orca.run=<run_id> --label orca.role=dev`（以及 `tuning`）是空的，確保同時只有一個 worker。

**R-B 等待**：每 10 秒做兩件事：看 result 檔在不在、`hc get <address> --json`。不用 `hc wait`（V14：idle 時立刻返回會空轉；V6：不回報時只有逾時）也不用 `hc events`。這讓完成判定完全不依賴 OSC 7501：

| 觀察到 | 動作 |
|---|---|
| result 檔存在且 `dispatch` 欄位等於目前的 id | 進 R-C 驗收 |
| terminal 已 `finished`，沒有 result 檔 | 這次嘗試失敗（agent 結束但沒交結果）→ 存畫面到 `logs/` → `needs_user` |
| `status.state == "blocked"`（只有會回報的 CLI 才看得到） | `needs_user`（附 `kind`），terminal 留著給 user 看 |
| 回報 `done` / `idle` / `error` 已超過 60 秒，仍沒有 result 檔（同上，只有會回報的 CLI） | `needs_user`（`stopped_without_result`），存畫面，terminal 留著。額度或 model 中途用完通常長這樣 |
| result 檔存在但 JSON 解析失敗 | 可能還在寫：再等最多 3 次輪詢，仍失敗才記為 `rejected:bad_result` |
| 超過硬上限（dev、tuning 預設各 60 分鐘） | `needs_user`（`timeout`），terminal 留著；不算失敗也不算成功 |
| 120 秒內沒有任何送達證據（見 R-A） | `needs_user`（`undelivered`），存畫面；**不自動重送** |
| `hc` 呼叫本身失敗（core 重啟中） | 退避重試最多 5 分鐘，之後 Runner 結束、不改狀態（UI 顯示「已停住，可恢復」） |

**R-C 驗收（只有 Runner 說了算）**：dev task 被接受的條件是全部成立：(1) result 檔是合法 JSON 且 `dispatch` 相符；(2) Runner **自己**在 worktree 重跑 `tasks.json` 裡該 task 的 `test` 指令，exit 0（上限 15 分鐘）；(3) `git status --porcelain` 是空的；(4) 目前 branch 沒變，且新的 `HEAD` 是上一個紀錄的 `head` 的後代（`git merge-base --is-ancestor`）。不成立 → 這次嘗試記為 `rejected:<原因>`；同一個 task 最多 2 次嘗試，第 2 次的指示檔附上第 1 次失敗的測試輸出（截到 16 KiB）；再失敗 → `needs_user`。

順序是：看到 result 檔 → 把畫面存到 `logs/` → **先 `hc kill` 該 worker** → 驗收 → 寫狀態 → `hc rm`。先 kill 再驗收，是因為 worker 交了結果之後若還在改檔，Runner 重跑的測試就是跑在會變動的工作樹上；worker 已宣告完成，結果都在檔案與 commit 裡，kill 不會損失東西。這把規格的「CHECK RESULT → COMMIT STATE → CLEAN UP」中的「結束程式」提前一步，「移除紀錄（`rm`）」仍在寫狀態之後。

**R-D Git 保護**：Runner 只執行唯讀的 git 指令（`rev-parse`、`status --porcelain`、`merge-base --is-ancestor`、`log`）；從不 `checkout`、`reset`、`stash`、`clean`、`commit`、`push`。每次派發前檢查：branch 與紀錄相同、`HEAD` 等於紀錄的 `head`、工作樹乾淨；任一不成立 → `needs_user`（`tree_changed`），附 `git status` 輸出。`init` 要求工作樹乾淨（見 3.1 的 Q2）。

**R-E Tuning 與 rework**：所有 dev task 被接受後，用 `profile.argv` 起一個全新的 Tuning session。它寫 `reviews/<id>.json`：`verdict`（`pass | rework | needs_user`）、`criteria[]`（每條 acceptance 的 `id, pass, evidence`）、`new_tasks[]`。
- `pass` 成立的條件：`criteria` 涵蓋全部 acceptance 且都 `pass:true`；Runner 自己重跑每條有 `verify` 指令的 acceptance 且都 exit 0；工作樹乾淨；Tuning 期間 `HEAD` 沒動。→ `stage: ready_for_review`、`status: completed`。
- `rework`：`new_tasks` 1 到 10 個；ID 由 Runner 指定為 `R<cycle>-<nn>`（Tuning 不能自己取 ID，所以不會撞號）；`cycles + 1` 超過上限 → `needs_user`（`rework_exhausted`），否則 `cycles += 1`、新 task 進佇列，`stage` 維持 `tuning`。
- **Tuning 直接修**（規格允許，第一輪建議砍掉，這輪改回保留）：Tuning 可以自己 commit 小修正。Runner 看到 Tuning 期間 `HEAD` 前進，就把那份 review 視為過期、`cycles += 1`、再起一個全新的 Tuning session 重新驗收。同一個計數器，所以不會無限循環。保留的理由：Tuning 有全權限，「它改了檔案」這個情況本來就必須處理，處理方式剛好就是規格要的 revalidate，AT-13 因此可測。
- 上限在每次要 `cycles += 1` 之前才讀 `config.json`（1 到 9，預設 3，不合法就沿用舊值並記事件）。調低到小於目前 cycles 不會回溯判失敗，只是下一次 rework 請求會進 `needs_user`。計數器永不自動歸零。

**R-F 單一 Runner 與恢復**：Runner 由 `my-orca start` 以 `hc run --bg --no-parent --no-notify --name orca-r-<wt-id> --label orca.run=<run_id> --label orca.role=runner -- node <my-orca> run <wt-id>` 啟動；名稱唯一（V5）就是鎖，Runner 死掉名稱自動釋出（V24），沒有殘留的 lock 檔。**絕不加 `--keep`**（keep 會在程式消失後補一個 shell 佔住名稱）。兩道補強（M3）：`my-orca run` 啟動時確認 `hc get $HC_TERMINAL_ID` 的 `name` 就是 `orca-r-<wt-id>`，否則拒絕執行；每次寫 `state.json` 之前先讀磁碟上的 `updated`，與自己上次寫入的值不同就不寫、印錯誤、結束。Runner 開機時若 `state.dispatch` 非空，先對帳再做事：

| `hc ls --all --json --label orca.dispatch=<id>` | result 檔 | git | 動作 |
|---|---|---|---|
| 有 live 的 | － | － | 認養，回到 R-B |
| 有 finished 的，或查不到 | 有且合法 | － | 進 R-C |
| 有 finished 的，或查不到 | 沒有 | 乾淨且 `HEAD` 未動 | 沒留下任何東西，可安全重派（新的 dispatch id，嘗試次數 +1，受 2 次上限限制） |
| 有 finished 的，或查不到 | 沒有 | 髒或 `HEAD` 動了 | `needs_user`（`partial_changes`），附 `git status` |

`needs_user` 時 Runner 寫完狀態就結束。User 處理後按 inspector 的 Resume（= `my-orca start`）；Runner 開機看到 `needs_user` 會重跑 R-D 的檢查，通過才清掉並繼續。若 worker 中途死掉但已留下 commit（`HEAD` 前進、工作樹乾淨），user 有兩條路：自己把 branch 退回紀錄的 `head` 再 Resume；或執行 `my-orca start --accept-head`，明確表示「接受目前的 `HEAD` 當新基準」，該 task 以新的一次嘗試重派。Runner 自己永遠不做這個選擇。

Runner 開機時另外掃一次 `hc ls --json --label orca.run=<run_id>`：dispatch id 已記在某次嘗試且該嘗試已結束的 live worker（寫完狀態、來不及清理就當掉留下的）→ kill + rm；dispatch id 不在 state 裡的 → 不碰，進 `needs_user`（`unknown_worker`）。

**R-G 只清自己的東西**：Runner 會 kill / rm 的 terminal 只有兩種：帶 `orca.run=<本 run>` 標籤且 `orca.dispatch` 等於 state 紀錄的；以及第 2 節定義的那一個 Planning terminal。每次 kill 之前重新 `hc get` 核對標籤，並寫一筆 `kill` 事件。

### 4.5 三個 CLI 的啟動方式（P1 只影響表中 opencode 那一列）

| 角色 | argv | 依據 |
|---|---|---|
| Tuning（claude） | `claude --dangerously-skip-permissions --model <M> --effort <E> "<指標 prompt>"` | V10、V26、V27 |
| Tuning（codex） | `codex --no-daemon -c disable_paste_burst=true --dangerously-bypass-approvals-and-sandbox -m <M> -c model_reasoning_effort=<E> "<指標 prompt>"` | V26、V27；`foreground.argv` 是否保留這些旗標見 U12 |
| Dev（opencode） | `opencode --auto [--standalone] --prompt "<指標 prompt>"` | V25；`--prompt` 是否自動送出、是否需要 `--standalone` 由 P1 決定（U1 到 U4） |

Runner 本體**不得**依「有沒有回報 7501」分支；兩種結果的差別只在這張表（opencode 的旗標，以及送達方式是 `argv` 還是「啟動後 `hc send`」）。P1 各種結果對應的送達方式，以及唯一會改變範圍的結果（M5），見第 7 節質疑 5 的表。P1 兩種結果下的行為：

| | opencode 有回報 | opencode 沒回報 |
|---|---|---|
| 送達確認 | ack 檔，或曾回報 `working` | 只有 ack 檔 |
| 完成判定 | result 檔（最慢 10 秒後發現） | 相同 |
| 卡在提問或權限 | 立刻 `needs_user`（`blocked`） | 等到硬上限才 `needs_user`（`timeout`） |
| inspector 的 agent 狀態 | `working / blocked / done` | 只有 `live / finished` |
| AT-21 | 全部可測 | `blocked` 分支對 opencode 標 NOT TESTED；timeout 與「不誤判成功」照測 |

`profile` 的來源：`hc get $HC_TERMINAL_ID --json` 的 `foreground.argv`，**只取白名單旗標**（claude：`--model`、`--effort`；codex：`-m`、`-c model_reasoning_effort=`），絕不保存整段 argv（V10：裡面有 user 的第一則 prompt）。argv 沒有 `--model`（user 用預設值啟動）→ `init` 失敗並要求 skill 以 `--model <id> --effort <level>` 明確傳入（agent 知道自己的 model）。`init` 最後印出「Tuning 將使用：…」，skill 必須原文轉述給 user。**已知限制**：user 在 session 中途用 `/model` 換過 model 的話，argv 不會反映，只能靠這行轉述讓 user 發現。

### 4.6 第一輪簡化建議的重新驗證

| 第一輪建議 | 重新驗證後 | 依據 |
|---|---|---|
| 一個 skill + 兩個 hc template | **改**：一個 skill、零個 template，prompt 走 argv | V16 |
| `runner.lock`（O_EXCL pidfile）取代檔案鎖 | **改**：用 core 的名稱唯一性當鎖，沒有 lock 檔 | V5、V24 |
| 砍 `revision`、`execution_stage`、`progress.*`、`queue` | 保留此簡化；但 `status`、`needs_user`、`dispatch` 推導不出來，要存 | 4.3 |
| 目錄壓成 `<wt-id>/` 一層 | 保留；加 `index.json` 給 UI 查 | V28 |
| 三個標籤 | **改**：四個（多 `orca.role`，用來查「現在有沒有 worker」） | V3 |
| `hc wait` 迴圈取代 `hc events` | **改**：固定 10 秒 `hc get` + 看檔案 | V6、V14 |
| Runner 跑在 `hc run --bg --no-parent` 裡 | 保留，已驗證；補「不可 `--keep`」 | V21、V22、V24 |
| 「profile = Planning terminal 的 argv，永遠可得」 | **錯**：`argv` 是 shell 包裝且含 prompt；要用 `foreground.argv` 的白名單旗標，而且 model 可能不在裡面 | V10 |
| 「`hc ls --json` 沒有 labels，只能逐一 `hc get`」 | **部分錯**：輸出確實沒有 labels，但 `hc ls --label` 可以直接篩 | V3、V4 |
| worker 用 `--no-parent --no-notify` | 保留；再加「呼叫時拿掉 `HC_TERMINAL_ID`」 | V17 |
| v1 砍掉 Tuning 直接修 | **改回保留**（算一次 rework cycle、強制重新驗收） | 4.4 R-E |
| 砍 reduced-motion、inspector 的 session history | 保留此簡化 | V29 |
| 測試：`node --test` + stub agent，真 E2E 只跑一次 | 保留；stub 就是會送 7501 的 `fake-agent.sh`，兩種模式（回報 / 不回報）都測 | V13 |
| 硬 timeout → `NEEDS_USER` | 保留 | 4.4 R-B |

### 4.7 v1 做什麼、延後什麼

| 做（v1） | 延後 |
|---|---|
| `my-orca`：`init / start / run / stop / status / config set` | 多個 worker 並行 |
| `herdr-planning` skill（claude、codex） | 遠端 machine（`watchFolder`、`writeTextFile` 只限本機，V29）；v1 只支援本機 worktree |
| Dev 用 opencode、一次一個、每個 task 全新 session | codex 或 claude 當 dev worker |
| Tuning 用鎖定的 profile、全新 session；rework 上限；直接修算一次 cycle | 重開機後自動恢復（v1 要 user 按 Resume） |
| `ready_for_review` 閘門（Runner 自己重跑測試） | inspector 內的 session history（v1 用 `my-orca status` 看 `events.jsonl` 尾端） |
| Planning tab 的安全關閉（第 2 節） | reduced-motion（平台沒有這個設定，V29；列為已知限制） |
| 四燈列 + inspector + peek + rework 上限設定 | `hc events` 事件流、hc template、`revision` 與檔案鎖 |
| `fake-agent.sh` 測試 + 一次真 E2E | Linux、Windows |
| README 一節（啟動、查看、停止、恢復、狀態欄位、已知限制） | 獨立的多份文件 |

### 4.8 v1 面板（`dfb7acc`）的保留 / 改寫 / 刪除

| 檔案 | 處置 | 說明 |
|---|---|---|
| `mods/orca-chrome/main.js:54` 的 workflow 按鈕與 `workflow.svg` | **保留** | 仍然開同一個對話框，現在它是 inspector |
| `mods/orca-workflow/mod.json` | **保留** | |
| `mods/orca-workflow/model.js` | **改寫** | 保留「純函式 + `node:test`」的形式與 `stageCards` 的數字夾限寫法；輸入改成 `state.json`，輸出改成四盞燈（`lights(state)`）與 inspector 列（`rows(state, terminals)`） |
| `mods/orca-workflow/model.test.js` | **改寫** | 跟著 `model.js` |
| `mods/orca-workflow/main.js` | **改寫** | 改讀 `index.json` + `state.json`；`watchFolder`（U10，不行就留 5 秒 timer）；agent 列改用 `terminals()` 依 `orca.run` 標籤篩選並配 timer（V29）；每列加 Peek（`run("terminal.peek", {terminal})`，V23）；加 rework 上限設定與 Resume / Stop 按鈕；加 `props().strip` 的四燈畫法 |
| `herdr-orca-workflow.md` 這個資料檔與 markdown fence 格式、`parseDoc` | **刪除** | 改成直接 `JSON.parse(state.json)` |
| `SAMPLE` 假資料、`agent_addresses`、`agent_tasks`、`review_return_to_implementation`、對 `agents()` 的使用 | **刪除** | 沒有 state 時顯示空狀態文字「No workflow in this worktree · run /herdr-planning」；`agents()` 看不到背景 worker（V29） |
| 三張大卡片的版面 | **改寫** | 四欄、縮小；第四欄是閘門（`0/1`） |
| `layouts/orca.json` | **新增一個 block** | 四燈列的位置待 owner 決定（3.1 的 Q3） |

四燈的畫法：8px 圓點 + 階段名稱 + `accepted / total`。顏色用規格的四個固定 hex（階段識別色，明暗主題相同）；狀態不只靠顏色：完成 = 實心加勾（`circle-check.svg`）、進行中 = `.loop("opacity", …)` 原生脈動、未開始 = 空心圈、`needs_user` = `triangle-alert.svg`、`failed` = `alert-circle.svg`（三個圖示 `mods/orca-status/` 已有）。計數：Planning = 閘門 `1/1`；Development = 已接受的 dev task ÷ 全部 dev task（含 rework 新增的）；Tuning = 最新一份 review 通過的 acceptance ÷ 全部 acceptance；Ready = `0/1` 或 `1/1`。

## 5. 邊界情況表

測試代號：**T** = `node --test` 單元測試（不需要 core）；**F** = 用 `fake-agent.sh` 對真的 core 做整合測試（拋棄式 repo 在 `/private/tmp`，全部是隱藏的背景 terminal，「回報」與「不回報」兩種模式各跑一次）；**M** = owner 在場的手動測試；**E2E** = 唯一一次真實執行。規則代號 R-A 到 R-G 見 4.4，D 開頭見 3.2。

### 5.1 規格第 9 節的 20 條

| # | 情況 | 預期行為 | 處理機制 | 測試 |
|---|---|---|---|---|
| S1 | 沒有 Herdr Core | `init` 失敗並說明，什麼都不寫 | `init` 先跑 `hc server status` | T：PATH 裡沒有 `hc` → 非零、狀態資料夾不存在 |
| S2 | 沒有 opencode | `init` 失敗；執行中途才消失則 `needs_user`（`spawn_failed`），不消耗嘗試次數 | `init` 檢查 `command -v`；`hc run` 的 `spawn_failed`（V20） | T + F：把 dev 的 argv 換成不存在的指令 |
| S3 | Planning / Tuning 的 model 不可用 | `init` 只能確認 CLI 存在且 model 字串非空；真的不可用會在 Tuning 啟動時表現為「沒有 ack」或「結束但沒結果」→ `needs_user`，畫面存 `logs/` | R-B；無法事先驗證 model 是否可用（誠實列為限制） | F：tuning 的 argv 換成立刻 exit 1 的 fake |
| S4 | handoff 不完整 | `init` 非零、指出缺哪個章節或哪個 task；不寫狀態、不啟動 Runner、不關 tab | D14 | T：缺章節、缺 `test`、id 重複、空清單各一 |
| S5 | Agent 啟動失敗 | `needs_user`（`spawn_failed` 或 `exit_without_result`） | V20 + R-B | F：同 S2、S3 |
| S6 | 第一則 prompt 沒送達 | 120 秒沒有 ack → `needs_user`（`undelivered`），存畫面，terminal 留著，**不重送** | R-A 的 ack 檔 | F：fake 的「不理 prompt」模式 |
| S7 | Agent 卡在權限詢問 | 全權限旗標下不該出現（決定 4）；出現且有回報 → `needs_user`（`blocked`）；沒回報 → 60 分鐘後 `needs_user`（`timeout`）。Runner 從不 `hc send --force`、從不代答 | R-B；V19 | F：fake 的 `block` 模式；opencode 本身的行為待 P1 |
| S8 | 逾時但沒有確定失敗 | `needs_user`（`timeout`）；task 維持 `dispatched`；terminal 留著；Resume 時先看 result 檔是否已出現 | R-B、D6 | F：把上限設成 5 秒 |
| S9 | Agent 結束但沒有 result | 這次嘗試失敗 → `needs_user`（`exit_without_result`）；不自動重派 | R-B | F：fake exit 0 但不寫檔 |
| S10 | Agent 說成功但測試失敗 | 拒絕；第 2 次嘗試附失敗輸出；再失敗 → `needs_user` | R-C（Runner 自己重跑測試）、D12 | F：fake 寫 `status: done`，`test` 是 `false` |
| S11 | Runner 中斷或當掉 | 重啟後對帳，已接受的 task 不重做 | R-F 的對帳表 | F：見 5.2 的 C1 到 C8 |
| S12 | 重複派發的風險 | 同一個 dispatch 永遠最多一個 terminal | 先寫意圖、名稱鎖（V5）、標籤查找（V3） | F：在 `hc run` 與寫回 address 之間 `kill -9` Runner，重啟後 `hc ls --all --label orca.dispatch=<id>` 恰好一筆 |
| S13 | 同時寫 JSON | `state.json` 只有一個寫入者 | Runner 的名稱鎖；`init` 用「先寫暫存資料夾再 rename」；UI 只寫 `config.json`（帶 `expected`） | F：同時執行兩次 `my-orca start`，第二次得到 `name_taken` 後正常結束；T：在非指定名稱的 terminal 執行 `my-orca run` 會拒絕 |
| S14 | 過期或被重用的 terminal 參照 | 絕不只憑 address 行動 | kill 前重新核對標籤（R-G）；Planning terminal 另核對 `created_ms` 與 core id（2.2） | T：state 裡的 address 指向沒有標籤的 terminal → 不 kill，`needs_user`（`identity`） |
| S15 | Branch 或 worktree 改變 | `needs_user`（`tree_changed`），附 `git status` | R-D：每次派發前與驗收時檢查 | F：兩個 task 之間 `git checkout -b other` |
| S16 | Tuning 產生過多 task | 超過 10 個 → `needs_user`（`rework_too_large`） | D13 | F：fake tuning 回 11 個 |
| S17 | Rework 次數用完 | `needs_user`（`rework_exhausted`）；不會進 `ready_for_review`；計數器不歸零 | R-E | F：上限設 2、fake tuning 永遠回 `rework` → 第 3 次請求時停住，`cycles == 2` |
| S18 | Herdr Core 重啟 | Runner 的 `hc` 呼叫失敗 → 退避重試 5 分鐘 → 仍失敗就結束且不改狀態；Resume 後用標籤重新找 worker | R-B 最後一列、R-F；core 重啟後 terminal 是否存活未驗證（U7），設計不依賴 | T：用假的 `hc`（PATH shim）回錯誤 N 秒；真的 core 重啟只能在獨立的測試 core 上測 |
| S19 | 誤選 user 的 terminal 來清理 | 不可能通過檢查 | R-G + 2.2 | AT-03 (d) 的稽核；T：同 S14 |
| S20 | 專案檔案出現非預期的部分修改 | 驗收要求工作樹乾淨；恢復時工作樹是髒的 → `needs_user`（`partial_changes`）；Runner 不清理、不還原 | R-C、R-D、R-F | F：fake 留下未 commit 的檔案後交結果 → 被拒絕，檔案仍在 |

### 5.2 Runner 每一步的當掉與重啟

| # | 當掉的時間點 | 重啟後 | 測試 |
|---|---|---|---|
| C1 | 寫派發意圖之前 | 什麼都沒發生；重新算出同一個下一步 | F：每個點用環境變數 `ORCA_CRASH_AT=<點>` 讓 Runner 自己 `process.exit(137)`，重啟後比對最終 state 與「沒當掉的那次」相同 |
| C2 | 寫了意圖、還沒 `hc run` | 找不到 terminal、沒有 ack、工作樹乾淨 → 以新的 dispatch id 重派；沒有 ack 的 dispatch 不算一次嘗試 | 同上 |
| C3 | `hc run` 成功、address 還沒寫回 | 用 `orca.dispatch` 標籤找到 live terminal → 認養 | 同上（即 S12） |
| C4 | 等待中 | 認養，繼續等；逾時從 `dispatch` 記錄的開始時間算 | 同上 |
| C5 | result 已出現並已 kill worker、還沒寫狀態 | terminal 是 finished、result 檔在 → 重新驗收（重跑測試，結果相同） | 同上 |
| C6 | 已寫狀態（接受）、還沒 `rm` | 開機掃描發現「已結束的嘗試」留下的 terminal → 清掉 | 同上 |
| C7 | 正在寫 `state.json` | 只會看到舊檔或新檔（rename 是原子的）；殘留的暫存檔開機時刪除 | T：寫入函式在 rename 前丟例外 → 原檔不變 |
| C8 | 寫了 `events.jsonl`、還沒寫 `state.json`（或反過來） | 以 `state.json` 為準；`events.jsonl` 最後一行殘缺時讀取端略過 | T |
| C9 | Tuning 的 review 已出現、`cycles` 還沒加 | `cycles += 1` 與「新 task 入列、review 記入 `reviews[]`」在同一次寫入；已在 `reviews[]` 的 review id 不會再套用一次 | F：在 review 檔出現後立刻當掉，重啟後 `cycles` 恰好加 1 |
| C10 | 整台機器重開機 | 所有 terminal 都沒了；user 按 Resume；走 R-F 對帳表（找不到 terminal 的那幾列）。v1 不自動恢復 | M；重開機後 terminal 的呈現方式未驗證（U8），兩種呈現的處理相同 |
| C11 | User 手動 kill Runner 的 terminal | 與當掉相同；worker 是 `--no-parent`，會繼續跑，Resume 後被認養 | F：`hc kill orca-r-<wt-id>` |

### 5.3 其他情況

| # | 情況 | 預期行為 | 處理機制 | 測試 |
|---|---|---|---|---|
| E1 | 連按兩次 Resume、或同時兩個 `my-orca start` | 第二個什麼都不做 | 名稱鎖（V5） | F（同 S13） |
| E2 | 同一個 worktree 在 run 進行中又執行 `/herdr-planning` | `init` 拒絕 | D11 | T |
| E3 | 兩個 `init` 同時搶同一個 worktree | 只有一個成功 | 暫存資料夾 rename 成 `<wt-id>/`，第二個 rename 失敗 | T |
| E4 | `git worktree move`（改名或搬位置） | `git-dir` 不變所以 `wt-id` 不變；Runner 發現 `toplevel` 不在或它的 `git-dir` 不符 → `needs_user`（`worktree_moved`）；從新位置 `my-orca start` 會核對 `git-dir` 後更新 `toplevel` 再繼續 | 每次派發前 `git -C <toplevel> rev-parse --absolute-git-dir` | F：兩個 task 之間 move |
| E5 | Worktree 被刪除 | `needs_user`（`worktree_missing`）；狀態保留、不自動刪 | 同 E4 | F |
| E6 | 整個 repo 搬家 | `git-dir` 路徑變了 → `wt-id` 變了 → 舊 run 變孤兒，新位置看不到它。**v1 的已知限制**：重新 Planning；舊資料留在原資料夾 | 無（README 寫明） | 無 |
| E7 | 同一個 repo 的兩個 worktree 各跑一個 run | 互不影響：`wt-id`、Runner 名稱、狀態資料夾、標籤都不同；git 不允許兩個 worktree checkout 同一個 branch | 4.3 | F：同一個拋棄式 repo 開兩個 worktree 平行跑完（AT-20） |
| E8 | 中途切換 branch | 同 S15 | R-D | F |
| E9 | Run 期間 user 修改檔案（兩個 task 之間） | 下一次派發前發現工作樹不乾淨 → `needs_user`（`tree_changed`） | R-D | F：兩個 task 之間 `touch` 一個檔 |
| E10 | Run 期間 user 修改檔案（worker 正在跑的時候） | **無法可靠偵測**：worker 的 `git add` 可能把它一起 commit。已知限制；inspector 與四燈列在 run 進行中顯示「此 worktree 由 workflow 使用中」 | 無（這就是要用獨立 worktree 的原因） | 無 |
| E11 | core 重啟後 address 失效 | Runner 從不只憑 address：每次都用 `orca.dispatch` 標籤重新找；找不到就看 result 檔與 git 狀態 | R-F | T（假 `hc`） |
| E12 | core id 與紀錄不同（換了一個 core） | 沒有進行中的 dispatch → 更新 `core_id` 繼續，Planning tab 不關（`skipped:gone`）；有進行中的 → 走 R-F「查不到」那幾列 | `hc server status` 的 `core.id`（V12） | T |
| E13 | `init` 執行到一半 Planning tab 被關掉（`init` 被中斷） | rename 之前中斷 → 只留暫存資料夾，下次 `init` 清掉；rename 之後、Runner 啟動之前中斷 → 有狀態但沒有 Runner，UI 顯示「已停住」，按 Resume 即可 | `init` 的寫入順序；UI 用 `terminals()` 找不到名為 `orca-r-<wt-id>` 的 live terminal 就顯示停住 | T：`init --no-start` 之後 model 的輸出是 stalled |
| E14 | Planning 結束後、Runner 來關之前，user 自己關了 tab | `planning.closed = "skipped:gone"`，workflow 照常 | 2.2 檢查 a；Runner 是 `--no-parent`（V21） | F |
| E15 | Planning tab 有其他工作 | 不關 | 2.2 檢查 d、e、f | AT-03 (b) |
| E16 | User 關掉或 kill 背景 worker（例如從 peek 按 close） | `needs_user`（`exit_without_result`）；不自動重派（可能是故意的） | R-B | F：測試中 `hc kill` worker |
| E17 | User 在 peek 按「keep-as-tab」把 worker 變成一般 tab | 它得到 `herdr.*` 標籤與 `keep`，但 `orca.*` 標籤還在，仍是 workflow 的 worker；task 結束時照樣被 kill，那個 tab 會跟著消失。README 寫明 | R-G | M |
| E18 | User 手動在背景 worker 裡打字 | 視為 user 的介入；結果照 R-C 驗收，不特別處理 | 無 | 無 |
| E19 | Rework 的計數時機 | 只在「一批 rework task 入列」或「Tuning 直接修（`HEAD` 前進）」時加 1，且與該次狀態寫入是同一次寫入 | R-E、C9 | F |
| E20 | Tuning 回 `rework` 但 `new_tasks` 是空的，或 `pass` 但有 acceptance 沒過 | review 不合法 → 這次 Tuning 嘗試被拒絕 → 再起一次全新的 Tuning（最多 2 次）→ `needs_user` | R-E 的檢查 | T + F |
| E21 | 空的 task 清單 | `init` 拒絕 | D14 | T |
| E22 | 循環相依 | `init` 拒絕（拓撲排序）；rework 的 `deps` 只能指向既有 id 或同批中排在前面的 task，結構上不可能成環，否則 review 不合法 | D14、R-E | T |
| E23 | 有 task 的前置 task 沒被接受 | 它不會被派發；沒有任何可派發的 task 而又沒全部完成 → `needs_user`（`blocked_tasks`）；絕不跳過 | 下一步的選擇規則 | T |
| E24 | Rework 的 task id 與既有的衝突 | 不會發生：id 由 Runner 指定（`R<cycle>-<nn>`），初始 id 不得用這個前綴 | D13、D14 | T |
| E25 | 超大輸出 | result / review 檔超過 256 KiB → 拒絕（先 `stat` 再讀）；測試輸出寫到 `logs/`，state 只存路徑與 exit code；附給下一次嘗試的失敗輸出截到 16 KiB；畫面截到 64 KiB；`handoff.md` 上限 256 KiB | D6、D14、D15 | T：2 MiB 的 result 檔 |
| E26 | `state.json` 大到 UI 讀不了 | 上限估算：100 + 9 × 10 個 task、每個最多 2 次嘗試，遠小於 `readTextFile` 的 1 MiB（V29）；`events.jsonl` 沒有上限但 UI 不讀 | 4.3 | T：產生最大規模的 state，檢查小於 512 KiB |
| E27 | 時鐘跳動、電腦睡眠 | 期間用單調時鐘；就算誤判逾時，結果只是 `needs_user`，按一次 Resume，不會誤判成功或失敗 | D6 | T：注入假的時鐘 |
| E28 | 測試指令卡住或留下背景程序 | 15 分鐘後殺掉整個 process group → `rejected:test_timeout`；測試以關閉的 stdin 執行 | R-C | T：`test` 是 `sleep 9999` 配 2 秒上限 |
| E29 | 測試在 worker 手上過、在 Runner 手上不過（不穩定的測試） | 第 2 次嘗試；再不過 → `needs_user` | D12 | F |
| E30 | 路徑經過 symlink | 所有路徑先 `realpath`；同一個 worktree 經不同路徑進來得到同一個 `wt-id` | D5 | T |
| E31 | 不是 git repo、bare repo、detached HEAD | `init` 拒絕（`--is-inside-work-tree`、`--is-bare-repository`、`git symbolic-ref -q HEAD`） | V28 | T |
| E32 | 在主 checkout（不是 linked worktree）執行 | 可以跑；`init` 印出警告「建議在獨立 worktree 執行」 | 無 | T |
| E33 | 遠端 machine 上的 worktree | v1 不支援：`init` 執行 `herdr-app status` 失敗就拒絕（遠端沒有 App；本機 App 沒開也會被擋，訊息兩種都提） | V29 | T（假 `herdr-app`） |
| E34 | 不在 Herdr 的 terminal 內執行 skill（沒有 `HC_TERMINAL_ID`） | `init` 拒絕 | `init` 的檢查 | T |
| E35 | Planning 用的不是 claude 或 codex | `init` 拒絕（`unsupported_cli`） | 4.5 的白名單 | T |
| E36 | Planning 的 argv 沒有 model | `init` 要求 `--model`、`--effort` 明確傳入 | 4.5 | T |
| E37 | User 中途用 `/model` 換過 model | 無法偵測；`init` 印出將使用的 profile，由 skill 轉述給 user 確認 | 4.5（已知限制） | M |
| E38 | UI 讀到寫到一半的檔案 | 不會：`state.json`、`index.json`、`config.json` 都是 tmp + rename；`JSON.parse` 失敗時 UI 保留上一份可用資料並等下一次變更（v1 `main.js` 的 try/catch 寫法保留） | D5 | T：model 收到壞 JSON → 回傳上一份 |
| E39 | Run 中途改設定 | rework 上限在要加 `cycles` 之前才讀；逾時值在每次派發開始時讀（進行中的那次不變）；不合法的值沿用舊值並記事件；調低上限不回溯 | R-E | F |
| E40 | UI 與 CLI 同時改 `config.json` | 後寫的贏（只有幾個獨立的數值）；UI 的 `expected` 過期會被拒絕並重讀 | D8 | T |
| E41 | Secrets 進到 `state.json` / `events.jsonl` | argv 只留白名單旗標（V10）；不存環境變數、不存畫面；`my-orca/` 資料夾權限 `0700`、檔案 `0600` | D15 | T：`profile.argv` 不含 prompt；檔案權限 |
| E42 | Secrets 進到 `handoff.md` | `init` 的樣式掃描命中就拒絕，只報行號。盡力而為，擋不住沒見過的格式 | D15 | T：放一個假的 `sk-…` |
| E43 | Secrets 出現在 agent 的畫面上 | 只會進 `logs/<id>.txt`（失敗時才存、截 64 KiB、`0600`），不進 state 與 events | D15 | T |
| E44 | opencode 的額度或 model 中途耗盡 | 有回報：`stopped_without_result`；沒回報：`timeout`；程式直接結束：`exit_without_result`。三者都是 `needs_user`。若已留下 commit，見 R-F 的 `--accept-head` | R-B、R-F | F：fake commit 一次後結束、不交結果 → `needs_user`；直接 Resume 仍停住；`--accept-head` 後重派 |
| E45 | Tuning（claude / codex）的額度中途耗盡 | 同 E44；沒有 review 就不會有 `pass` | R-B、R-E | F |
| E46 | Worker 交了結果之後還在改檔 | 看到 result 就先 kill 再驗收 | R-C 的順序 | F：fake 交結果後每秒寫一個檔 → 驗收時工作樹已靜止 |
| E47 | Worker 交的 result 是別的 dispatch 的（上一次嘗試留下的） | 檔名與內容的 `dispatch` 都要等於目前的 id，否則當作沒有 | R-C | T |
| E48 | Worker 自己 push、改別的 branch、動別的 worktree、寫 worktree 以外的檔案 | **擋不住也偵測不到**（全權限，決定 4）。指示檔明文禁止；Runner 能驗證的只有：本 worktree 的 branch、`HEAD` 的祖先關係、工作樹是否乾淨。被 git 忽略的檔案與 worktree 以外的一切都看不到 | D3（已知限制，README 寫明） | 無 |
| E49 | Worker 自己再起子 agent | 指示檔禁止；worker 的 hc 子 terminal 會在 worker 被 kill 時一起結束（V21），除非它用了 `--no-parent`（偵測不到） | D3 | 無 |
| E50 | opencode 的 background service 讓工具指令活在 terminal 之外 | 未驗證（U3）。若屬實而不處理，kill 之後檔案仍可能被改，「同時只有一個 worker」就不成立 → 所以 P1 必須測，並依結果加 `--standalone` | P1 | P1 |
| E51 | 磁碟滿或狀態資料夾不可寫 | 暫存檔寫入失敗 → Runner 印錯誤後結束，原本的 `state.json` 不變；UI 顯示停住 | D5 | T：唯讀資料夾 |
| E52 | User 刪掉狀態資料夾 | Runner 下一次寫入失敗而結束；worker 還活著的話，`my-orca status --all` 用 `hc ls --label orca.role=dev`（與 `tuning`、`runner`）列出沒有對應狀態的 terminal，由 user 決定，不自動 kill | R-G | T |
| E53 | Herdr App 沒開 | Runner 不受影響（只用 core）；Planning tab 不關（`skipped:app_unavailable`） | 2.2 檢查 h | F（假 `herdr-app`） |
| E54 | Herdr App 更新後重啟 | 視窗關閉不會結束 terminal（`herdr-app --skill`）；Runner 與 worker 繼續 | 無 | M |
| E55 | `hc` 升級後 JSON 欄位改變 | Runner 啟動時記下 `hc --version`；用到的欄位缺少 → `needs_user`（`hc_incompatible`），不猜 | Runner 對每個 `hc` 回應檢查必要欄位 | T（假 `hc`） |
| E56 | 同一個 worktree 開在兩個 space 或 tab | 兩邊的 UI 都用 `git-dir` 查到同一個 run，顯示相同 | `index.json` | M |
| E57 | 從 worktree 的子資料夾執行 | 由 git 解析出 `toplevel` | V28 | T |
| E58 | `my-orca stop` 在 worker 執行中 | kill Runner（加 `--workers` 才連 worker 一起 kill）；狀態維持 `working`、UI 顯示停住；Resume 時認養或對帳 | R-F | F |
| E59 | acceptance 全部是 `manual` | `init` 拒絕（至少一條要有 `verify`） | D14 | T |
| E60 | Tuning 直接修之後又留下未 commit 的檔案 | 工作樹不乾淨 → `needs_user`（`partial_changes`） | R-E | F |

## 6. 已驗證 vs UNVERIFIED（含探針）

環境（2026-11-16 實測）：`hc 0.1.21`、`herdr-app 0.1.15`、macOS。探針一律是純 shell 的背景 terminal（`--bg --no-parent --no-notify --label orca.probe=1`，cwd `/private/tmp/orca-probe-7d820812`），沒有啟動任何 AI agent。探針前的基準：live terminal 為 `t1 t14 t25 t26 t4v t51`，三個 space 的 tab 數為 1 / 2 / 3。

### 6.1 已驗證（附實際執行的指令）

| # | 宣稱 | 證據 |
|---|---|---|
| V1 | `~/.herdr`、`~/.config/herdr-core/`、`~/.config/herdr-app/my-orca/` 都不存在；`hc templates` 是空的 | `ls` 三個路徑皆 `No such file or directory`；`hc templates` → `{"templates":[]}` |
| V2 | 背景 terminal 不帶 `herdr.space` / `herdr.tab` 標籤就不會出現在視窗 | 探針 A：`hc run --bg --no-parent --no-notify --name orca-probe-a --label orca.probe=1 --label orca.dispatch=d1 -- sh -c '…sleep 600'` 之後 `herdr-app ls` 的 space/tab 數不變、`sub_agents` 全空 |
| V3 | 自訂標籤可用，建立後還能再加；`hc ls --json --label K=V` 可依標籤篩選（可重複，AND） | `hc get t52 --json` 的 `labels` = `{"orca.dispatch":"d1","orca.probe":"1"}`；`hc label t52 orca.task=T-01` 後 `hc ls --json --label orca.dispatch=d1 --label orca.task=T-01` 只回 `t52` |
| V4 | `hc run --bg --json` 與 `hc ls --json` 的輸出是精簡格式（`address/agent/cwd/name/state/turn`），**沒有** `labels`、`argv`、`first_message`；完整資料要 `hc get <t> --json` | 探針 A 的輸出原文。第一輪審查說「只能逐一 `hc get` 比對標籤」不正確：用 `hc ls --label` 直接篩 |
| V5 | **名稱在 live terminal 之間唯一，由 core 強制**：同名第二次 `hc run` 失敗 | 第二次 `hc run --name orca-probe-a` → `{"error":{"kind":"name_taken",…}}`，exit 1。→ 用名稱當「單一 Runner」與「同一 dispatch 不重派」的鎖，取代 pidfile |
| V6 | 純程式（不回報 OSC 7501）的 `hc wait` 只會在逾時或結束時返回 | `hc wait orca-probe-a --timeout 2 --json` → `ended:false, reason:"timeout", status:null`，exit 0；`hc get` 的 `reported:false` |
| V7 | `hc kill` → `state:"finished", reason:"killed", signal:1`；之後 `hc wait` 立即回 `ended:true, reason:"exit"`；`hc read` 對已結束的 terminal 仍可讀輸出；`hc ls` 預設不列已結束的（`--all` 才列） | 探針 A 輸出原文 |
| V8 | `hc rm` 之後該 address 查無此 terminal | `hc rm t52` → `{"removed":"t52"}`；`hc get t52` → `kind:"not_found"`，exit 3 |
| V9 | `--no-parent` 啟動的 terminal `parent:null`、`die_with_parent:false`；`--no-notify` → `notify:false` | `hc get t52 --json` |
| V10 | App 開的 agent tab，terminal 的 `argv` 是 `/bin/zsh -lic '"$@"; exec "$0" -li' /bin/zsh claude --dangerously-skip-permissions --model … --effort … "<第一則 prompt>"`；`foreground.argv` 才是 agent 本身；標籤含 `herdr.space`、`herdr.tab`；`keep:true` | `hc get t51 --json`（本 session 自己的 terminal）。→ argv 內含 user 的第一則 prompt 全文，**不可整段存進 state** |
| V11 | App 指令：`tab.close {id?, confirmed?}`「Close a tab and end its terminals」、`pane.close {pane?}`「Close a pane and end its terminal」、`terminal.kill {terminal}`「End a terminal and its sub-agents」、`terminal.peek {terminal}`、`overlay.close {id?}` | `herdr-app commands` |
| V12 | core 有 `terminal.list` 的 `labels` 參數、`events.subscribe`、`doc.get/doc.set`（帶版本的 JSON 文件）；`Terminal.address` 的說明是「this terminal forever on this core」；`Terminal.reported` 表示程式是否曾送過 7501 | `hc schema --json` |

| V13 | OSC 7501 的寫法是 `ESC ] 7501 ; state=<word>:app=<name>[:kind=<k>] BEL`（冒號分隔的 `key=value`） | 探針 C：`printf '\033]7501;state=working:app=probe\007'` 之後 `hc get` → `reported:true, status:{"app":"probe","state":"working"}`。→ 可以寫一個純 shell 的 `fake-agent.sh` 測 Runner，不需要真 agent |
| V14 | 有回報的程式：`hc wait` 在狀態離開 `working` 時返回（`reason:"status", status:"done", turn:1`）；狀態已經不是 `working` 時**立刻**返回（`status:"idle"`） | 探針 D、H。→ 用 `hc wait` 當迴圈會在 agent idle 時空轉，Runner 改用固定間隔 `hc get` |
| V15 | Template 啟動 + **有回報**的程式：`hc run --bg --json <template> "<task>"` 的輸出含 `first_message:{sent:true, started:true, turn:0}`，程式收到「template body + 空行 + task」；之後 `hc get` 的 `first_message` 是 `null`（只在沒送出時保留） | 探針 D2，拋棄式 template `orca-probe-report` |
| V16 | **Template 啟動 + 不回報 7501 的程式：第一則訊息不會送出。** `hc run` 卡 60 秒後回 `first_message:{sent:false, reason:"it never reported its status, so it may be showing a dialog…"}`，程式什麼都沒收到 | 探針 D3（`orca-probe-silent`，起訖時間差 60 秒，log 檔不存在）。→ 第一輪審查的「兩個 hc template」方案在 opencode 不回報時整條失效；收斂後改用 argv 帶入第一則 prompt（見第 4 節） |
| V17 | 從 terminal 內啟動時，送進去的訊息會被包成 `<hc from="t51" reach="hc send t51 when done or stuck">…</hc>`（即使 `--no-parent --no-notify`）；呼叫時拿掉 `HC_TERMINAL_ID` 就沒有這層包裝 | 探針 D2 vs D5（`env -u HC_TERMINAL_ID -u HC_SCOPE hc run …`）。→ 否則 worker 會被告知「做完用 `hc send` 回報給 Runner」，把文字打進 Runner 的 stdin |
| V18 | 對不回報的程式，`hc send` 仍會送達，但 `started:null`（沒人能確認它開始了） | 探針 D6：log 檔出現 `MANUAL-SEND-1`，回傳 `{"started":null,"status":null}` |
| V19 | `blocked` 可偵測且 `hc send` 會拒絕：`status:{state:"blocked",kind:"question"}`；`hc send` → `kind:"blocked"`，exit 9 | 探針 H |
| V20 | 自行結束的程式：`reason:"exited", exit_code:3`；`kill -9`：`reason:"exited", signal:9`；啟動不存在的指令或不存在的 cwd：`kind:"spawn_failed"`，exit 1，不留下 terminal | 探針 I、J |
| V21 | **子 terminal 會跟著父 terminal 一起死**；`--no-parent` 與 `--outlive-parent` 的不會 | 探針 F：kill 父 `t58` 後，一般子 `t59` 變 `finished/killed`，`--no-parent` 的 `t5b` 與 `--outlive-parent` 的 `t5c` 仍 live。→ Runner 一定要 `--no-parent`，否則 Planning tab 一關 Runner 就死 |
| V22 | 背景 terminal 內的環境找得到 `node`（v26.13.1）、`hc`、`herdr-app`、`git`、`opencode`、`claude`、`codex`，也能呼叫 `hc ls` 與 `herdr-app status`；`hc wait --output <字串>` 可等純程式印出特定文字 | 探針 G |
| V23 | 對**沒有** `herdr.space` 標籤的背景 terminal 執行 `herdr-app do terminal.peek --terminal <addr>` 回 `ok:true`，`herdr-app status` 的 `overlays` 由 `[]` 變 `["layout"]`；沒有新增 tab/space，terminal 的標籤與 `keep` 沒被改；`herdr-app do overlay.close` 後 `overlays` 回到 `[]` | 探針 E。**只驗證到狀態層**：`herdr-app shot` 兩次都回傳同一張舊畫面（視窗當時沒有重繪），所以「畫面上真的看得到」見 U6 |
| V24 | 已結束的 terminal 不佔用名稱：kill 後同名可再啟動 | 補充探針：`orca-probe-r` kill 後同名 `hc run` 成功（`t5k finished` + `t5m live`） |
| V25 | `opencode v2.3.0` 互動模式旗標只有 `--standalone / --server / --auto / --continue / --session / --prompt`，**沒有 `--model`**；預設連到「background service」 | `opencode --help`（只看說明，沒有啟動 session） |
| V26 | `codex [OPTIONS] [PROMPT]`、`-m`、`-c key=value`、`--no-daemon`、`--dangerously-bypass-approvals-and-sandbox` 存在；`claude [options] [prompt]`、`--model`、`--effort`、`--dangerously-skip-permissions` 存在 | `codex --help`、`claude --help`（2.1.311） |
| V27 | `programs.json` 有 `run` 的只有 `omp`、`codex`（`codex --no-daemon -c disable_paste_burst=true --dangerously-bypass-approvals-and-sandbox`）、`claude`（`claude --dangerously-skip-permissions`）；**沒有 opencode** | 讀 `~/.config/herdr-app/programs.json` 的 `run` 欄位 |
| V28 | Linked worktree 的 `git rev-parse --path-format=absolute --git-dir` = `<repo>/.git/worktrees/<name>`，`--git-common-dir` = `<repo>/.git`；可用 `--is-inside-work-tree`、`--is-bare-repository` 判斷 | 在本 worktree 實跑（git 2.54.0） |
| V29 | Mod API：`terminals()` 列出所有 core terminal 但**不會**觸發重繪（要配 timer）；`agents()` 只含視窗內的；`readTextFile` 上限 1 MiB；`writeTextFile(path,text,expected)` 與 `watchFolder` 只限本機；沒有任何 reduced-motion 設定；原生動畫有 `.loop()`、`.spin()`、`.frames()` | `herdr.d.ts:24-29,182-183,216-221,411-421`、`AGENTS.md:1020-1036`、`gpui-kit.d.ts:1209-1219`、`mods/orca-pane/main.js:32` 的註解；`grep -i "reduce"` 在三個檔案都沒有相關結果 |

**探針後清理（已確認）**：所有 `orca.probe=1` 的 terminal 都已 kill + rm（`hc ls --all --json --label orca.probe=1` → 空）；`hc ls` 的 live 清單與基準完全相同（`t1 t14 t25 t26 t4v t51`）；三個 space 的 tab 數仍是 1 / 2 / 3；`overlays` 為空；拋棄式 template 兩個檔案與為此建立的 `~/.config/herdr-core/` 空資料夾已刪除（`hc templates` 回空）；`/private/tmp/orca-probe-7d820812` 已刪除；core pid 沒變（沒有重啟）。探針期間 owner 的視窗曾短暫掛著一個 peek 疊層（約一分鐘，已關）。

### 6.2 UNVERIFIED（附確切探針）

| # | 宣稱（目前只是假設） | 為什麼沒驗 | 探針 |
|---|---|---|---|
| U1 | opencode 在 `hc` 底下會回報 OSC 7501（`working/done/blocked`） | 禁止啟動 opencode；owner 已延後（**卡關的前置測試 P1**） | 拋棄式 repo：`hc run --bg --no-parent --no-notify --name p1 --label orca.probe=1 --cwd <tmp> -- opencode --auto`，30 秒後 `hc get p1 --json` 看 `reported` 與 `status` |
| U2 | `opencode --prompt "<文字>"` 在互動 TUI 會自動送出該 prompt（不是只填進輸入框） | 同上（P1 的一部分） | `hc run --bg … -- opencode --auto --prompt "create the file ./ack.txt then stop"`，120 秒內檢查 `ack.txt` 是否出現；沒出現就 `hc read p1` 看畫面 |
| U3 | opencode 預設連 background service 時，`hc kill` terminal 之後 session 與它的工具指令是否真的停止；`--standalone` 是否讓它們留在 terminal 的 process tree 內 | 同上（P1 的一部分）。codex 有同類問題（`hc --skill`：「Codex must run with `--no-daemon` … or its commands execute outside hc」） | 讓 opencode 執行 `sleep 300 && touch late.txt`，途中 `hc kill`，5 分鐘後檢查 `late.txt` 是否出現；分別測有無 `--standalone` |
| U4 | `opencode --auto` 之下不會再出現任何權限或信任對話框（新資料夾第一次開啟時） | 同上（P1 的一部分） | U2 的探針在全新的 `/private/tmp` 資料夾執行，看 `hc read` 畫面 |
| U5 | `herdr-app do tab.close --id <tab>` 會關掉該 tab 並結束其 terminal，不會動到其他 tab；該 tab 是 space 唯一 tab 時會跳確認對話框 | 需要開一個看得到的 tab，本輪禁止新增 tab | owner 同意後：`herdr-app do tab.new --name orca-close-probe --argv '["sh"]'` → 記下 tab id 與 address → `herdr-app do tab.close --id <id>` → `hc get <addr>` 應為 finished，`herdr-app ls` 其他 tab 不變 |
| U6 | peek 疊層在畫面上真的顯示該背景 terminal 的內容，且「keep-as-tab」按鈕只有 user 點了才會建 tab | 視窗當時沒有重繪，`shot` 拿到舊畫面 | owner 在場時：起一個 `orca.probe=1` 的背景 `sh`，`herdr-app do terminal.peek --terminal <addr>`，`herdr-app shot` 看圖，再 `overlay.close` |
| U7 | `hc server restart` / core 當掉之後，Runner 與 worker 繼續活著、address 不變 | 手冊明文禁止動 user 的 core。文件依據：`hc --skill`「`hc update` … terminals keep running」「address: this terminal forever on this core」 | 只能在獨立的 `HC_SESSION` + 暫存 XDG 路徑起一個測試用 core 來測；設計上**不依賴**這點：恢復流程一律用標籤重新找 terminal（見第 5 節 E11、E18） |
| U8 | 重開機後，原本的 terminal 會以 `finished`（`holder_lost` / `stopped_by_restart`）留在 `hc ls --all`，address 不會被新 terminal 重用 | 不能重開機 | 同 U7 的測試用 core；設計上不依賴：找不到 terminal 與找到 finished 的處理相同（看 result 檔與 git 狀態） |
| U9 | mod 的 `writeTextFile` 可以寫 `~/.config/herdr-app/my-orca/config.json` | 需要改 mod 才能測，本輪只准編輯一個檔 | 實作第 9 步時在 inspector 內寫一次；失敗就改用 `fs/promises`（文件明載可寫 `~/.config/herdr-app` 底下） |
| U10 | `watchFolder(<my-orca 目錄>)` 在外部以 tmp + rename 覆寫 `state.json` 時會觸發 | 同 U9 | 實作第 8 步時驗；不觸發就退回 5 秒 timer（v1 現有做法） |
| U11 | claude 與 codex 在同一個 worktree 開新 session 時不會再跳信任對話框；`~/.agents/skills` 裡的 skill 兩者都看得到（codex 需另外複製到 `~/.codex/skills`） | 禁止啟動 claude、codex | 實作第 4 步由 owner 各開一次確認 `/herdr-planning` 出現 |
| U12 | codex 的 Planning terminal 的 `foreground.argv` 也保留 `-m` 與 `-c model_reasoning_effort=`（claude 的已由 V10 證實） | 這台目前沒有 live 的 codex terminal 可讀 | owner 開一個 codex tab 後 `hc get <addr> --json` 看 `foreground.argv` |

## 7. 五個最強質疑與回應

每一條的結論若是「承認」，對應的修改已經寫回第 2、3、4 節（標成 M1 到 M5）。

### 質疑 1：「ack 檔、result 檔都是請 AI 寫的。opencode 換一個比較弱的 model、不照指示做，你的流程就每個 task 都卡住。fake agent 的測試證明不了這件事。」

**部分承認，已修改（M1）。**
- 安全面站得住：不照做的後果永遠是「停下來問人」，不會是「誤判成功」。成功需要 result 檔 + Runner 自己重跑的測試 + git 檢查，三者都不是 agent 說了算。
- 可用性面確實有洞：ack 這個額外動作最容易被忽略，而它被忽略的代價是整個 task 被判 `undelivered`。
- **M1**：送達的證據改成三選一：ack 檔；或以 `hc send` 送達時回傳 `started:true`（探針 H 的實際輸出有這個欄位）；或 argv 啟動後 terminal 曾回報 `working`。只有「不回報 7501 又不寫 ack」的組合才會被判沒送達。這是把狀態回報當作多一項證據，不是讓 Runner 分成兩種模式。
- fake agent 測不出真 model 會不會照做，這點承認。所以唯一一次真 E2E 必須至少有 3 個 dev task，並把「每個 task 是否寫了 ack、result 是否合法」列進報告；E2E 的遵從率不到 3/3 就不能宣稱 AT-06、AT-07 通過。

### 質疑 2：「Runner『獨立驗收』是假的。測試指令是 Planning 的 AI 寫的，它寫 `true` 就全過。」

**承認，已修改（M2）。**
- Runner 驗證的是「一致性」（agent 說做完的東西，照事先講好的指令跑確實過），不是「測試寫得好不好」。品質靠三層：Tuning 是不同 model、全新 session 的獨立審查；`ready_for_review` 至少一條 acceptance 要有機器可跑的 `verify`；最後還有你本人的 review（Ready for Review 不等於已合併）。
- **M2**：(1) skill 在呼叫 `init` **之前**必須把 task 清單（id、標題、`test` 指令）與每條 acceptance 的 `verify` 指令列給 user，取得明確同意。Planning 本來就是你在場的互動階段（決定 3），而 tab 在 `init` 之後會被關掉，所以只能在之前看。(2) `init` 拒絕明顯的空測試（`true`、`:`、`exit 0`、單純的 `echo …`）。這只擋得住最懶的情況，README 會寫明 Runner 不判斷測試品質。

### 質疑 3：「用 terminal 名稱當鎖，是把正確性綁在一個不是為此設計的功能上。直接執行 `node my-orca.mjs run` 就繞過了；kill 之後名稱釋出時，舊的 process 真的死了嗎？」

**部分承認，已修改（M3）。**
- 證據：名稱唯一由 core 強制（V5：第二個同名啟動得到 `name_taken`）；`hc kill` 回傳時 terminal 已是 `finished`（V7 的回傳內容含 `finished_ms`，指令說明是「Returns the observed result」）；`kill -9` 後 core 也立即觀察到結束（V20）；結束後名稱可重用（V24）。相比之下，pidfile 在當掉後會留下過期的鎖，要另外寫「pid 還活著嗎、是不是同一個程式」的判斷，洞更多。
- 繞過的問題成立。**M3**：(1) `my-orca run` 啟動時檢查 `$HC_TERMINAL_ID` 存在，且 `hc get $HC_TERMINAL_ID` 的 `name` 等於 `orca-r-<wt-id>`，否則拒絕（S13 的測試）；(2) Runner 每次寫 `state.json` 之前先讀磁碟上的 `updated`，與自己上次寫的值不同就代表有第二個寫入者 → 不寫、印錯誤、結束。這等於把第一輪砍掉的 `revision` 檢查以最小形式加回來（一個欄位、三行），承認當初全砍是砍過頭。

### 質疑 4：「關 Planning tab 是破壞性動作，卻建立在沒驗證過的東西上：`tab.close` 的實際行為你沒測，`herdr-app ls` 的 JSON 形狀沒有版本保證，`turn` 的計數方式是你推測的。」

**承認，已修改（M4）。**
- 已有的證據：`turn` 的定義來自 schema（「Goes up each time the status leaves `working`」），探針 D、H 觀察到 `turn` 在離開 `working` 時由 0 變 1；`herdr-app ls` 確實列出每個 tab 的 `terminals` 與 `sub_agents`（本輪實際輸出）。九條檢查的失敗方向全部是「不關」：狀態在一輪中間抖動（例如先 `blocked` 再回 `working`）只會讓 `turn` 多加、結果是 `skipped:in_use`，不會誤關。
- 沒有的證據：`tab.close --id` 的實際效果（U5）。在沒測過的指令上預設開啟破壞性行為不對。
- **M4**：`close_planning_tab` 在程式碼裡先以預設 `false` 合入；實作第 4 步跑完 U5 探針且 AT-03 (a)、(b) 全過之後，才把預設改成 `true`（符合決定 5）。另外，`herdr-app ls` 的回應缺少預期欄位時視為 `skipped:app_unavailable`。

### 質疑 5：「你說『現在可以開工』，但唯一真正的 dev CLI 完全沒測過。P1 的四個未知數隨便一個結果不好，設計就得改。」

**大部分站得住；有一個結果確實會改變範圍，已明列（M5）。**
- Runner 本體不依賴 opencode 的任何行為：派發、等待、驗收、恢復全部可以用 `fake-agent.sh` 的兩種模式（回報、不回報）測完，這是本輪用探針 C、D、H 實際做過的事（V13 到 V19），不是推測。
- **M5**：把 P1 各種結果的對應寫死在 4.5：

| `--prompt` 會自動送出（U2） | 會回報 7501（U1） | 送達方式 |
|---|---|---|
| 是 | 不論 | argv（預設路徑） |
| 否 | 是 | 啟動 → 等它回報 `idle`（上限 60 秒）→ `hc send` 指標 prompt（V15、V19 已證實這條路對會回報的程式可行） |
| 否 | 否 | 啟動 → 畫面連續 3 次輪詢不變（上限 60 秒）→ `hc send`（V18：對不回報的程式也送得到）→ 以 ack 檔確認；沒有 ack 就 `needs_user`，不重送 |

- **會改變範圍的唯一結果**：U3 顯示不論有沒有 `--standalone`，kill 之後 opencode 的工具指令都還在跑。那樣「同時只有一個 worker」與「kill 之後工作樹靜止」都無法保證，不能靠 prompt 補救。此時停下來回報 owner，備案是 dev 改用 `codex --no-daemon`（`hc --skill` 明載這個旗標讓指令留在 hc 內），這違反規格「Development must use OpenCode」，需要 owner 決定。

## 8. 最終行動項目（含卡關的前置測試）

待補
