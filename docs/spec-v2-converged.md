# Spec v2 收斂版（第二輪 CTO 收斂）

進度：已完成 1 到 8 全部；P1 已跑完，階梯 5、7、8-lite 已自驗（V42 到 V45），第二輪審查見 8.2.6；P1（opencode 前置測試）已於 2026-11-16 跑完（V30 到 V33，結果寫回 3.1 Q1、4.5、6、8）；待 owner 回答 3.1 的 Q2、Q3，以及 8.2 的 E2E 安全審查

日期：2026-11-16
分支：`worktree-workflow-stages-panel`
輸入：`docs/spec-v2.md`、`docs/spec-v2-review.md`、`docs/spec-v2-progress.md`

## 1. 結論與能否開工（哪些被卡住）

**可以開工。** Runner、狀態檔、Planning skill、Tuning、UI 都不依賴 opencode 的行為，可以先用一個會模擬 agent 的 shell 腳本（`fake-agent.sh`）做完並測完；這一輪已經用同樣的方法在真的 core 上實測過派發、標籤、等待、`blocked`、kill、rm 與父子關係（第 6 節 V1 到 V29），並確認沒有留下任何 terminal、tab 或檔案。

**P1 已跑完（2026-11-16，model `omlx/LiquidAI--LFM3-1.7B-MLX-4bit`，結果見 V30 到 V33）：** opencode 會回報 7501、`--prompt` 會自動送出、新資料夾沒看到對話框；**不加 `--standalone` 時 kill 之後工具指令仍在跑（`late.txt` 出現），加了就不會**。所以 dev 的旗標定為 `opencode --auto --standalone --prompt "<指標 prompt>"`，「會改變範圍的結果」沒有發生。

**仍然沒有證據的只剩：**
1. 唯一一次真實 E2E，以及只能靠它證明的驗收項目（AT-10，與 AT-04、06、08、09、11、22 中「真的 opencode」那一半）。P1 只驗了單次小任務，不是 E2E。
2. AT-21 之中「opencode 卡在提問」的 `blocked` 分支：P1 沒有觸發任何權限詢問（U13）。
3. 換成其他 model 後 tool call 的穩定度（U14）：P1 的 1.7B 小模型每項只跑一次。

E2E 開跑之前要先過第 8.2 節的安全審查。

**與第一輪審查不同的地方（都有本輪的實測依據）：**
- **不用 hc template。** 實測發現 template 對不回報狀態的程式根本不送第一則訊息（等 60 秒後回報沒送出，V16）。改成啟動時用參數帶入一句「去讀這個檔案並照做」。
- **不用 lock 檔。** core 保證 live terminal 的名稱唯一（V5），Runner 與每個 worker 各用一個固定名稱，重複啟動會直接被 core 擋下。
- **不用 `hc wait`。** 它在 agent 閒置時會立刻返回（V14）。改成每 10 秒看一次結果檔與 terminal 狀態，這也讓「做完了沒」完全不依賴狀態回報。
- **「Planning 的 model 設定永遠拿得到」是錯的。** terminal 的 argv 是 shell 包裝，裡面還有 user 的第一則 prompt 全文（V10），不能整段存；model 也可能根本不在 argv 裡。改成只取白名單旗標，拿不到就要求明確指定。
- **Runner 必須用 `--no-parent` 啟動。** 實測子 terminal 會跟著父 terminal 一起死（V21）；否則 Planning tab 一關，Runner 就跟著沒了。
- **Tuning 的「直接小修」改回保留**，算一次 rework、並強制重新驗收。

**與 owner 決定有摩擦的地方（只標示，不重議）：**
- 決定 4：`programs.json` 裡沒有 opencode，沒有東西可沿用（→ 3.1 的 Q1）。另外要說清楚：worktree 不是沙盒。全權限的 agent 可以寫磁碟上任何你能寫的地方、可以 push、可以動同一個 repo 的其他 branch。Runner **能驗證**的只有三件事：本 worktree 的 branch 沒變、`HEAD` 是上一個紀錄點的後代、工作樹乾淨。被 git 忽略的檔案與 worktree 以外的一切，Runner 看不到（第 5 節 E48）。
- 決定 5：關 tab 的指令本輪無法實測（禁止新增 tab），所以這個功能先以「預設關閉」合入，探針與 AT-03 通過後才改成預設開啟；另外，若該 tab 是 space 裡唯一的 tab 就不關（否則會連 space 一起關）。
- 決定 2：設計在兩種結果下都成立（4.5 的對照表）；差別只在「卡住時多快被發現」與 inspector 顯示的狀態細緻度。

**本輪執行者**：Claude Fable 5.2（`claude-fable-5-2`，effort high；由本 session 自己的 terminal argv 確認，V10）。各個 WIP commit 的 `Co-Authored-By` 依任務指示寫的是「Claude Sonnet 5.5」，與實際模型不符，在此註明。

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

**Q1. opencode 用什麼旗標啟動？（旗標已由 P1 定案；只剩「誰指定 model」待決）**
決定 4 說「沿用 `programs.json` 的全權限參數」，但 `programs.json` 裡沒有 opencode（V27），沒有東西可沿用。
- **P1 實測結果（已定案建議）：`opencode --auto --standalone`**。`--auto`（「Auto-approve permissions that are not explicitly denied」，V25）；`--standalone` 必加，因為不加時 kill 之後工具指令仍會在 `opencode-pty daemon` 底下跑完（V32：`late.txt` 出現），「kill 之後工作樹靜止」與「同時只有一個 worker」都會被破壞。
- 理由：與決定 4 對 claude、codex 的立場一致；背景 session 沒人回答提問，不加 `--auto` 只會讓每個 task 卡到 60 分鐘上限。
- 你要知道的代價：opencode 互動模式沒有 `--model`（V25），dev 用的是 opencode 設定檔的預設 model，workflow 無法逐次指定。P1 是用專案層的 `opencode.json`（`{"model":"omlx/…"}`，放在拋棄式資料夾）指定的（V30）。真實 worktree 要不要由 Runner 寫這個檔，會讓工作樹變髒、違反 R-D，**需要 owner 決定**（預設：不寫，用 user 的設定檔預設 model；E2E 用拋棄式 repo，可以把 `opencode.json` 一起 commit 進去）。

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

Dev 與 Tuning **沒有** skill 也**沒有** hc template：它們的指示是 Runner 寫在狀態資料夾的 `dispatch/<dispatch-id>.md`，啟動時以 argv 帶入一句固定的指標 prompt（「讀 `<絕對路徑>` 並完全照做」）。這偏離規格的「三個 skill」與「Prefer Agent Templates」，理由是 V16：template 對不回報 7501 的程式根本不送第一則訊息，會讓整條派發路徑卡在 opencode 的前置測試上；argv 路徑對 claude（V10，App 自己就這樣啟動）與 codex（V26）已有依據，對 opencode 是 `--prompt`（V31）。

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

順序是：看到 result 檔 → 把畫面存到 `logs/` → **先 `hc kill` 該 worker** → 驗收 → 寫狀態 → `hc rm`。先 kill 再驗收，是因為 worker 交了結果之後若還在改檔，Runner 重跑的測試就是跑在會變動的工作樹上；worker 已宣告完成，結果都在檔案與 commit 裡，kill 不會損失已交付的東西。**但 `hc kill` 只結束 terminal 的程式與前景工作，脫離 process group 的程序（`setsid`、雙重 fork）會存活並繼續寫檔（V42）**，所以 kill 之後、驗收之前還要做 **M14 掃描**（見 4.9）：掃不乾淨就不得驗收，`needs_user`（`sweep_incomplete`）。這把規格的「CHECK RESULT → COMMIT STATE → CLEAN UP」中的「結束程式」提前一步，「移除紀錄（`rm`）」仍在寫狀態之後。

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

**R-G 只清自己的東西**：Runner 會 kill / rm 的 terminal 只有兩種：帶 `orca.run=<本 run>` 標籤且 `orca.dispatch` 等於 state 紀錄的；以及第 2 節定義的那一個 Planning terminal。每次 kill 之前重新 `hc get` 核對標籤，並寫一筆 `kill` 事件。**M13**：每個破壞性的 `hc` 指令（`kill`、`rm`、`server stop`、`server restart`）執行前，先讀 `hc server status --json` 的 `core.id`，必須等於 `state.core_id`（E2E 另設禁用清單：你的 core 的 id），否則拒絕並 `needs_user`（`core_mismatch`）；讀不到 id 一律視為拒絕。address（`t1`…）只在單一 core 內唯一，專屬 core 與你的 core 會撞號，所以不能只憑 address 下破壞性指令；程式碼：`my-orca/my-orca.mjs` 的 `guardedHc`。

### 4.5 三個 CLI 的啟動方式（P1 只影響表中 opencode 那一列）

| 角色 | argv | 依據 |
|---|---|---|
| Tuning（claude） | `claude --dangerously-skip-permissions --model <M> --effort <E> "<指標 prompt>"` | V10、V26、V27 |
| Tuning（codex） | `codex --no-daemon -c disable_paste_burst=true --dangerously-bypass-approvals-and-sandbox -m <M> -c model_reasoning_effort=<E> "<指標 prompt>"` | V26、V27；`foreground.argv` 是否保留這些旗標見 U12 |
| Dev（opencode） | `opencode --auto --standalone --prompt "<指標 prompt>"` | V25；P1 已驗：`--prompt` 自動送出（V31）、會回報（V30）、不加 `--standalone` 會漏（V32） |

