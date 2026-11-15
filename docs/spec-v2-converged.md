# Spec v2 收斂版（第二輪 CTO 收斂）

進度：已完成 6（所有探針已跑完並清理）；未完成 1、2、3、4、5、7、8

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

待補

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
