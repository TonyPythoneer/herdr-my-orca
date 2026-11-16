# Spec v2 實作任務台帳（工作回報 / 自我更新）

最後更新：2026-11-16
分支：`worktree-workflow-stages-panel`
依據：`docs/spec-v2-converged.md`（3cf7032 之後的收斂版）
執行者：Buffy（Freebuff / DeepSeek V4.1 Flash）

這份檔案是實作期間唯一的進度落腳點。規則：

1. 每完成一項工作，立刻更新對應列的 **狀態 / 證據**，不要留到最後。
2. 狀態只用：`TODO`、`IN PROGRESS`、`DONE`、`OWNER GATED`、`DEFERRED`。
3. 證據要可重跑：指令、測試名稱、檔案路徑。不要只寫「已完成」。
4. 遇到規格衝突，記在「偏離與待決」；不要默默改設計。

## 1. 工作總表

| ID | 工作 | 規格 | 狀態 | 證據 / 備註 |
|---|---|---|---|---|
| I-01 | 任務台帳（本檔） | 本次指示 | DONE | 本檔 |
| I-02 | `my-orca` 純邏輯：state/config 原子寫入、`updated` 防雙寫、handoff/tasks 驗證、profile 白名單、secrets 掃描、下一步選擇 | 8 第 1 步、D5、D14、D15、4.5、E23 | DONE | `my-orca/my-orca.mjs`；A2 34 tests；`writeState` stale test |
| I-03 | `my-orca init`：環境/git 前置、upstream 自動建立、`push --dry-run`、預設分支拒絕、`--check`、印出 profile | 8.2.2、S21、E31–E36 | DONE | `cmdInit`；`init --check` 實跑；A8 upstream created |
| I-04 | Runner 本體 R-A..R-H：派發、送達證據、等待、M7 靜止、kill + M14 掃描、R-C 驗收、Tuning/rework、恢復對帳 | 4.4、4.9、M6–M15 | **DONE→OWNER GATED（部分）** | A2 happy path；A8 完整 fake run；恢復／rework 分支有程式，單元只覆蓋部分。**本 session：F1、F2 改回核心失敗路徑 — 詳下。** |
| I-05 | `start / run / stop / status / config set`、名稱鎖、M13 core 斷言 | 4.2、R-F、R-G、M13 | DONE | A2 M13；`cmdRun` 用 `expectCoreId`；A8 `start` |
| I-06 | Planning tab 關閉（2.2 的 a–i），預設 `close_planning_tab=false` | 第 2 節、M4、AT-03 | DONE | `closePlanningTab`；A8 `skipped:disabled`；AT-03 (a)(b) 仍 OWNER GATED。**本 session F1 改寫失敗路徑（E47 → `exit_without_result`），F2 改寫 Resume 重試次數（M9 +2），已合併入 I-04。** |
| I-07 | `fake-agent.sh` 與 runner 整合測試（回報 / 不回報 / blocked / 不交結果 / commit 不 push / 交結果後繼續寫） | 8 第 2 步、8.2.4 | DONE | `fake-e2e.mjs` 已實跑：report、commit-nopush、noresult、block、failtest、noack、rework-once、fix-once 全 PASS |
| I-08 | `herdr-planning` skill：M2 事前確認、寫 handoff/tasks、呼叫 init、轉述 profile | 4.2、D14、M2、U11 | DONE | `skills/herdr-planning/SKILL.md` + `install.sh`；U11 需 owner 確認 |
| I-09 | `orca-workflow`：`lights(state)`、`rows(state, terminals)`、strip/inspector、Peek/Resume/Stop、rework 上限、watchFolder + timer | 4.8、D8、D9、U9、U10、AT-15–18 | DONE | `mods/orca-workflow/{model,main}.js`；A3 8 tests；A4 check passed |
| I-10 | `layouts/orca.json` 新增 sidebar 四燈 block（28px，設定列上方） | Q3=A、4.8 | DONE | `workflow-strip` 28px，`props.strip=true` |
| I-11 | 單元測試全綠（第 5 節標 T 的列）＋ UI 測試 | 8 第 1、8 步 | DONE | A2 34/34；A3 8/8 |
| I-12 | `herdr-app check mods/orca-workflow`、固定 state 的畫面檢查 | 8 第 8 步 | DONE（自動）/ DEFERRED（人看） | A4 `check passed`；截圖與 U6 未做，見 I-17 |
| I-13 | README 一節：啟動、查看、停止、恢復、狀態欄位、已知限制 | 8 第 10 步 | DONE | README「Workflow」一節 |
| I-14 | `docs/verification-v2.md`：給下一個 model 的驗證標準 | 本次指示 | DONE | 本檔 |
| I-15 | 唯一一次真 E2E（3 dev task + 1 輪 rework + 專屬 core + 本機 bare remote） | 8 第 7 步、8.2.5 | OWNER GATED | 需要 owner 同意時間與真實 opencode 額度 |
| I-16 | AT-03 (b) 最後一個 tab / 多 pane 的 `tab.close` | U5、AT-03 | OWNER GATED | 需要 owner 在場開測試 tab |
| I-17 | AT-15/16/17 的截圖人工確認、U6 peek 畫面 | 8 第 8 步 | DEFERRED | 本輪只驗資料與 `check`，不宣稱畫面已看過 |