Runner 本體**不得**依「有沒有回報 7501」分支；兩種結果的差別只在這張表（opencode 的旗標，以及送達方式是 `argv` 還是「啟動後 `hc send`」）。**P1 的實際結果是「有回報」且 `--prompt` 自動送出（送達方式 = argv）**，下表右欄（沒回報）只在日後換成不回報的 CLI 時才用得上，仍須用 `fake-agent.sh` 保持可測。P1 各種結果對應的送達方式見第 7 節質疑 5 的表。兩種結果下的行為：

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

### 4.9 介面定義（E2E 前必須釘死；由審查 advisor 提案，owner 未逐項核可，視為實作預設）

**`results/<id>.ack`**：空檔，worker 第一個動作 `: > <絕對路徑>`。**`results/<id>.json`**：`{"dispatch":"<id>","task":"T-01","status":"done|blocked","summary":"<=500 字","commits":["sha"],"test":{"cmd":"…","exit":0}}`。Runner 只信 `dispatch`；`status != done` 立刻 `rejected:agent_blocked`（不花一次測試）。**worker 必須最後才寫這個檔**（在最後一個 commit 之後）。

**`reviews/<id>.json`**：`{"dispatch","verdict":"pass|rework|needs_user","criteria":[{"id":"AC-1","pass":true,"evidence":"…"}],"new_tasks":[{"title","test","deps":["T-03","@1"]}],"summary"}`；`@n` = 同一批中第 n 個新 task（Tuning 無法預先知道 `R<cycle>-<nn>`）。

**`tasks.json`**：`{"schema":1,"tasks":[{"id":"T-01","title","test","deps":[]}],"acceptance":[{"id":"AC-1","text","verify":"cmd"},{"id":"AC-2","text","manual":true}]}`；acceptance id 為 `^AC-\d+$`；所有指令以 `sh -c`、cwd = `toplevel` 執行。

**指標 prompt**：`Read <abs>/dispatch/<id>.md and follow it exactly. Do nothing else first.`

**`dispatch/<id>.md`**：由 Runner 預先渲染，所有 id 與絕對路徑都已代入，不留佔位符。步驟固定：(1) `: > results/<id>.ack`；(2) 做 task（標題與 `test` 指令）；(3) 跑 `test`；(4) `git add -A && git commit -m "orca(<task>): …"`；(5) 用單一 `cat > results/<id>.json <<'EOF'` 寫結果；(6) 停。再附 D3 的禁止事項，並**明文禁止 `nohup`、`&`、`setsid`、常駐伺服器與 watcher**。重派時附上一次失敗輸出（16 KiB）。小模型需要這種可直接複製的形式。

**`my-orca` 結束碼**：0 成功（含第二個 `start` 遇到 `name_taken`）；1 拒絕或驗證失敗；2 用法錯誤；3 環境問題（沒有 `hc` / App）。`init` 以 `--handoff <path> --tasks <path> [--model … --effort …] [--no-start]` 接收輸入。

**`needs_user.code` 完整清單**：`undelivered`、`spawn_failed`、`exit_without_result`、`stopped_without_result`、`timeout`、`blocked`、`task_failed`（同一 task 2 次被拒）、`bad_review`（Tuning 2 次產生不合法 review，含「說 pass 但 Runner 重跑 verify 失敗」）、`tree_changed`、`partial_changes`、`unknown_worker`、`identity`、`rework_exhausted`、`rework_too_large`、`blocked_tasks`、`worktree_moved`、`worktree_missing`、`hc_incompatible`、`core_mismatch`（M13）、`sweep_incomplete`（M14）。`status: failed` v1 不使用。

**`events.jsonl`**：每行 `{"ts","type","run","task","dispatch","detail"}`；type：`runner_start`、`intent`、`launched`、`acked`、`result_seen`、`accepted`、`rejected`、`kill`（必須帶目標 address 與 `created_ms`）、`rm`、`review`、`rework`、`needs_user`、`resumed`、`planning_closed`、`config_ignored`、`sweep`（M14：只記被清的 PID 與結果，不記環境內容）、`runner_exit`。

**`config.json` 鍵與範圍**：`max_rework_cycles` 3（1–9）、`close_planning_tab` false、`ack_timeout_s` 120（10–600）、`dev_timeout_min` 60（1–240）、`tuning_timeout_min` 60（1–240）、`test_timeout_min` 15（1–60）、`poll_s` 10（2–60）、`hc_retry_min` 5（1–30）、`stopped_grace_s` 60（10–600）。

