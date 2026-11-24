# EGM 審查總結：docs/plan-orca-ui-package.md

**結論：可以實作步驟 2a、2b、3a。**
- codex 最終判定 READY（`egm/codex_final_verdict.md`，第二次複核）。
- Sonnet 在 Stage 9 複審只提出一個 Major，已修正，codex 也確認已解決。
- 3a 之後要不要繼續搬，由計畫裡的 B／C 檢查點決定。3b 的資料放在 `docs/plan-orca-ui-3b-notes.md`，檢查點通過才寫成正式規格。

## 流程

| 階段 | 審查者 | 報告 | 處置 |
|---|---|---|---|
| 5 Zoom Out | zoom-out、inventive-catalyst（Opus）＋ codex sol high | `zoom_out_report.md`、`codex_advice.md` | `stage5-6_resolution.md` |
| 6 Comprehension | comprehension（Opus） | `comprehension_report.md` | 同上，第 1–130 行重寫 |
| 7 Critic | design、structural、style（Sonnet）＋ codex 第二輪 | `critic_report.md`、`codex_review_round2.md` | codex 依處置改寫 |
| 8 Zoom Out | zoom-out（Sonnet） | `intermediate_zoom_out_report.md` | 簡化保護機制；3b 移到另一份檔案 |
| 9 Readiness | readiness、codebase-details（Sonnet）、style（Haiku）＋ codex 第三輪 | `implementation_readiness_report.md`、`codex_review_round3.md` | 新增「實作預設值」 |
| 9 複審（上限一次） | readiness（Sonnet）＋ codex 最終判定 | `codex_final_verdict.md` | 修正 3 處，codex 判定 READY |

## 意見不一致時怎麼取捨

| 議題 | 一方 | 另一方 | 結果 |
|---|---|---|---|
| 寫入保護 | codex 要求記錄上次 build 的雜湊 | zoom-out 要求避免隱藏狀態 | 採用整批預檢：先比內容與模式，再比 mtime，必要時加 `--force` |
| live 上的 `check` | Claude 認為它等同 app 自己載入 | codex 舉出環境變數不同時會讀到個人 session 的情境 | 照 codex 的修法：`check` 只在隔離樹跑，並同時修改 dev-sync |
| 要不要繼續搬 | codex 認為可以照原計畫繼續 | zoom-out 認為證據還不夠 | 3a 之後加檢查點，3b 視結果再決定 |

## 仍需擁有者處理
1. 建立一個沒有 agent 或 GH 憑證的 macOS 測試帳號。在這之前，視窗相關項目與宿主 `check` 都標為「待驗」；純搬家和 repo 驗收不受影響。
2. 決定要不要 commit 這一輪的文件：`docs/plan-orca-ui-package.md`、`docs/plan-orca-ui-3b-notes.md`、`egm/`。計畫裡有連結指向 `egm/`，沒有 commit 的話，乾淨的 checkout 會出現死連結。