## 2. 實作順序與狀態

1. I-02 → I-03：先把不需要 core 的部分釘死。
2. I-04 → I-05 → I-06：Runner 與 CLI；用注入的假 hc/git 測狀態機。
3. I-07：專屬 core 的整合測試（若環境允許）。
4. I-08、I-09、I-10：skill 與 UI。
5. I-11 → I-12 → I-13 → I-14。
6. I-15、I-16 留給 owner；I-17 需人看圖。

## 3. 工作回報紀錄（append-only）

| 時間 | ID | 結果 | 指令 / 證據 |
|---|---|---|---|
| 2026-11-16 | I-01 | 台帳建立 | 本檔 |
| 2026-11-16 | I-02–I-05 | `my-orca` 純邏輯、init、Runner、CLI 完成 | `node --test my-orca` 34/34 |
| 2026-11-16 | I-06–I-07 | Planning tab 關閉與 fake 整合完成 | `node my-orca/fake-e2e.mjs` 全 PASS（專屬 core） |
| 2026-11-16 | I-08–I-10 | skill、UI、layout 完成 | `node --test mods/orca-workflow` 8/8；`herdr-app check mods/orca-workflow` passed |
| 2026-11-16 | I-11–I-14 | 測試、README、驗證標準完成 | 見上列；真 E2E／AT-03(b)／畫面仍待 owner |
| 2026-11-16 | F2（M9） | DONE | 修前實測：`after Resume` `launchesInResume:1, resume_extra:null, attempts:3`。修完：`launchesInResume:2, resume_extra:2, attempts:4, code:'task_failed'`。修法：`resumeState` 內 task 搜尋加第三候選 `state!=='accepted' && attempts.length >= 2+resume_extra`。`node --test my-orca && node --test mods/orca-workflow` 全綠 36＋8。 |
| 2026-11-16 | I-05／I-06 追加 | 結算、清理與失敗路徑的最後安全修正 | `settleAndKill` 只在 `hc get` 到的 terminal 標籤（`orca.run`／`orca.dispatch`／`orca.role`／`created_ms`）相符時才 kill；取不到 terminal 就不對該 address 下 kill，仍做 M14 掃描。`removeWorker` 同樣先核對身分，不符只記 `rm_skipped`。破壞性指令的 `CoreGuardError` 一律 `needs_user(core_mismatch)`。修正後 `node --test my-orca` 34/34，8 個 fake 模式全部重跑通過 |
| 2026-11-16 | F1（E47） | DONE | 現況紅：`cp docs/f1f2.test.mjs.txt my-orca/f1f2.test.mjs && node --test my-orca/f1f2.test.mjs` → F1 ✖、F2 ✖。修完：`node docs/review-c958d8e-probe.mjs` E47 段 `launches:1, code:'exit_without_result'`。修前為 `launches:7`。修法：`handleResult` 內錯誤 dispatch 分支換成 `return needsUser(ctx,'exit_without_result',...)`。`node --test my-orca && node --test mods/orca-workflow` 全綠 36＋8。 |