**對 4.4 的修正（M6 到 M15，來自 8.2 的邏輯審查，已併入本文的規則；M13 到 M15 已有程式與測試：`my-orca/my-orca.mjs`、`node --test my-orca`）：**
- **M6（R-C）**：接受條件加上「`git rev-list --count <記錄的 head>..HEAD` ≥ 1」，因為 `is-ancestor X X` 也回 0，worker 什麼都沒做、測試本來就過時會被誤判成功。順序改為：porcelain 檢查 → 跑測試 → porcelain 再查一次，第二次髒 = `rejected:test_dirtied_tree`（測試產物必須被 `.gitignore` 涵蓋）。
- **M7（R-B／R-C）**：看到 result 後，先等 terminal 離開 `working`，或連續 2 次輪詢 `HEAD` 與 porcelain 都沒變（上限 60 秒），再 kill；**kill 之後才解析 result**。避免 worker 寫完結果、正在 `git commit` 時被殺。
- **M8（R-B 的 60 秒規則）**：靜止時間用 `hc get` 的 `status_ms` 算（`now - status_ms`，僅在狀態不是 `working` 時），且 `turn` 要等於最後一次觀察到 `working` 時的值；每次輪詢先看 result 檔；**看到第一次 `working` 或 ack 之前不啟動這個計時**（啟動時的 idle 不算停住）。
- **M9（D6／C4／S8）**：逾時計時存「累計經過時間」而不是單調時鐘起點（Runner 重啟後單調時鐘無意義）。**Resume 是一次明確的 user 介入：給新的時間預算，且該 task 再允許 2 次嘗試**（D12 的「沒有 user 介入不得有第 3 次」由此界定）。
- **M10（R-A／R-F）**：`needs_user` 之後被保留的 worker，Resume 時**先看 result 檔，再明確 kill（過 R-G 的標籤核對）**，之後才重派；否則 R-A「同一時間只有一個 worker」的檢查會擋住自己。
- **M11（R-E）**：Tuning 回 `pass`、但 Runner 重跑 `verify` 失敗 → 這份 review 不合法，計入 E20 的 2 次上限，之後 `needs_user`（`bad_review`）。新增 F 測試。
- **M12（驗證判準）**：E2E 的「乾淨」判準是「沒有 **live** 的 runner／dev／tuning terminal」。Runner 結束後 finished 的紀錄會留在 `hc ls --all`（`hc rm` 由 `my-orca stop` 或下次 `start` 清理），不能要求 `--all` 為空。
- **M13（R-G，破壞性指令前的 core 斷言）**：`kill`、`rm`、`server stop`、`server restart` 之前，先讀 `hc server status --json` 的 `core.id`；不等於 `state.core_id`、在禁用清單內、或讀不到，一律拒絕（`core_mismatch`），不執行該指令。唯讀指令（`get`、`ls`、`read`）不檢查。專屬 core 的操作一律在同一個命令內帶著 `HC_SESSION`。
- **M14（R-C，kill 之後的程序掃描）**：Runner 啟動 worker、測試指令、preflight 時都帶環境變數 `ORCA_DISPATCH=<dispatch id>`。kill 之後以 `ps -Eww -o pid=,lstart=,command=`（`LC_ALL=C`）找出帶這個標記的程序（整個 token 相符，所以 `d1` 不會誤中 `d10`；排除 Runner 自己），**kill 之前重新讀一次並核對 PID 與啟動時間都沒變**（避免 PID 被重用而誤殺），前兩輪 `SIGTERM`、之後 `SIGKILL`，最多 4 輪，最後重掃。掃不乾淨 → 不得驗收、`needs_user`（`sweep_incomplete`），保留證據。只記 PID，不存 `ps` 的原始輸出（含環境內容）。**限制**：這是合作式清理，不是邊界：清空環境變數的程序、掃描與 kill 之間才 fork 的程序都會漏；macOS only（Linux 的 `ps` 選項不同，v1 延後）。
- **M15（R-E，rework task 的信任邊界）**：Tuning 產生的 `new_tasks` 在入列前套用與 D14 同一組結構檢查：`title` 非空、`test` 非空且不是空測試（`true`、`:`、`exit 0`、單純 `echo`）、`deps` 只能是既有 id 或 `@n`（同一批中**排在前面**的第 n 個，所以不可能成環）、1 到 10 個。另外 `test` 不得含網路、提權或 worktree 外路徑的樣式（`curl`、`wget`、`sudo`、`ssh`、`git push`、`npm install`、`pip install`、`$HOME`、`~/`、`..` 等；**這只是警報，不是邊界**，`sh script.sh` 能藏任何東西）。失敗 → 這份 review 不合法，計入 E20 的 2 次上限（`bad_review`）；超過 10 個 → `rework_too_large`。通過的 task 帶 `preflight:"pending"`，**必須先通過沙盒預檢（8.2.6）才能被派發或執行**（`isRunnable`），Runner 不得在沒有沙盒的情況下直接執行 Tuning 寫的指令。

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
| E50 | opencode 的 background service 讓工具指令活在 terminal 之外 | **已驗證（V32）**：不加 `--standalone` 會漏，加了不會；dev 一律帶 `--standalone`。整棵 process tree 是否殺乾淨見 U15（`nohup … &` 已驗，`setsid`／雙重 fork 未驗） | 4.5 的旗標 | V32、U15 |
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
| V30 | **opencode 會回報 7501，且 model 可用專案層 `opencode.json` 指定。** 在拋棄式 git repo（含 `opencode.json` = `{"model":"omlx/LiquidAI--LFM3-1.7B-MLX-4bit"}`）以 `env -u HC_TERMINAL_ID -u HC_SCOPE hc run --bg --no-parent --no-notify --json --name orca-p1 --label orca.probe=1 --cwd <repo> -- opencode --auto --prompt "…"` 啟動；30 秒後 `hc get` → `reported:true, status:{app:"opencode",state:"idle"}, turn:1`；工作中是 `state:"working"` 且帶 `title`（`Bash sleep 45, touch late.txt`）。`hc read` 畫面底列顯示 `Build auto · LiquidAI--LFM3-1.7B-MLX-4bit oMLX` | 實跑（opencode v2.3.0，hc 0.1.21）；`opencode models` 列有 `omlx/LiquidAI--LFM3-1.7B-MLX-4bit` |
| V31 | **`--prompt` 在互動 TUI 會自動送出。** prompt 要求建立 `./ack.txt` 內容 `ok`，30 秒內檔案出現且內容為 `ok`；`hc get` 的 `first_message` 為 `null`（沒有透過 hc 送訊息） | 同 V30 |
| V32 | **不加 `--standalone`：`hc kill` 之後工具指令繼續跑；加了就停。** 兩個 worker 各被要求執行 `sleep 45 && touch late.txt`，跑到一半各自 `hc kill`：不加的那個，`zsh -c "sleep 45 && touch late.txt"` 的父程序是 `opencode-pty daemon`（`opencode serve --service` 之下，ppid 1 的背景服務），kill 後 `sleep` 仍在，50 秒後 `late.txt` 出現；加 `--standalone` 的那個 kill 後 `sleep` 消失、`late.txt` 沒出現。與 `hc --skill` 對 codex 的 `--no-daemon` 警告同類 | 同 V30，`ps -o pid,ppid,command`、`pgrep -fl "sleep 45"`、`ls late.txt` |
| V33 | 新資料夾（`/private/tmp` 下）以 `--auto` 啟動，`hc read` 的畫面沒有任何權限或信任對話框；P1 各探針 kill + rm 後，`hc ls` 與基準完全相同、`hc ls --all --label orca.probe=1` 為空、repo 無變動。**限制**：只看了一個新資料夾、一個 model、一次 | 同 V30 |
| V34 | **worker 讀寫 cwd 以外的隱藏資料夾，`--auto` 不會擋。** 拋棄式 repo 之外建 `<scratch>/ext/.my-orca/{dispatch,results}/`，`dispatch/d1.md` 寫「先建空檔 `results/d1.ack`，再建 `results/d1.json`（含 `{"dispatch":"d1","status":"done"}`），然後停」；prompt 為 `Read <abs>/dispatch/d1.md and follow it exactly.`；25 秒內兩個檔案都出現且 JSON 內容正確。**限制**：1.7B、一次；沒測過 `~/.config/herdr-app/` 的真實路徑 | 實跑（同 V30 的環境） |
| V35 | **`--standalone` 下 `nohup sh -c 'sleep 40 && touch late2.txt' &` 在 `hc kill` 後也被清掉**：kill 前 `pgrep` 看得到 `sh -c sleep 40` 與 `sleep 40`，kill 後兩者消失，再等 45 秒 `late2.txt` 不存在。**限制**：沒測 `setsid`（macOS 沒有這個指令）、雙重 fork、常駐伺服器 | 實跑 |
| V36 | **專屬 core 可行且與你的 core 完全隔離。** `HC_SESSION=oe2e` + 暫存 `XDG_CONFIG_HOME/STATE_HOME/DATA_HOME` 下，`hc server status` 會自動起一個新 core（id 前綴 `7e3ba` 不等於你的 `4d8f7`），`hc ls` 為空、看不到你的 terminal。**socket 路徑上限 103 bytes**：session 與 XDG 路徑要很短（用 `/private/tmp/oe-e2e`；scratchpad 的長路徑直接報錯 `socket path … too long`）。只在同一個命令內帶著 `HC_SESSION` 執行 `hc server stop` 才停得掉它；停掉後你的 core 的 id 與 7 個 live terminal 都沒變 | 實跑；停機前先比對 core id 不等於你的 id |
| V37 | **scratch XDG 會被 terminal 內的程式繼承，opencode 因此壞掉。** 在專屬 core 的 terminal 內直接跑 opencode：它去 `$XDG_DATA_HOME/opencode` 建資料夾（`EPERM: mkdir …/oe-e2e/data/opencode`），而且會找不到你 `~/.config` 裡的 provider 設定。**worker 必須以 `env -u XDG_CONFIG_HOME -u XDG_STATE_HOME -u XDG_DATA_HOME` 啟動**，同時保留 `HC_SESSION`／`HC_TERMINAL_SOCKET`。HOME 沒動，claude／codex 的憑證在 HOME 底下，推論不受影響（未實測 claude／codex 在專屬 core 內啟動） | 實跑 |
| V38 | **sandbox-exec 黑名單式 profile 可行**：`(version 1)(allow default)(deny file-write*)(allow file-write* (subpath <repo>)(subpath <scratch>)(subpath ~/.local/share/opencode)(subpath ~/.local/state/opencode)(subpath ~/.cache/opencode)(subpath /private/var/folders)(literal /dev/null)(literal /dev/tty)(regex #"^/dev/(tty\|pty)"))(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))`。`hc run … -- env -u XDG_… sandbox-exec -f <profile> opencode --auto --standalone --prompt …` 在專屬 core 內：回報 `{app:opencode,state:idle}`、`ack.txt` 建立、model 為 `LiquidAI--LFM3-1.7B-MLX-4bit`、omlx（`127.0.0.1:8000`）可連。**坑**：只放行 `localhost:8000` 會得到 `EPERM: Transport`（opencode 的 TUI 要連它自己的 `--standalone` 本機伺服器，埠隨機），所以必須放行整個 loopback；`(allow network* … (remote unix-socket))` 反而讓外網通了（`curl example.com` 回 200），不可加。`hc run` 回傳的 `agent` 欄位是啟動時的程序名（`env`／`sandbox-exec`），**不是 `opencode`**，Runner 不能依賴它，只能看 `status.app` | 實跑 |
| V39 | **sandbox 實際擋得住的東西**：直接在 sandbox 內 `touch ~/oe-canary.txt` 得到 `Operation not permitted`；`curl https://example.com` 得到 `000`；repo 內寫入正常；omlx 回 HTTP 401（連得到，沒帶 key）。由 opencode 的 bash tool 執行時：`curl example.com` 的結果檔為 `000`，`~/oe-canary2.txt` 不存在（無法分辨是 `touch` 被擋還是小模型沒執行，直接測試才是證據）。**限制**：讀取不受限制、環境變數沒清、loopback 全開（包含你的 opencode service `127.0.0.1:49374`）、unix socket 被 deny 但不代表所有 IPC 都被擋 | 實跑 |
| V40 | U15 再驗一項：sandbox + `--standalone` 下，`sh -c '(sleep 40 && touch late3.txt) &'`（子 shell 背景化）在 `hc kill` 後 `pgrep` 為空、`late3.txt` 不存在。**仍未驗**：真正脫離 process group 的 daemon（`setsid`、常駐伺服器） | 實跑 |
| V41 | **沙盒只放行 worktree 目錄時，linked worktree 裡的 `git commit` 會失敗**：`fatal: Unable to create '<主 repo>/.git/worktrees/<name>/index.lock': Operation not permitted`（寫檔到 worktree 目錄本身正常）。額外放行 `git rev-parse --absolute-git-dir` 與 `--git-common-dir` 兩個 subpath 後 `git add`／`git commit` 成功。**代價**：common-dir 可寫 = worker 理論上能改同一個 repo 的 objects 與其他分支的 refs（我試著 `git branch -f main` 被 git 自己的規則擋下，因為 `main` 被另一個 worktree checkout；**不是沙盒擋的**，沒有被 checkout 的分支沒有這層保護，未實測）。另外，worker 要寫 `ack`／`result` 的狀態資料夾（在 `~/.config/herdr-app/my-orca/<wt-id>/results/`）不在上面 V38 的放行清單裡，**必須另外放行，而且只放行 `results/` 這個子資料夾**，否則每個 dispatch 都會被判 `undelivered`；放行整個 `my-orca/` 則 worker 可以改 `state.json` | 實跑 + 推論（狀態資料夾那半是推論，V34 的測試資料夾剛好在放行範圍內） |

