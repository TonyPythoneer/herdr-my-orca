# 第二輪 CTO 收斂：任務指示（給下一個 session 讀）

你是 CTO，模型 Fable 5.2（high）。工作目錄：`/Users/tonyyang/git/herdr-my-orca/.claude/worktrees/workflow-stages-panel`（分支 `worktree-workflow-stages-panel`）。

## 最高優先規則：先產出檔案，邊做邊存（owner 不能再損失已投入的 token）

1. **開工後第一個動作**（在讀任何東西之前）：建立 `docs/spec-v2-converged.md`，內容是標題、日期、各章節標題（見下方「輸出」）與每章一行 `待補`。
2. **每完成一個章節、每跑完一個探針、每確認或推翻一個宣稱，立刻寫進該檔**（用 Edit/Write 覆蓋對應段落）。不要把結論留在對話裡等最後才寫。
3. **每寫完一個章節就 `git add docs/spec-v2-converged.md && git commit -m "WIP: spec-v2 converged <章節>"`**（只加這個檔案；絕不加入 `AGENTS.md` 或 `.agentflow`）。commit 訊息結尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
4. 中途如果被中斷或額度不足，檔案裡必須已經有目前為止的所有發現，並在檔案最上方留一行 `進度：已完成 X、Y；未完成 Z`。
5. 最後的對話回覆只是摘要；完整內容以檔案為準。

## 必讀

- `docs/spec-v2-progress.md`（owner 已拍板的 7 項決定與目前進度）
- `docs/spec-v2.md`（owner 的規格原文）
- `docs/spec-v2-review.md`（第一輪審查，要重新驗證，不要直接信任）
- `mods/orca-workflow/`、`mods/orca-chrome/main.js`、`mods/orca-status/`、`layouts/orca.json`
- `~/.config/herdr-app/herdr.d.ts`、`~/.config/herdr-app/AGENTS.md`；唯讀執行 `hc --skill`、`herdr-app --skill`、`hc schema --json`

## Owner 已拍板的決定（不要重議；若會造成問題，只標示衝突）

1. 狀態路徑 = `~/.config/herdr-app/my-orca/`（不用 `~/.herdr`）。
2. opencode 是否在 `hc` 底下回報 `working/blocked/done`：延後到 opencode 額度重置再測，列為**卡關的前置測試**。收斂後的設計必須在「有回報」與「沒回報」兩種結果下都成立，前置測試只決定走哪一條；能不依賴它的部分要能先開工，依賴它的部分要明確標示被卡住。
3. Planning 永遠由 user 在自己的可見 tab 觸發（`/herdr-planning`），觸發後才把任務推入 workflow cycle；Runner 不啟動 Planning。
4. 背景 worker 沿用 `programs.json` 的全權限參數。規格的「不自動核准權限」改寫為：沒有提示可核准，改靠 worktree 隔離與 git 基線限縮影響範圍（並指出你能驗證的限制）。
5. Planning 完成且 handoff 驗證通過後，跑 Planning 的那個 tab 可由 workflow 關閉。這與規格「不自動關閉 user terminal」衝突。請精確定義：誰關、何時關（handoff 驗證且狀態寫入之後）、如何避免關到有其他工作的 tab、用 init 時記錄的 address 識別；並把 AT-03 改寫成可測試的形式。用兩三句白話（繁體中文）向 owner 說明（owner 看不懂「AT-03 無法誠實通過」）。
6. 第一輪的 8 個待決問題，只保留真正卡關的（最多 3 個）交給 owner；其餘附預設值與子 agent 必須遵守的規則，交給之後的實作 subagent 決定。
7. 以新版規格為主。v1（`mods/orca-workflow`、`orca-chrome` 的 workflow 按鈕）尚未合進 `main`，可以大幅改寫或刪除；請明說保留、改寫、刪除什麼。

## 你的工作

A. 收斂 v1 範圍：哪些要做、哪些延後。第一輪的簡化建議只有在重新驗證後仍成立才保留。

B. 邊界情況全面檢索（表格，一列一個：預期行為 / 處理機制 / 對應測試）。涵蓋規格的 20 條錯誤處理，並補上你能想到的所有其他情況，至少包括：Runner 每一步的崩潰與重啟、重複派發、core 重啟後的 terminal address 失效、worktree 改名/移動/刪除、同 repo 兩個 worktree、中途切 branch、run 期間 user 修改檔案、Planning tab 被提早關閉或被 user 關掉、user 關掉背景 terminal、handoff 驗證失敗、rework 上限與計數、空 task 清單、循環相依、rework 後 task ID 衝突、超大輸出、時鐘/逾時、symlink 或 bare repo、遠端 machine、同時執行多個 `my-orca`、UI 讀到寫到一半的檔案、run 中途改設定、secrets 洩漏到 events.jsonl 或 handoff、opencode 額度或 model 在中途耗盡。

C. 自我驗證：每一個關於 Herdr 行為的宣稱，要嘛用你實際執行過的唯讀指令/檔案證明，要嘛標 `UNVERIFIED` 並附上能驗證它的確切探針。允許用**不啟動任何 AI agent** 的純 shell 背景 terminal 驗證標籤、template 首則訊息、peek、`hc wait`、kill/rm（在 `/private/tmp` 的拋棄式資料夾，terminal 標 `orca.probe=1`，結束後一律 kill 並 rm，用 `hc ls --json` 確認沒有殘留、沒有新增 tab 或 space）。不要碰 owner 既有的 terminal、tab 或檔案。

D. 反駁自己：列出懷疑論的資深工程師會提的 5 個最強質疑，逐一用證據回應，或承認並修改設計；修改後再定稿。

E. 最終行動項目：依序、每項附完成標準，卡關的前置測試要明確標示，並標出哪些可交給 subagent 獨立完成、哪些需要 owner。

## 禁止

- 不要啟動 opencode、claude、codex 做實測。
- 不要讀出、列印或寫入任何 API key（例如 `~/.config/opencode/opencode.jsonc` 內有一把，絕對不要複製進任何檔案或回覆）。
- 除了 `docs/spec-v2-converged.md`，不要編輯其他檔案；不要碰 owner 既有的 terminal、tab 或設定。
- 不要加入 `AGENTS.md` 或 `.agentflow` 到 commit。

## 輸出：`docs/spec-v2-converged.md`（繁體中文（台灣），識別字、指令、路徑維持英文）

章節：
1. 結論與能否開工（哪些被卡住）
2. AT-03 的處理（白話 + 精確規則 + 改寫後的 AT-03）
3. owner 還需決定的核心問題（最多 3 個，各附建議與理由）與已委派的問題（預設 + 規則）
4. 收斂後的 v1 範圍（做 / 延後）與 v1 面板的保留 / 改寫 / 刪除
5. 邊界情況表
6. 已驗證 vs UNVERIFIED（含探針）
7. 五個最強質疑與回應
8. 最終行動項目（含卡關的前置測試）

## 最後回覆（自成一體，owner 之前無法開檔，不要只指向檔案）

用繁體中文給出：(1) 一段結論與能否現在開工、哪些被卡住；(2) AT-03 的白話解決方式；(3) 剩下不超過 3 個核心決定與建議；(4) 威脅正確性最大的 8 個邊界情況與設計如何處理；(5) 已驗證與仍未驗證；(6) 最先三個實作步驟。說明你實際是哪個模型版本（若能判斷）。
