# Spec v2 收斂版（第二輪 CTO 收斂）

進度：已完成 4、6；未完成 1、2、3、5、7、8

日期：2026-11-16
分支：`worktree-workflow-stages-panel`
輸入：`docs/spec-v2.md`、`docs/spec-v2-review.md`、`docs/spec-v2-progress.md`

## 1. 結論與能否開工（哪些被卡住）

待補

## 2. AT-03 的處理（白話 + 精確規則 + 改寫後的 AT-03）

待補

## 3. owner 還需決定的核心問題（最多 3 個）與已委派的問題（預設 + 規則）

待補

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

**R-A 派發（防重派）**：先把 `dispatch{id, phase:"intent"}` 寫進 `state.json` → 寫 `dispatch/<id>.md` → `hc run --bg --no-parent --no-notify --json --name orca-d-<id> --label orca.run=<run_id> --label orca.dispatch=<id> --label orca.task=<task> --label orca.role=<dev|tuning> --cwd <toplevel> -- <CLI argv…> "<指標 prompt>"`（呼叫時拿掉 `HC_TERMINAL_ID`，V17）→ 把 address 寫回、`phase:"launched"` → 等 `results/<id>.ack`（上限 120 秒）→ `phase:"acked"`。名稱 `orca-d-<id>` 由 core 保證 live 期間唯一（V5），所以同一個 dispatch 不可能有兩個活的 worker；`name_taken` 視為「已經啟動過」，改走認養。派發前另外確認 `hc ls --json --label orca.run=<run_id> --label orca.role=dev`（以及 `tuning`）是空的，確保同時只有一個 worker。

**R-B 等待**：每 10 秒做兩件事：看 result 檔在不在、`hc get <address> --json`。不用 `hc wait`（V14：idle 時立刻返回會空轉；V6：不回報時只有逾時）也不用 `hc events`。這讓完成判定完全不依賴 OSC 7501：

| 觀察到 | 動作 |
|---|---|
| result 檔存在且 `dispatch` 欄位等於目前的 id | 進 R-C 驗收 |
| terminal 已 `finished`，沒有 result 檔 | 這次嘗試失敗（agent 結束但沒交結果）→ 存畫面到 `logs/` → `needs_user` |
| `status.state == "blocked"`（只有會回報的 CLI 才看得到） | `needs_user`（附 `kind`），terminal 留著給 user 看 |
| 超過硬上限（dev、tuning 預設各 60 分鐘） | `needs_user`（`timeout`），terminal 留著；不算失敗也不算成功 |
| 120 秒內沒有 ack 檔 | `needs_user`（`undelivered`），存畫面；**不自動重送** |
| `hc` 呼叫本身失敗（core 重啟中） | 退避重試最多 5 分鐘，之後 Runner 結束、不改狀態（UI 顯示「已停住，可恢復」） |

**R-C 驗收（只有 Runner 說了算）**：dev task 被接受的條件是全部成立：(1) result 檔是合法 JSON 且 `dispatch` 相符；(2) Runner **自己**在 worktree 重跑 `tasks.json` 裡該 task 的 `test` 指令，exit 0（上限 15 分鐘）；(3) `git status --porcelain` 是空的；(4) 目前 branch 沒變，且新的 `HEAD` 是上一個紀錄的 `head` 的後代（`git merge-base --is-ancestor`）。不成立 → 這次嘗試記為 `rejected:<原因>`；同一個 task 最多 2 次嘗試，第 2 次的指示檔附上第 1 次失敗的測試輸出（截到 16 KiB）；再失敗 → `needs_user`。接受後才 `hc kill` + `hc rm` 該 worker（先寫狀態、後清理）。

**R-D Git 保護**：Runner 只執行唯讀的 git 指令（`rev-parse`、`status --porcelain`、`merge-base --is-ancestor`、`log`）；從不 `checkout`、`reset`、`stash`、`clean`、`commit`、`push`。每次派發前檢查：branch 與紀錄相同、`HEAD` 等於紀錄的 `head`、工作樹乾淨；任一不成立 → `needs_user`（`tree_changed`），附 `git status` 輸出。`init` 要求工作樹乾淨（見 3.1 的 Q2）。