**探針後清理（已確認）**：所有 `orca.probe=1` 的 terminal 都已 kill + rm（`hc ls --all --json --label orca.probe=1` → 空）；`hc ls` 的 live 清單與基準完全相同（`t1 t14 t25 t26 t4v t51`）；三個 space 的 tab 數仍是 1 / 2 / 3；`overlays` 為空；拋棄式 template 兩個檔案與為此建立的 `~/.config/herdr-core/` 空資料夾已刪除（`hc templates` 回空）；`/private/tmp/orca-probe-7d820812` 已刪除；core pid 沒變（沒有重啟）。探針期間 owner 的視窗曾短暫掛著一個 peek 疊層（約一分鐘，已關）。

### 6.2 UNVERIFIED（附確切探針）

| # | 宣稱（目前只是假設） | 為什麼沒驗 | 探針 |
|---|---|---|---|
| U1 | ~~opencode 會回報 OSC 7501~~ **已驗證 → V30** | | |
| U2 | ~~`--prompt` 自動送出~~ **已驗證 → V31** | | |
| U3 | ~~kill 之後工具指令是否停止~~ **已驗證 → V32**（不加 `--standalone` 會漏，加了不會） | | |
| U4 | ~~`--auto` 之下沒有對話框~~ **部分驗證 → V33**（只看了一個新資料夾；其他情況仍未知） | | |
| U5 | `herdr-app do tab.close --id <tab>` 會關掉該 tab 並結束其 terminal，不會動到其他 tab；該 tab 是 space 唯一 tab 時會跳確認對話框 | 需要開一個看得到的 tab，本輪禁止新增 tab | owner 同意後：`herdr-app do tab.new --name orca-close-probe --argv '["sh"]'` → 記下 tab id 與 address → `herdr-app do tab.close --id <id>` → `hc get <addr>` 應為 finished，`herdr-app ls` 其他 tab 不變 |
| U6 | peek 疊層在畫面上真的顯示該背景 terminal 的內容，且「keep-as-tab」按鈕只有 user 點了才會建 tab | 視窗當時沒有重繪，`shot` 拿到舊畫面 | owner 在場時：起一個 `orca.probe=1` 的背景 `sh`，`herdr-app do terminal.peek --terminal <addr>`，`herdr-app shot` 看圖，再 `overlay.close` |
| U7 | `hc server restart` / core 當掉之後，Runner 與 worker 繼續活著、address 不變 | 手冊明文禁止動 user 的 core。文件依據：`hc --skill`「`hc update` … terminals keep running」「address: this terminal forever on this core」 | 只能在獨立的 `HC_SESSION` + 暫存 XDG 路徑起一個測試用 core 來測；設計上**不依賴**這點：恢復流程一律用標籤重新找 terminal（見第 5 節 E11、E18） |
| U8 | 重開機後，原本的 terminal 會以 `finished`（`holder_lost` / `stopped_by_restart`）留在 `hc ls --all`，address 不會被新 terminal 重用 | 不能重開機 | 同 U7 的測試用 core；設計上不依賴：找不到 terminal 與找到 finished 的處理相同（看 result 檔與 git 狀態） |
| U9 | mod 的 `writeTextFile` 可以寫 `~/.config/herdr-app/my-orca/config.json` | 需要改 mod 才能測，本輪只准編輯一個檔 | 實作第 9 步時在 inspector 內寫一次；失敗就改用 `fs/promises`（文件明載可寫 `~/.config/herdr-app` 底下） |
| U10 | `watchFolder(<my-orca 目錄>)` 在外部以 tmp + rename 覆寫 `state.json` 時會觸發 | 同 U9 | 實作第 8 步時驗；不觸發就退回 5 秒 timer（v1 現有做法） |
| U11 | claude 與 codex 在同一個 worktree 開新 session 時不會再跳信任對話框；`~/.agents/skills` 裡的 skill 兩者都看得到（codex 需另外複製到 `~/.codex/skills`） | 禁止啟動 claude、codex | 實作第 4 步由 owner 各開一次確認 `/herdr-planning` 出現 |
| U12 | codex 的 Planning terminal 的 `foreground.argv` 也保留 `-m` 與 `-c model_reasoning_effort=`（claude 的已由 V10 證實） | 這台目前沒有 live 的 codex terminal 可讀 | owner 開一個 codex tab 後 `hc get <addr> --json` 看 `foreground.argv` |
| U13 | opencode 在 `--auto` 下遇到「明確 deny」的權限或提問時，會回報 `blocked`（`kind:question` 之類）而不是默默卡住或自己跳過 | P1 的 1.7B 模型沒有觸發任何權限詢問 | 拋棄式 repo 放 `opencode.json` 的 `permission` 設 deny 某個指令，prompt 要求執行它；看 `hc get` 的 `status` 與 `hc read` 畫面；沒回報就把 AT-21 的 `blocked` 分支對 opencode 標 NOT TESTED |
| U14 | 較大或不同的 model 下，opencode 仍照指示寫 ack、result、commit（遵從率） | P1 每項只跑一次、只用 1.7B | E2E 的 3 個 dev task 逐一記錄（第 7 節質疑 1）；另在 fake 之外加跑「模型不照做」的情境，確認結果永遠是 `needs_user` 而非誤判成功 |
| U15 | `--standalone` 下 `hc kill` 是否殺乾淨「整棵」process tree。**已驗證（V42）**：`nohup &`（V35）與子 shell 背景化（V40）會被清掉，但**真正脫離 process group 的 daemon（`setsid` 加雙重 fork）在 kill 後存活**；用環境標記掃描可清（M14）。常駐伺服器未驗。`hc --skill` 明載「Unix 上 kill 不會清掉 detached 的程式」 | V32 只驗了前景；V35 加驗 `nohup &` | 讓 opencode 執行 `nohup sh -c 'sleep 60 && touch late2.txt' &` 與 `setsid` 版本，途中 kill，檢查 `late2.txt`；若會漏，R-C 的「kill 後工作樹靜止」不成立，要加驗收前的 process group 檢查或在 README 列為已知限制 |

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

| `--prompt` 會自動送出（V31） | 會回報 7501（V30） | 送達方式 |
|---|---|---|
| 是 | 不論 | argv（預設路徑）**← P1 實測屬於這一列** |
| 否 | 是 | 啟動 → 等它回報 `idle`（上限 60 秒）→ `hc send` 指標 prompt（V15、V19 已證實這條路對會回報的程式可行） |
| 否 | 否 | 啟動 → 畫面連續 3 次輪詢不變（上限 60 秒）→ `hc send`（V18：對不回報的程式也送得到）→ 以 ack 檔確認；沒有 ack 就 `needs_user`，不重送 |

- **P1 實測結果（2026-11-16）：** U2 是「是」、U1 是「會回報」→ 送達方式 = argv（第一列）。**U3 的壞結果沒有發生**：加了 `--standalone`，kill 之後工具指令會停（V32）。下面保留原本的備案，只在日後 opencode 版本改變行為時用。
- **會改變範圍的唯一結果**：U3 顯示不論有沒有 `--standalone`，kill 之後 opencode 的工具指令都還在跑。那樣「同時只有一個 worker」與「kill 之後工作樹靜止」都無法保證，不能靠 prompt 補救。此時停下來回報 owner，備案是 dev 改用 `codex --no-daemon`（`hc --skill` 明載這個旗標讓指令留在 hc 內），這違反規格「Development must use OpenCode」，需要 owner 決定。

## 8. 最終行動項目（含卡關的前置測試）

執行順序：0 → 1 → 2 →（3、6、8 可平行）→ 4 → **5（卡關）** → **7（卡關）** → 9 → 10。「誰」一欄：**sub** = 可交給實作 subagent 獨立完成；**owner** = 需要 owner 本人。

