# spec-v2 接續狀態（2026-11-16 寫下）

分支：`worktree-workflow-stages-panel`（worktree：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`）。
規格本體：`docs/spec-v2-converged.md`（**以第 8.2 節為準**）；歸檔：`docs/spec-v2-archive.md`（沙盒時代內容，只供查閱）。

## 現在在哪
- **設計與文件已收斂**（規格最後 commit `3cf7032`）。所有能自我驗證的項目都驗證完了（V30 到 V73）。
- **實作已由另一個 session 開始並 commit：`c958d8e workflow: implement spec v2 runner, planning skill and four-light UI`**（Tony Yang，10:53；之後還有 bottom-line 與 status bar 的 commit）。內容：`my-orca/my-orca.mjs`（約 2100 行）、`my-orca/my-orca.test.mjs`、`fake-agent.sh`、`fake-bin/`、`fake-e2e.mjs`、`skills/herdr-planning/`、`mods/orca-workflow/`（四燈列與 inspector）、`layouts/orca.json`、`README.md`、`docs/tasks-v2-implementation.md`、`docs/verification-v2.md`。`node --test my-orca` 目前 34 項全過。
- **我（寫這份文件的 session）沒有檢查過那個實作是否符合 8.2 的最終決定**（R-H 的 push 檢查、`unpushed`、`init` 的 `push -u`、不拒絕髒工作樹、缺 ack 不算失敗、`GIT_TERMINAL_PROMPT=0`、M13 到 M15、已作廢的 `isRunnable`／`preflight`／`RISKY` 是否還在）。接手第一件事：讀 `docs/tasks-v2-implementation.md` 與 `docs/verification-v2.md`，再用 8.2 逐條對照實作。

## owner 的最終決定（定案，不要重議；詳見 8.2.1）
1. 完全靠 prompt 保護，**不用沙盒、全信任**；Planning 階段是唯一的約束來源。別再問沙盒與信任。
2. 需要自我測試才能回答的問題，交給 subagent 驗證，不問 owner。
3. **R-H**：每個 stage（dev、Tuning、rework）自己 `git commit` 並 `git push`（plain，不帶旗標）；Runner 只讀、驗四項（porcelain 空、`@{u}` 存在、領先 0、is-ancestor 於 stage 起始 HEAD），失敗 → `needs_user(unpushed)`。
4. `my-orca init` ＝初始化該 worktree 對應的任務與 workflow 專屬獨立狀態；沒有 upstream 就 `git push -u origin <branch>`，再 `git push --dry-run`；**不拒絕髒工作樹**（髒檔被第一個 stage 的 `git add -A` 一併 commit）。
5. Planning 約束七條（8.2.3）採用；專屬 core 只用於 E2E；Resume＝新預算且 `max_attempts += 2`；缺 ack 不算失敗；`close_planning_tab` 預設 false。
6. 待 owner 異議的預設：`init` 遇 upstream 是 repo 預設分支（`main`）時拒絕。

## 關鍵事實（都已實測，細節在 V 編號）
- opencode dev：`opencode --auto --standalone --prompt "<指標 prompt>"`，會回報 7501、卡提問時 `blocked/question`（V30 到 V32、V72）。model 用 `omlx/LiquidAI--LFM3-1.7B-MLX-4bit` 要靠 repo 內 `opencode.json`。
- 脫離 process group 的 daemon 在 `hc kill` 後存活；用環境變數 `ORCA_DISPATCH=<id>` 加 `ps -Eww` 掃描可清（V42，M14）。
- `hc` 路由只看 `HC_SESSION` 加 XDG（不是 `HC_TERMINAL_SOCKET`），worker 永遠保留 `HC_SESSION`、加 `GIT_TERMINAL_PROMPT=0`（V60、V64）。
- claude／codex 在**獨立新 git repo** 會被信任對話框擋住；已信任主 repo 的 linked worktree 不會（V56、V58）。E2E 的拋棄式主 repo 要先在裡面做一次真實 Planning 接受信任。
- 真實 GitHub（HTTPS＋keychain）背景 terminal 可非互動認證（V64）。`tab.close` 非最後一個 tab 不帶 `confirmed` 直接關（V66）。
- 1.7B 的 R-H 完整流程 3/3 通過，但 ack 只有 2/3（V68、V69）。

## 還開著（不擋實作，留到 E2E）
ack 遵從率與 1.7B 穩定度；AT-03 (b) 最後一個 tab；真正沒有 pty 的 git 憑證；pre-push hook 失敗；多 worker 並行；U9／U10（`writeTextFile`、`watchFolder`）實作時驗。

## 下一步（建議順序）
1. 讀 `docs/tasks-v2-implementation.md`、`docs/verification-v2.md`，把實作與 8.2（尤其 8.2.1 到 8.2.4、4.9 的 M6 到 M15）逐條對照，列出落差；規格與實作哪個是對的以 8.2 為準。
2. 補齊落差，`node --test my-orca` 全綠。
3. UI（`mods/orca-workflow`）與 README 對照 8.2 檢查。
4. E2E：照 8.2.5（owner 同意時間點與少量 claude 額度，並親自在拋棄式主 repo 開一次 Planning 接受信任）。
5. 最後 U5／AT-03 的最後一個 tab 情境。

## 操作注意事項（踩過的坑）
- **不要 commit 不是自己改的檔案**：工作樹裡有別人改的 `README.md`、`mods/orca-status/*`（`main.js`、`local-usage.js`、`claude-statusline.sh`、`local-usage.test.js`、`opencode.svg`）。只 `git add` 自己的檔案。**永不 commit `.agentflow` 或 `AGENTS.md`。**
- owner 的 core id 是 `4d8f77de81b61a7fe6e072fa653b27ba`。對專屬 core 的任何 `hc kill/rm/server stop` 之前，先在同一個命令內讀 `hc server status --json` 並確認 id 不等於它；專屬 core 的 `HC_SESSION` 與 XDG 路徑必須很短（socket 路徑上限 103 bytes，用 `/private/tmp/oe-x`）；`hc kill`／`hc rm` 的目標是位置參數，不是 `--name`；terminal address（`t1`…）在不同 core 之間會撞號。
- 實驗用的暫存資料夾與專屬 core 用完要清掉；不要讀 `~/.config/opencode/`（含 API key）。
- 模型名稱：codex 用 `gpt-6-astra`（可選 high）；Fable 用 `model: "fable"`。
- 回覆 owner 用繁體中文，簡短，一次最多問 3 件事；owner 已表示精神疲勞，不要再加新問題。
