# Stage 7 Critic Review 與 codex 第二輪：發現與處置

**審查範圍：** FeatureRange 第 1–81 行。codex 第二輪看的是第 1–130 行。

**審查者：**
- egm-design、egm-structural、egm-style（皆用 Sonnet）
- codex gpt-6.2-sol high，原文在 `egm/codex_review_round2.md`

**codex 判定：** 步驟 2–3 尚不能實作（NOT YET）。

**收斂策略（Elephant 決定）：** 「可以實作」的定義收窄為：**下一步（步驟 2 補強 builder、步驟 3a 共用 JS 交接）不需要再做任何決定就能動手**。
- 檢查點移到 3a 之後、3b（側欄）之前。這採用 design #2 和 codex #9 的建議。
- 3b 以後的批次不在本次寫死細節。改由「批次規格清單」規定每批開工前必須補齊的內容。
- 會有這樣的取捨，是因為 3b 本身是否該做，要等檢查點的結果才知道。

處置分類：PROPOSE FIX 表示要改 plan；DECLINE 表示記錄但不改；ESCALATE 表示需要擁有者決定。

## 處置

| 來源 | 發現 | 處置 |
|---|---|---|
| codex 1、design 5 | 逐檔所有權的規則不完整：子目錄、只接管 helper 的目錄、共用副本、重複認領 | PROPOSE FIX：在步驟 2 寫明 loader 的資料形狀、遞迴掃描、拒絕重複的目的地，以及允許清單的組成 |
| codex 2、design 6 | 寫入保護少了檔案模式與缺檔的規則；用 `HEAD` 判斷，會在「build 兩次才 commit」時誤擋 | PROPOSE FIX：符合以下任一條件就可以寫入：與新產物相同、與 `HEAD` 相同、與上次 build 記錄的雜湊相同（記錄檔放在 `.git/orca-ui-build.json`）。比較時同時看內容與模式；寫入前先拒絕 symlink |
| codex 3 | exec mod 的清單寫錯：實際是 15 個，漏了 handoff、chrome；Spaces、Changes、Files 也會呼叫 gh、curl 或外部 app | PROPOSE FIX：視窗測試一律在沒有憑證的 macOS 測試帳號裡進行；在這個帳號建好之前，視窗相關項目標「待驗」，但不擋純搬家的批次。**ESCALATE：測試帳號要由擁有者建立** |
| codex 4 | ⌘B 的驗收和現況基準相反 | PROPOSE FIX：照 codex 的描述寫出各 layout 的預期行為（放進 3b 的批次規格） |
| codex 5 | 驗收樹沒有接到新產物上 | PROPOSE FIX：3a 是純搬家，直接在 repo 裡 build，然後跑 `--check`、完整測試、對空目錄重建一次並比對；3b 的驗收樹細節移到批次規格清單 |
| codex 6 | 3a 和 3b 允許的差異規則互相衝突 | PROPOSE FIX：3a 只允許 20 個檔案的最後一行（說明行）不同，並寫明新說明行的文字；同一批要修改的測試列在 3a |
| codex 7、design 3、design 4 | 反查工具 `where-error` 的分類與保底行為不清楚；完成條件寫得過頭 | PROPOSE FIX：分成四種結果（受管、已知手寫、未知路徑、沒有 frame）；`app.mjs` 載入失敗時，仍可直接從磁碟上的 manifest 反查；完成條件收窄為「載入與 render 錯誤」 |
| codex 8 | 兩個提交的回復順序；dev-sync 不會刪除 live 上多出來的檔案 | PROPOSE FIX：先回 3b 再回 3a；live 上剩下的檔案列給擁有者處理 |
| codex 9、design 2 | 檢查點的時機與題目 | PROPOSE FIX：檢查點放在 3a 之後；題目、預期 diff、計分方式都寫死 |
| codex 10 | 「沒有任何工具改寫三份設定」說得太廣（agent-manager 會寫 live 的 `programs.json`） | PROPOSE FIX：收窄為「builder 不生成、遷移不覆寫」 |
| codex 11 | `titlebar-height.py` 的現況寫錯；layout 差異清單不完整 | PROPOSE FIX：寫上實際的參數；差異清單只當例子，驗收以完整 JSON 全等為準 |
| codex 12 | 完成條件可能漏測 | PROPOSE FIX：基準綁定 SHA，按測試名稱比對；純搬家要同時比對 blob 與 Git 模式 |
| codex 13 | 幾處說法太絕對 | PROPOSE FIX：寫明 hc 與 herdr-core 的關係、OMP 目錄的優先順序；結論限定在已測過的版本 |
| structural 1–4 | 缺少問題陳述、目標／非目標、替代方案、風險與限制 | PROPOSE FIX：四段都補上 |
| structural 5–7、10 | 名詞表放錯層級、用粗體充當標題、架構散在兩節、表格格子太長 | PROPOSE FIX：名詞表提升為 H2；粗體改成 H3；格子內容拆短 |
| structural 8 | 連結 | PROPOSE FIX：repo 內的檔案改成相對連結；`egm/` 會隨本輪一起提交 |
| style 1–7 | 寫法：說法過度、重複、格子過長、主張沒附證據 | PROPOSE FIX：一併改寫 |
| style 8–17、design 9–11 | 寫法上的小問題 | 能順手改的就改，其餘 DECLINE |
| design 1 | 替代方案：延用 sync-shared、從 manifest 生成 app.mjs、只做 manifest 索引 | PROPOSE FIX：寫進替代方案表 |
| design 7 | `shared/` 和 `orca-ui/shared/` 同時存在的期間 | PROPOSE FIX：3a 在同一個提交裡刪除 `shared/` 與 `sync-shared.mjs`，所以兩者不會同時存在 |