| # | 工作 | 完成標準 | 誰 | 卡關？（P1 已完成；現在的閘門是 8.2） |
|---|---|---|---|---|
| 0 | 回答 3.1 的 Q1、Q2（Q3 可晚到第 8 步之前） | 三個答案寫進本檔 3.1 | owner | 否 |
| 1 | `my-orca` 的純邏輯：state 的讀寫（tmp + rename、`updated` 檢查）、「下一步」的選擇規則、handoff 檢查（D14）、profile 解析（白名單旗標）、secrets 掃描（D15）、設定值檢查 | `node --test` 通過，涵蓋第 5 節所有標 **T** 的列；不需要 core 就能跑 | sub | 否（Q2 未答時先照建議值「拒絕髒的工作樹」做） |
| 2 | `fake-agent.sh`（模式：回報、不回報、`block`、不理 prompt、結束不交結果、commit 後死掉、交結果後繼續寫檔）+ Runner 迴圈（R-A 到 R-G），dev 與 tuning 的 argv 先指向 fake | 第 5 節所有標 **F** 的列在「回報」與「不回報」兩種模式都通過（S5 到 S20、C1 到 C11、E 開頭的 F 列）；測試結束後 `hc ls --all --json --label orca.role=dev`（以及 `tuning`、`runner`）為空，`herdr-app ls` 的 tab 數與測試前相同 | sub | 否 |
| 3 | `herdr-planning` skill + `my-orca init` 串接（M2 的事前確認、印出 profile） | 用固定的範例 handoff 跑 `my-orca init --check`：合格的回 0、每種不合格的回非零並指出位置；owner 各開一次 claude 與 codex，確認 `/herdr-planning` 出現（U11），並用 `hc get` 確認 codex 的 `foreground.argv` 含 model 旗標（U12） | sub 寫；owner 確認約 5 分鐘 | 否 |
| 4 | Planning tab 的關閉（第 2 節），先以預設關閉合入；跑 U5 探針與 AT-03 (a)、(b)、(c)；通過後把預設改成開啟 | U5 的結果寫回 6.2；AT-03 四小項各有 `hc get` 與 `herdr-app ls` 的前後輸出為證 | sub 實作；**owner 要在場並同意在視窗開一個測試 tab** | 否 |
| ~~5~~ | ~~前置測試 P1（opencode）~~ **已完成（2026-11-16）**：U1 到 U4 的結果見 V30 到 V33；4.5 的 opencode 那一列已填 `--auto --standalone`、送達方式 argv。**未做的部分另列 U13、U14、U15** | U13（`blocked`）、U15（整棵 process tree）在 E2E 前補測 | sub | 否 |
| 6 | Tuning 的啟動（由 profile 組出 claude / codex 的 argv）、rework、直接修算一次 cycle、`ready_for_review` 閘門 | 用 fake tuning 通過 S16、S17、E19、E20、E60、C9；組出的 argv 與 4.5 的表逐字相符（單元測試） | sub | 否 |
| **7** | **唯一一次真 E2E**：拋棄式 repo，至少 3 個 dev task，加 1 條故意不過的 acceptance 以觸發 1 輪 rework | AT-04、06、07、08、09、10、11、14、20、22 各附 `hc get` 輸出、`git log`、`state.json`；3 個 dev task 的 ack 與 result 遵從率 3/3（第 7 節質疑 1）；run 前後不帶 `orca.run` 標籤的 terminal 完全相同 | **owner**（會花額度，需同意時間點）；sub 可協助整理證據 | 否（P1 已完成）；**但必須先過 8.2 的安全審查，且 owner 同意時間點** |
| 8 | UI：改寫 `mods/orca-workflow`（`model.js` + 測試、inspector、`props().strip` 的四燈列），`layouts/orca.json` 加一個 block | `node --test mods/orca-workflow` 通過；`herdr-app check mods/orca-workflow` 通過；對「沒有 run、進行中、`needs_user`、`ready_for_review`、Runner 停住」五種固定的 `state.json` 各有一張 `herdr-app shot`，由人看過；從 inspector 按 Peek 看得到背景 terminal 且 `herdr-app ls` 沒有多出 tab（U6、U10；AT-15、16、17） | sub；看圖需要人；位置需要 Q3 | 否（用固定的 state 檔開發，不需要真的 run） |
| 9 | UI 改 rework 上限、Resume / Stop 按鈕 | 輸入 0、10、非數字被擋；合法值寫進 `config.json` 且下一次 rework 判斷採用（U9；AT-18） | sub | 否 |
| 10 | README 一節 + 22 條 AT 的結果表 | 每條 AT 標 PASS / FAIL / NOT TESTED 並附證據位置；AT-03、AT-22 用第 2 節改寫後的版本；已知限制列出 E6、E10、E37、E48、E49 與 reduced-motion | sub | 第 7 步未做時，相關 AT 標 NOT TESTED |

### 8.1 每條 AT 靠什麼證明

| AT | 證明方式 | 是否等第 7 步（E2E） |
|---|---|---|
| 01 | 第 1 步（profile 解析的單元測試）+ 第 3 步 owner 的 `hc get` 確認 | 否 |
| 02 | 第 1 步（D14） | 否 |
| 03（改寫） | 第 4 步 | 否 |
| 04 | 機制：第 2 步（V2 已證實不帶標籤就不進視窗）；真 opencode：第 7 步 | 真 opencode 的部分要等 |
| 05、07、12、13、14、19、20 | 第 2、6 步（fake agent） | 否 |
| 06、08、11 | 第 2、6 步 + 第 7 步 | 真 opencode 的部分要等 |
| 09 | 第 6 步（argv 逐字比對）+ 第 7 步（Tuning terminal 的 `hc get`） | 第 7 步的部分要等 |
| 10 | 第 7 步 | 是 |
| 15、16、17、18 | 第 8、9 步（`check` + `shot` + 人看圖；不宣稱全自動） | 否 |
| 21 | 第 2 步兩種模式；opencode 的 `blocked` 分支待 U13：沒回報就標 NOT TESTED | 否；`blocked` 分支要等 U13 |
| 22（改寫） | 第 2 步 + 第 7 步 | 第 7 步的部分要等 |

### 8.2 E2E 安全審查（三位 advisor，2026-11-16；全部唯讀、沒有啟動任何 agent）

審查角度：破壞範圍、Runner 邏輯與競態、規格完整性。引述 advisor 的內容中，凡我沒有自己驗證的，都標「advisor 讀到」。我自己驗證過的：`hc --skill` 明載測試需要專屬 `HC_SESSION` 與暫存 XDG 路徑、kill 不清 detached 程式；`/usr/bin/sandbox-exec` 存在；V34、V35（本檔 6.1）。

#### 8.2.1 風險與處置（按嚴重度）

| # | 風險 | 規格現況 | E2E 前的處置 |
|---|---|---|---|
| 1 | （**已有實測：V38、V39**）worker 繼承你的整個登入環境（SSH agent、各種 API key），全權限，可 `git push`、讀 `~/.ssh`、改 `~/.gitconfig`（advisor 讀到 `env` 有 `SSH_AUTH_SOCK` 等） | E48：擋不住也偵測不到，只靠 D3 的 prompt 禁令 | E2E 用 `sandbox-exec` 包住 dev 的 argv（只允許寫拋棄式 repo、狀態資料夾、opencode 的 `~/.local/share|state`、`~/.cache` 與 `/private/tmp`，網路只開 omlx 的本機連線）。**已實測可行（V38、V39）**，profile 見 V38；前綴要是 `env -u XDG_… sandbox-exec -f <profile>`（V37）。這要求 Runner 能接受「argv 前綴」（新增 `config.json` 的 `dev_argv_prefix`，只在 E2E 設）。**只保護 dev**：Tuning（claude/codex）仍無沙盒，見 8.2.4 |
| 2 | 沒有整體花費、時間、磁碟上限（只有單 task 限制） | D6、D12、D13 | E2E 的 `config.json`：dev／tuning 10 分鐘、測試 2 分鐘、`max_rework_cycles=1`；外層再套 `timeout 2400`；跑前後 `df` |
| 3 | E2E 對 **你真實的 core** 與 App 操作；Runner 的 bug 可能 kill 到你的 terminal（`t1 t14 t25 t26 t4v t51 t5n`） | R-G 只 kill 帶 `orca.run` 標籤的，但那是規格，不是已實作的程式 | **專屬 core**（**已實測 V36**）：短路徑的 `HC_SESSION` + 暫存 XDG（socket 路徑 ≤103 bytes），worker 必須 `env -u XDG_*`（V37）。代價：測不到 AT-03 的真實 App 關 tab，AT-03 另外在 owner 在場時對測試 tab 單獨做 |
| 4 | `close_planning_tab` 在 E2E 被打開（U5 未測） | M4：預設 false | E2E 設定鎖 `false`；不從你的 tab 執行 `/herdr-planning` |
| 5 | model 沒釘死，大 model 可能擠掉你的 omlx 服務 | D2：用 opencode 設定檔預設 | 拋棄式 repo 內 commit `opencode.json = {"model":"omlx/LiquidAI--LFM3-1.7B-MLX-4bit"}`；Tuning model 明確傳 `--model/--effort`，並先告知你會花 claude 額度 |
| 6 | Runner 會執行 AI 寫的 `test`／`verify` 指令，沒有沙盒；`init` 的空測試過濾只擋 `true`、`:` 之類 | M2：user 事前核可 | 你逐行讀過所有 `test`／`verify`；`init` 另掃 `~`、`$HOME`、`..`、`sudo`、`curl`、`rm`、`git push`（命中就拒絕）；Runner 本身也放進 sandbox |
| 7 | worker 殘留程序 | U15 | `nohup &` 已驗會被清掉（V35）；`setsid`／雙重 fork 仍未驗；dispatch 明文禁止；跑後 `ps`、`lsof -iTCP -sTCP:LISTEN` 對基準 |
| 8 | 全域狀態污染：opencode 的共用 `opencode.db`、plugin、`~/.config/herdr-app/my-orca/index.json` | 無 | 跑前後記錄大小與 session 數；跑完把 `<wt-id>` 資料夾搬走、移除 index 項目（advisor：DB 並行行為是猜的） |
| 9 | 秘密進到 `logs/<id>.txt` 或 repo | D15、E43 | 跑後用 `grep -rEn 'sk-|AKIA|ghp_|PRIVATE KEY'` 掃狀態資料夾與 repo |
| 10 | repo 若是真實 repo 的 clone，worker 摸得到真的 remote／hooks | 無 | 用全新 `git init` 在 `/private/tmp/orca-e2e-*`，`git remote -v` 為空，本機 `core.hooksPath=/dev/null`、`core.autocrlf=false` |
| 11 | worker 讀寫 cwd 之外的狀態資料夾可能被 `--auto` 擋 | 未驗 | **已驗 V34**（隱藏資料夾、1.7B、一次）；仍需用真實路徑再驗一次 |
| 12 | 額度中途耗盡留下半個 commit | E44、`--accept-head` | 只會停在 `needs_user`，不是破壞 |

