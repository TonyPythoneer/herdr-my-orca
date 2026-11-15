# Spec v2 收斂版（第二輪 CTO 收斂）

進度：已完成（無）；未完成 1–8 全部

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

（撰寫中：探針逐一補上）

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

### 6.2 UNVERIFIED（附探針）

待補

## 7. 五個最強質疑與回應

待補

## 8. 最終行動項目（含卡關的前置測試）

待補