**R-E Tuning 與 rework**：所有 dev task 被接受後，用 `profile.argv` 起一個全新的 Tuning session。它寫 `reviews/<id>.json`：`verdict`（`pass | rework | needs_user`）、`criteria[]`（每條 acceptance 的 `id, pass, evidence`）、`new_tasks[]`。
- `pass` 成立的條件：`criteria` 涵蓋全部 acceptance 且都 `pass:true`；Runner 自己重跑每條有 `verify` 指令的 acceptance 且都 exit 0；工作樹乾淨；Tuning 期間 `HEAD` 沒動。→ `stage: ready_for_review`、`status: completed`。
- `rework`：`new_tasks` 1 到 10 個；ID 由 Runner 指定為 `R<cycle>-<nn>`（Tuning 不能自己取 ID，所以不會撞號）；`cycles + 1` 超過上限 → `needs_user`（`rework_exhausted`），否則 `cycles += 1`、新 task 進佇列，`stage` 維持 `tuning`。
- **Tuning 直接修**（規格允許，第一輪建議砍掉，這輪改回保留）：Tuning 可以自己 commit 小修正。Runner 看到 Tuning 期間 `HEAD` 前進，就把那份 review 視為過期、`cycles += 1`、再起一個全新的 Tuning session 重新驗收。同一個計數器，所以不會無限循環。保留的理由：Tuning 有全權限，「它改了檔案」這個情況本來就必須處理，處理方式剛好就是規格要的 revalidate，AT-13 因此可測。
- 上限在每次要 `cycles += 1` 之前才讀 `config.json`（1 到 9，預設 3，不合法就沿用舊值並記事件）。調低到小於目前 cycles 不會回溯判失敗，只是下一次 rework 請求會進 `needs_user`。計數器永不自動歸零。

**R-F 單一 Runner 與恢復**：Runner 由 `my-orca start` 以 `hc run --bg --no-parent --no-notify --name orca-r-<wt-id> --label orca.run=<run_id> --label orca.role=runner -- node <my-orca> run <wt-id>` 啟動；名稱唯一（V5）就是鎖，Runner 死掉名稱自動釋出（V24），沒有殘留的 lock 檔。**絕不加 `--keep`**（keep 會在程式消失後補一個 shell 佔住名稱）。Runner 開機時若 `state.dispatch` 非空，先對帳再做事：

| `hc ls --all --json --label orca.dispatch=<id>` | result 檔 | git | 動作 |
|---|---|---|---|
| 有 live 的 | － | － | 認養，回到 R-B |
| 有 finished 的，或查不到 | 有且合法 | － | 進 R-C |
| 有 finished 的，或查不到 | 沒有 | 乾淨且 `HEAD` 未動 | 沒留下任何東西，可安全重派（新的 dispatch id，嘗試次數 +1，受 2 次上限限制） |
| 有 finished 的，或查不到 | 沒有 | 髒或 `HEAD` 動了 | `needs_user`（`partial_changes`），附 `git status` |

`needs_user` 時 Runner 寫完狀態就結束。User 處理後按 inspector 的 Resume（= `my-orca start`）；Runner 開機看到 `needs_user` 會重跑 R-D 的檢查，通過才清掉並繼續。

**R-G 只清自己的東西**：Runner 會 kill / rm 的 terminal 只有兩種：帶 `orca.run=<本 run>` 標籤且 `orca.dispatch` 等於 state 紀錄的；以及第 2 節定義的那一個 Planning terminal。每次 kill 之前重新 `hc get` 核對標籤，並寫一筆 `kill` 事件。

### 4.5 三個 CLI 的啟動方式（P1 只影響表中 opencode 那一列）

| 角色 | argv | 依據 |
|---|---|---|
| Tuning（claude） | `claude --dangerously-skip-permissions --model <M> --effort <E> "<指標 prompt>"` | V10、V26、V27 |
| Tuning（codex） | `codex --no-daemon -c disable_paste_burst=true --dangerously-bypass-approvals-and-sandbox -m <M> -c model_reasoning_effort=<E> "<指標 prompt>"` | V26、V27；`foreground.argv` 是否保留這些旗標見 U12 |
| Dev（opencode） | `opencode --auto [--standalone] --prompt "<指標 prompt>"` | V25；`--prompt` 是否自動送出、是否需要 `--standalone` 由 P1 決定（U1 到 U4） |

Runner 本體**不得**依「有沒有回報 7501」分支；兩種結果的差別只在這張表（opencode 的旗標，以及送達方式是 `argv` 還是「啟動後 `hc send`」）。P1 兩種結果下的行為：

| | opencode 有回報 | opencode 沒回報 |
|---|---|---|
| 送達確認 | ack 檔 | ack 檔 |
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

待補

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

待補

## 8. 最終行動項目（含卡關的前置測試）

待補