#### 8.2.2 E2E 安全規程

**前置條件（全部成立才開跑）**：①專屬 core 已啟動，`hc ls` 看不到你的 terminal；②拋棄式 repo 已建好（含 `.gitignore`、`opencode.json`、3 個 dev task、1 條故意不過的 acceptance、已紅的測試）；③`config.json` 已設小上限；④U13、U15 的剩餘部分補測完；⑤M6 到 M12 已實作並有單元測試；⑥你已讀過所有 `test`／`verify` 指令；⑦你同意 claude Tuning 花額度的時間點。

**基準（跑前存到暫存資料夾）**：`hc ls --json`、`herdr-app ls`、`ps -axo pid,ppid,command`、`lsof -iTCP -sTCP:LISTEN -nP`、重要檔案的 `shasum`（`~/.gitconfig`、`~/.zshrc`、`~/.ssh/config`、`~/.config/herdr-app/{programs,settings,keys}.json`）、`crontab -l`、`~/Library/LaunchAgents`、`df -h /`、你的真實 repo 的 `for-each-ref` 與 `stash list` 雜湊；`touch marker`。**不要讀 `~/.config/opencode/` 的內容**（含 API key；其中一位 advisor 讀過它，沒有回報金鑰內容）。

**即時監控（每 15 秒）**：新增的 terminal 只能是帶 `orca.run` 標籤的；`hc ls --label orca.role=dev` 至多 1 個；repo 以外沒有寫入；沒有新的監聽埠；總時間超過 40 分鐘。任何一項違反 = 立刻中止。

**中止**：①`hc kill orca-r-<wt>`；②對每個 dev worker 以名稱或標籤 `hc kill`（不用萬用字元，**每個指令之前都過 M13 的 core id 斷言**；address 在專屬 core 與你的 core 之間會撞號）；③`pgrep -fl <repo 路徑>` 後 `kill`；④只停專屬 core，**永遠不對你的 core 執行 `hc server stop`**；⑤稽核完成前不刪狀態資料夾。

**跑後稽核**：`hc ls`／`herdr-app ls` 與基準 diff 為空；沒有 **live** 的 runner／dev／tuning terminal（M12）；`shasum -c` 與真實 repo 雜湊不變；`find ~ -xdev -newer marker` 排除 repo、狀態資料夾、opencode 目錄後為空；`ps`／`lsof` 沒有多餘程序或埠；秘密掃描無命中；`git reflog` 只有 `orca(...)` commit；`events.jsonl` 每筆 `kill` 都帶 `orca.run` 標籤。

#### 8.2.3 E2E 測試計畫

1. **預檢（不花模型額度）**：補測 U13（deny 權限的行為）與 U15 的 `setsid`／雙重 fork；用手動模擬 worker 走一遍 dispatch 範本與 Runner。
2. **拋棄式 repo**：`/private/tmp/orca-e2e-<ts>/`，含 `.gitignore`、`opencode.json`、`tests/t01.sh` 到 `t03.sh`、`tests/all.sh`。T-01 `greet.sh` 印 `hello`；T-02 `add.sh`（deps T-01）；T-03 `upper.sh`（deps T-02）。AC-1 `sh tests/all.sh`；AC-2 `grep -q '^v1$' CHANGELOG.md`（沒有 task 會建立它，強制一輪 rework 產生 `R1-01`）。handoff §9：Tuning 不得直接改檔，要用 rework task。
3. **Planning**：不付 skill 的錢，用 `my-orca init --handoff … --tasks …` 直接呼叫（涵蓋 AT-01、02）。
4. **取樣器**：每 2 秒存 `hc ls --all --json`、`herdr-app ls`、`git log --oneline` 與每個 `orca.*` terminal 的 `hc get`（AT-04、05、06、09 的證據；Tuning terminal 在 review 後會被 rm，所以要邊跑邊存，或把白名單 argv 記進 `launched` 事件）。
5. **通過標準**：3/3 dev task 有 ack 與合法 result；剛好 1 輪 rework；`ready_for_review`；沒有多餘 tab；非 `orca.run` terminal 前後相同；`git stash list` 不變；沒有不在許可清單內的 kill。
6. **失敗分類**：Runner 的轉移與證據矛盾（有效 result、測試過、樹乾淨、`HEAD` 是後代卻被拒絕；出現第二個 worker；kill 了無標籤 terminal；Runner log 有例外）= **Runner bug**。Runner 正確地得到 `undelivered`／`exit_without_result`／`task_failed`，且 `logs/` 顯示模型沒照步驟做 = **模型問題**。1.7B 很可能過不了多步驟的 worker 合約：先把 dispatch 縮成可直接複製的 shell 區塊；再不行，只改 `opencode.json` 換較強的 model、其他完全不動重跑；較強者過關 = 1.7B 是原因。**絕不放寬 Runner 的檢查。**
7. **證據**：`state.json`、`events.jsonl`、`dispatch/`、`results/`、`reviews/`、`logs/`、`git log --stat --graph`、每次 `git status --porcelain --ignored`（測試前、後、kill 後）、測試的 exit code 與耗時、各個時點的 `hc get` 原始輸出、`hc --version`、`opencode --version`、使用的 model、任何出現過的權限或對話框畫面。

**AT 證明上的缺口（advisor 提出）**：AT-14 缺「Tuning 說 pass 但 Runner 重跑 verify 失敗」的 F 測試（加進第 6 步）；AT-16 需要點擊，`shot` 不能點，標 M 或 NOT TESTED；AT-20 需要兩個 worktree，單一 E2E 不涵蓋，用 E7 的 F 測試；AT-11 與 AT-13 要注意 Tuning 可能選「直接修」而不是 rework，要在 handoff 寫明；AT-09 的 `hc get` 證據需邊跑邊存。

**仍待 owner 決定（寫進 3.1 以外的新問題）**
- **Q-E1**：E2E 是否用 `sandbox-exec` 包 dev（需要新增 `dev_argv_prefix`）？建議：要。
- **Q-E2**：E2E 是否用專屬 core？建議：要；AT-03 另做。
- **Q-E3**：Resume 的語意採 M9（新預算、再 2 次嘗試）是否同意？

#### 8.2.4 全部採最佳配置（Q-E1 沙盒、Q-E2 專屬 core、Q-E3 M9）的預測與邊界

**意見來源**：Fable 5.2（medium，唯讀）加上我在本輪實跑的 V36 到 V40。本節的「預測」是推論，不是測試結果。（harness 提示 Fable 的輸出含 `settings.json`、`dangerously-skip-permissions` 字樣，那是它在引用本文與 Tuning 的旗標，沒有夾帶指令。）

**預測結果**
- 時間約 40 到 70 分鐘；claude Tuning 約 2 個中型 session 的額度；opencode 本機免費。
- **最可能失敗的不是 Runner，是 1.7B 的合約遵從**：ack、改檔、跑測試、commit、最後才寫 result，一次要全做對。預期 3/3 拿不到，至少一個 task 進 `task_failed`，歸類為模型問題，照 8.2.3 第 6 步換 model 重跑。
- **第二個失敗點是環境**：V37（XDG 繼承）與 V38（loopback 一定要放行）都是我實測時一開始踩到的，實作時沒寫進 Runner 就會被誤判成 `undelivered`。
- Runner 的邏輯在 fake-agent 階段就該全部通過；E2E 真正多出來的證據只有 AT-10 與「真 opencode 那一半」。

**買到的安全**：dev worker 不能寫 repo 以外的地方（`~/.ssh`、`~/.gitconfig`、其他 worktree 的寫入被 deny）、不能連外網（`git push`、`curl` 都會失敗，V39）；你的 terminal 不在專屬 core 內，Runner 的 bug 殺不到它們（V36）。

