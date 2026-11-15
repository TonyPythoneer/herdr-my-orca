# spec-v2 審查進度紀錄

最後更新：2026-11-16。狀態：**暫停中**（使用額度接近上限，下次再繼續）。

## 文件

| 檔案 | 內容 | 狀態 |
|---|---|---|
| `docs/spec-v2.md` | owner 提供的 v4.0 規格，原文 | 完成 |
| `docs/spec-v2-review.md` | 第一輪 CTO 審查（Fable xhigh），含風險、簡化建議、行動項目、8 個待決問題、`orca-workflow` 演進 | 完成 |
| `docs/spec-v2-converged.md` | 第二輪收斂（邊界情況全面檢索、自我驗證、反駁自己） | **未產出**，任務在開始讀檔時被中止 |

## Owner 已拍板的決定

1. 狀態路徑：`~/.config/herdr-app/my-orca/`（不用 `~/.herdr`，這台沒有）。
2. opencode 是否在 `hc` 底下回報 `working/blocked/done`：**延後到 opencode 額度重置再測**，列為「卡關的前置測試」。收斂後的設計必須在有回報與沒回報兩種結果下都成立，前置測試只決定走哪一條。
3. Planning 永遠由 user 在自己的 tab 觸發（`/herdr-planning`），觸發後才把任務推入 workflow cycle；Runner 不啟動 Planning。
4. 背景 worker 沿用 `programs.json` 的全權限參數。規格的「不自動核准權限」要改寫成：沒有提示可核准，改靠 worktree 隔離與 git 基線限縮影響範圍。
5. Planning 完成且 handoff 驗證通過後，執行 Planning 的那個 tab 可以由 workflow 關閉。這與規格「不自動關閉 user terminal」衝突，**待收斂時精確定義**：誰關、何時關（handoff 驗證且狀態寫入之後）、如何避免關到有其他工作的 tab、用 init 時記錄的 address 識別；AT-03 據此改寫成可測試的形式。
6. 8 個待決問題只保留「真正卡關」的（最多 3 個）交給 owner；其餘附預設值，由後續實作 subagent 依規則決定。
7. 以新版規格為主。v1（`mods/orca-workflow`、`orca-chrome` 按鈕）尚未合進 `main`，可大幅改寫或刪除。

## 第一輪審查的主要結論（摘要）

- 規格照原文不可直接開工：state root 與機器不符、`first_message.sent` 只存在於 template 啟動、opencode 是否回報 OSC 7501 未知、Planning 的擁有者矛盾。
- 建議簡化：一個 skill + 兩個 hc template；砍掉 `execution_stage`、`progress.*`、`revision`、檔案鎖；20 條錯誤處理壓成 6 條規則；v1 不做 Tuning 直接修、multi-worker、reduced-motion、session history。
- 預檢 P1–P6 與實作 1–10 見 `docs/spec-v2-review.md` 第 4 節。其中 P1（opencode 狀態回報）被 owner 延後。

## 下次繼續時

1. 重新啟動 Fable（xhigh，CTO 角色）做第二輪收斂，輸出寫到 `docs/spec-v2-converged.md`。指示要點：
   - 納入上面 7 項決定。
   - 收斂 v1 範圍。
   - 邊界情況全面清單（每列：預期行為、處理機制、對應測試），涵蓋規格 20 條加上重啟/崩潰、重複派發、worktree 改名或刪除、兩個 worktree 同 repo、UI 讀到寫到一半的檔案、secrets 寫進 events 等。
   - 每個 Herdr 行為宣稱要嘛用唯讀指令驗證，要嘛標 UNVERIFIED 並附驗證探針。允許用純 shell 的背景 terminal 驗證標籤、template 首則訊息、peek、`hc wait`、kill/rm（標 `orca.probe=1`，結束後必須清掉並確認沒有新增 tab/space）。不得啟動 opencode、claude、codex，不得讀出或貼出 API key。
   - 自我反駁：列出最強的 5 個質疑並回應或改設計。
   - 最終回覆要自成一體（用繁體中文）：結論與能否開工、AT-03 的白話解釋、剩餘核心決定、威脅最大的邊界情況、已驗證/未驗證、最先三步。
2. 收斂完成後，owner 回答剩餘核心決定，再開始實作（順序見審查文件第 4 節，預檢 P1 之後補）。

## 其他

- 已 commit 的前置工作：`dfb7acc`（sidebar footer 的 workflow 按鈕與 `orca-workflow` 面板，圖示由 Fable 重新設計）。
- 分支：`worktree-workflow-stages-panel`（worktree：`.claude/worktrees/workflow-stages-panel`），尚未合進 `main`。