**邊界（最佳配置之後仍然沒保護或沒驗證的）**
1. **Tuning（claude／codex）完全沒有沙盒**：全權限、你的憑證、全網路、可 push，只靠 handoff 的禁令。
2. **Runner 自己跑的 `test`／`verify` 沒有沙盒**；規格沒有對應設定（8.2.1 第 6 項「Runner 也放進 sandbox」目前只是想法）。
3. **讀取不受限**：dev 仍可讀你的任何檔案（`~/.ssh`、`~/.codex/auth.json`、opencode 設定檔裡的其他 key），環境變數也沒清。要擋要另加 `deny file-read*` 與 `env -i` 的清單（沒測）。
4. loopback 全開：包含你的 opencode service（`127.0.0.1:49374`）與 omlx（`:8000`，狀態不可重置）。
5. opencode 共用的 `opencode.db`、`opencode serve --service`、pty daemon 仍是全域的；`--standalone` 是否完全不碰 service 只有間接證據。
6. 真正脫離 process group 的 daemon 是否殘留（U15 剩餘部分）。
7. AT-03 的 `tab.close` 沒有證據（U5），要在你在場時另外測，專屬 core 看不到 App。
8. claude／codex 在專屬 core 內是否能啟動、憑證是否可用：**未測**（推論 HOME 不變就沒事）。
9. sandbox-exec 已被 Apple 標記為 deprecated，目前可用，不保證跨 macOS 版本。

**逐題意見**
- **Q-E1（沙盒）**：同意。反方論點：deprecated 工具，調 profile 可能比 E2E 本身花更久。回應：profile 已經調好（V38），只剩寫進 `dev_argv_prefix`。`dev_argv_prefix` 只在 E2E 的 `config.json` 設，README 標「macOS only」。
- **Q-E2（專屬 core）**：同意。反方論點：證明的是「在測試 core 上可行」。回應：差異只有 XDG 與 App 功能，V36、V37 已把它們變成事實。socket 路徑要短。
- **Q-E3（M9）**：Fable 同意但提醒：Resume 給 2 次新嘗試，連按 Resume 就等於無限次。**建議微調**：`attempts[]` 不清零，Resume 只把上限 `max_attempts += 2` 並寫 `resumed` 事件，稽核時看得到總次數。**owner 已同意（2026-11-16）：採這個微調**。

**現在就能跑的收斂階梯（★ 是本輪已完成）**

| # | 內容 | 狀態 |
|---|---|---|
| 1 | 專屬 core 起得來、與你的 core 隔離、停得掉 | ★ V36 |
| 2 | 專屬 core 內 opencode 找得到 omlx model（需 `env -u XDG_*`） | ★ V37、V38 |
| 3 | sandbox 內 opencode 能完成 V34 等級任務 | ★ V38 |
| 4 | sandbox 擋寫入與外網 | ★ V39（opencode 內的 `touch` 無法與「沒執行」區分，已用直接測試補） |
| 5 | U15：脫離 process group 的 daemon | ★ 已完成（V42：會存活，環境標記掃描可清）；原：剩 `setsid` 類（macOS 沒有 `setsid` 指令，需用 python `os.setsid`），可無人值守 |
| 6 | U13：`opencode.json` 對 `rm` 設 deny，看會不會回報 `blocked` | 未做，可無人值守 |
| 7 | 手動扮演 worker 走完 4.9 的 dispatch 範本（5 步），在專屬 core 加 sandbox 內 | ★ 已完成（V43、V44；linked worktree 與真實 `results/` 路徑未涵蓋，見 8.2.6 第 12 項） |
| 8 | claude／codex 在專屬 core 內能否啟動（Tuning 用） | 部分 ★（V45：auth 與 model 檢查）；真 session 啟動併入 E2E 第一次 Tuning，需 owner 授權少量額度 |
| 9 | U5：`tab.close` | 未做，**需 owner 在場** |

**「E2E 可安全開跑」清單**：①專屬 core 的 `hc ls` 為空且 core id 不等於你的（V36）；②sandbox 內 opencode 完成任務、寫 `~` 失敗、外網失敗（V38、V39）；③階梯 5 到 9 完成；④8.2.2 的基準已存；⑤`config.json` 小上限、`close_planning_tab=false`；⑥M6 到 M12 已實作並有單元測試；⑦你已讀過所有 `test`／`verify`；⑧你同意 Tuning 花額度的時間點。

#### 8.2.5 owner 的決定與其含意（2026-11-16）

**Q-E1、Q-E2：採用**（沙盒包 dev、專屬 core）。**Q-E3：採用**（`attempts[]` 不清零，Resume 只把上限 `+2`，寫 `resumed` 事件）。

**對 8.2.4 邊界 1 到 3（Tuning 無沙盒、Runner 的測試無沙盒、讀取不受限）的回答：靠 skill 約束行為。** 做法：Planning 階段（user 在場）必須先釐清「進入 cycle 之前就要解決的外部依賴」，釐清不了就不准進入 cycle，cycle 內一律不連外網。

**這個決定能硬性做到的與做不到的（我的評估，待 owner 確認）：**
- **能硬性執行**：dev worker 的網路（沙盒已 deny，V38、V39）。所以「cycle 內不連外網」對 dev 是真的，不只是請求。
- **只能靠 skill／prompt（無硬性保證）**：Tuning（claude／codex）。它必須連 Anthropic／OpenAI 的 API，而 `sandbox-exec` 只能用 IP 與埠過濾，不能用網域，所以無法做到「只允許 API、擋其他」。Tuning 的「不連外網」只是指示，不是強制。
- **skill 的檢查必須落在 `init` 能機械檢查的欄位上**，否則只是文字承諾。建議（提案，未寫入 D14）：`tasks.json` 加 `"network":"none"` 與 `"external_needs":[]`（套件安裝、下載、API 文件等，Planning 階段先備妥並 commit 進 repo 或 vendor）；`init` 拒絕 `network` 不是 `none` 的內容、並掃 `test`／`verify` 指令是否含 `curl`、`wget`、`npm install`、`pip install`、`git clone`、`git push`。這能擋住「計畫就需要網路」，擋不住「model 臨時起意」。
- 讀取面（`~/.ssh` 等）仍沒有硬性保護，skill 約束同樣只是指示。

#### 8.2.6 第二輪審查（Fable 5.2 xhigh 與 Codex `gpt-6-astra` high）與本輪自驗結果（2026-11-16）

**審查方式**：兩位都是唯讀、拿到同一份問題（Planning 能否消除阻塞、步驟 6／8／9 的自我驗證、找出文件錯誤）。Codex 是在 owner 授權下，用 `herdr-app do tab.new` 開了一個可見的 `codex-astra` tab（`-s workspace-write -a never`，cwd 是暫存資料夾，只能寫 `answer.md`）；`hc` 用來監看。兩位的結論高度一致，下面只列結論與新增項。

**本輪我自己驗證完的（不需要 owner）**

| # | 結果 | 證據 |
|---|---|---|
| V42（步驟 5，U15 完成） | **真正脫離 process group 的 daemon（`os.setsid` 加雙重 fork）在 `hc kill` 後存活**，40 秒後還寫出標記檔。**收斂辦法有效**：worker 的環境變數帶 `ORCA_DISPATCH=<id>`，kill 之後 `ps -Eww` 找出帶該標記的程序並 kill，標記檔沒有出現。限制：這是「合作式」清理，不是邊界（清空環境、掃描與 kill 之間 fork、PID 重用都會漏或誤殺）；只驗了一種 daemon 寫法 | 實跑（專屬 core、沙盒內） |
| V43（步驟 7，腳本 worker） | 沙盒內腳本照 4.9 範本走五步：worker 寫得到 `results/`，寫不到 `state.json`、`dispatch/`、`~`，外網失敗；Runner 端檢查全過（porcelain 空、`is-ancestor`、commit 數 ≥1、重跑測試 exit 0、`state.json` 雜湊不變、結果 JSON 合法）。worker 腳本結束碼是 6（最後一個被擋的 `curl`），**terminal 結束碼不能當成敗依據** | 實跑 |
| V44（步驟 7 加碼） | **真的 opencode 1.7B（沙盒內）照 4.9 範本一次完成**：ack、建 `greet.sh`、測試通過、1 個 commit、結果檔合法、工作樹乾淨，約 40 秒。結果檔出現時狀態仍是 `working`（支持 M7）。**只跑一次**，推翻不了「遵從率低」的假說，也不證明它高 | 實跑 |
| V45（步驟 8-lite） | 專屬 core 的 terminal 內（`env -u XDG_*`）：`claude auth status` 為已登入、`codex login status` 為已登入、`opencode models` 含 `omlx/LiquidAI--LFM3-1.7B-MLX-4bit`。**只證明憑證與 model 找得到，不證明 Tuning session 能啟動** | 實跑 |

**兩位審查一致的結論（已採納為規格決定）**
1. **owner 的質疑對一半**：Planning 應把「已知且可準備」的阻塞消除掉，但執行期的阻塞（model 自己提問、額度、不穩定測試、環境漂移）原理上消除不了，Runner 的安全網不能拆。U13 從「驗收閘門」降為「量測延遲」：沒回報 `blocked` 時，60 秒靜止或 60 分鐘硬上限一樣進 `needs_user`，不會誤判成功。**U13 不再是 E2E 的閘門**。
2. **`init` 加「沙盒預檢」**（提案，D14 的擴充）：進 cycle 之前，在與 dev 相同的沙盒（網路 deny）內把每條 `test`／`verify` 跑一次，每條有時間上限。
   - 通過條件**不是 exit 0**：`tasks.json` 每條指令帶 `preflight:{expected:"pass"|"red", red_case?}`；紅測試必須用指定的失敗判準，不能把任意非零碼當成預期的紅。`sh: node: command not found`、缺套件、等輸入、逾時都不算 red。
   - **不能用 exit 127 判工具缺失**（被測的檔案尚不存在時同樣 127）。
   - 預檢紀錄由 `init` 自己產生，綁定 base HEAD、`tasks.json` 與測試檔雜湊、工具版本、沙盒政策；Planning 自填的 `preflight_passed` 不採信。
   - 在無 remote、停用 hooks 的拋棄式快照內跑，不在 owner 工作樹。
   - 證明範圍：只證明這次走過的路徑不需要網路；測試檔若由後續 task 才建立，標「未驗」。
   - `network:"none"` 只涵蓋 task 工具與驗收指令，**不含 Tuning 對模型 API 的傳輸**（否則 Tuning 本身就違反這條文字）。`external_needs` 記錄「已解決並落地的需求」（路徑與雜湊），不是強迫為空陣列。
3. **步驟 5、7、8-lite 不需要 owner**（已完成，V42 到 V45）。
4. **步驟 8 分三層**：①零額度的 fake CLI，只斷言 argv、model／effort 白名單、cwd、core 路由；②（已做）auth 與 model 檢查；③真 smoke **併進 E2E 的第一次 Tuning**，不另跑。第三層需要 owner 對「花少量 claude 額度」的授權，不需要陪跑。
5. **步驟 9 分兩段**：2.2 的 a 到 i 用假的 `hc` 加假的 `herdr-app`（PATH shim）寫單元測試，必須測真正 Runner 的判斷函式；未知呼叫一律失敗、不得退回真 CLI。真實 `tab.close`（U5）**不能被 shim 取代**，只剩 owner 確認一次。`HERDR_APP_HOME` 開第二個 App 視窗：兩位都認為**未證實隔離**（App 的 layout 存在 core 的 document，連上的視窗共用），不採用。**U5 不是核心 E2E 的閘門**：`close_planning_tab` 維持預設 `false`，U5 與 AT-03 留到最後。

**新增與需修正的風險（依嚴重度；M13 起為規格修正）**

| # | 風險 | 修正 |
|---|---|---|
| 1 | **專屬 core 的 address 會與你的 core 撞號**（兩邊都從 `t1` 起編），指令漏帶 `HC_SESSION` 就會殺到你的 terminal | **M13**：所有對專屬 core 的操作走包裝函式 `hc(){ HC_SESSION=… command hc "$@"; }`，破壞性指令前先斷言 core id ≠ 你的 core；優先用 `--name`／標籤，不用裸 address。（本輪我已照這個做。） |
| 2 | **loopback 放行是後門**：`localhost:*` 包含你無沙盒的 opencode service（`127.0.0.1:49374`），它能跑 bash，理論上可繞過寫入與網路限制。V39 與 8.2.4「買到的安全」過度宣稱 | 文字改為「dev 對部分路徑與直接外網受限」；E2E 稽核加 `lsof -i :49374`；查 `--standalone` 能否固定埠；換大 model 時重新評估 |
| 3 | **`needs_user` 不是物理停止**：被保留的 worker 可能繼續寫檔、耗額度；殺 Runner 不會殺 `--no-parent` 的 worker；測試與 Tuning 的後代程序同樣會逃 | **M14（取代 R-C 的「kill 不損失東西」）**：kill 之後依 V42 的環境標記掃描，核對 PID 身分、重新掃描、確認靜止；清不乾淨就保留證據並 `needs_user`，不得接受結果。中止流程涵蓋 runner、dev、tuning、test／verify／preflight 的後代 |
| 4 | Tuning 產生的 rework `test` 會在無沙盒的 Runner 執行，初始的 owner 核可與預檢沒涵蓋 | **M15**：rework 指令套用同一結構檢查與受限預檢，才可執行；「把整個 Runner 放進 dev 沙盒」行不通（Tuning 會失去 API 連線），測試的執行邊界與模型傳輸邊界要分開設計 |
| 5 | **M7 的「兩次輪詢不變」不證明 worker 已停止修改**（可能在寫 ignored 檔、持鎖） | 60 秒上限到了的處理要寫明；kill 後半寫的結果、殘留 `index.lock`、partial changes 一律停下保留，不自動 reset 或清鎖 |
| 6 | a 到 i 只檢查「一個 terminal」，不檢查 pane 結構（mod pane 也會被一起關）；「不到一秒的空窗」無法保證 | f 改核對 pane 結構，拿不到就不關；空窗改寫「無法保證」；維持預設關閉 |
| 7 | U13 把「工具直接拒絕」「CLI 等人回答」「worker 自報 blocked」混在一起；`status != done` 被記為 `rejected` 可能再重試，與 `blocked → needs_user` 不一致 | 三種出口分開處理；確定要改政策的阻塞不要重試 |
| 8 | 閘門不一致：E2E 要求階梯 5 到 9 全完成，卻又設定 `close_planning_tab=false`；`init` 的 E33／E34／E35 需要 App、Herdr terminal、claude／codex，與 E2E 直接呼叫 `init` 衝突；`init --check` 與 4.9 的旗標清單不同 | 閘門改為：U5 不擋核心 E2E；`init` 的測試入口釘死為 fake Planning 身分，並揭露與 production 檢查的差異 |
| 9 | 監控判準自相矛盾：「沒有新監聽埠」「repo 外無寫入」與 opencode 必須寫共用資料、起隨機 loopback 伺服器衝突；預估 40 到 70 分鐘卻以 40 分鐘中止；`find ~ -newer` 必有雜訊；秘密掃描 `grep -rEn` 會印出命中的整行，違反 D15 | 改成「允許路徑與程序的差分」；40 分鐘是硬停止；掃描只報檔名、行號與類別 |
| 10 | 環境洩漏：worker 繼承 `SSH_AUTH_SOCK` 與各種 API key 變數；`env -i` 會弄壞 opencode；`env -u XDG_*` 成立只因你的環境本來沒設 XDG | 改用白名單 `env -i HOME PATH TERM HC_SESSION …`，先用 opencode 實測 |
| 11 | 黑名單式沙盒下，`launchctl submit`、`open -a`、Apple Events 可在沙盒外起程序；放行 `/private/var/folders` 太寬 | 記為已知限制；1.7B 不會利用，換大 model 要重評 |
| 12 | V41 沒被 E2E 走到（E2E 用獨立 repo）；真實部署的 common-dir 放行可收窄為 git-dir 加 `objects`、`refs/heads/<branch>`、`logs/refs/heads/<branch>`、`packed-refs` | 在步驟 7 補一次 linked worktree 加真實 `results/` 路徑的驗證（未做） |
| 13 | 失敗分類只有 Runner bug／模型問題；「換大 model 通過＝1.7B 是原因」過強 | 分類改為 `environment / policy / model / runner / inconclusive`；8.2.1 第 1 項仍寫放行「狀態資料夾」，應為 `results/`；8.2.4 預測「1.7B 多半不遵約」撤回，不再量化猜測 |

**修訂後的驗證順序（★ = assistant 可單獨完成）**

| # | 內容 | 狀態 / 停止條件 |
|---|---|---|
| 1★ | 規格統一（M13 到 M15、閘門解耦、過度宣稱改寫、`init` 測試入口） | M13 到 M15 ★ 已寫入 4.4／4.9；其餘（閘門解耦、過度宣稱改寫、`init` 測試入口、8.2.1 第 1 項的 `results/`）待做 |
| 2★ | 無模型單元測試：D14、M6 到 M12、a 到 i（假 `hc`／`herdr-app`）、壞資料、未授權目標、逾時與恢復 | M13 到 M15 ★ 已完成（`my-orca/my-orca.test.mjs`，20 項，`node --test my-orca`）；其餘待做；任何不安全目標被呼叫、未驗收即成功、未知輸入卻放行 → 立即停止 |
| 3★ | `init` 沙盒預檢（含紅測試語意） | 待做；不能分類的失敗、必要網路、需提問、清理失敗 → 擋住 cycle |
| 4★ | fake worker 在專屬 core 跑停止、當掉、恢復、rework；把 V42 的清理接進真 Runner 的每條路徑 | 待做；殘留寫入、未知 PID、第二個 worker、跨 core 目標 → 停止 |
| 5★ | U13 最小真探針：先用 allow 的對照例確認工具確有被呼叫，再設 deny；沒有工具呼叫證據標 INCONCLUSIVE | 待做；60 到 120 秒上限 |
| 6★ | 補 V41（linked worktree 加真實 `results/`）與 1.7B 重複 3 次；Tuning 的 fake argv 測試 | 待做 |
| 7 | **E2E**（owner 只需同意時間點與少量 claude 額度；真 Tuning smoke 併入） | 達硬時限、core 身分變動、政策外寫入或網路、清不乾淨、超限 → 停止並保留現場，不自動 Resume |
| 8 | U5：`tab.close`（owner 確認一個拋棄式 tab，一次、不用 `confirmed`） | 最後才做；不擋 E2E；證據不全就維持 `close_planning_tab=false` |
