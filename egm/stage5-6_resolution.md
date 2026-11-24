# Stage 5–6 處置紀錄

Status: resolved

**這份紀錄是怎麼來的：** 擁有者要求整個流程不停下來跑完，並自行判斷 plan 能不能收斂到可以實作。所以我（Elephant，也就是持有完整對話脈絡的主 agent）直接處理了 Stage 5 與 Stage 6 的發現，把 plan 的現行段落（第 1–130 行）整段改寫；歷史段落沒有動。

**處置分類：**
- **PROPOSE FIX**：審查意見成立，已修改 plan。
- **DECLINE**：只是小問題（Nit），記錄下來但不修改。
- **ESCALATE**：審查意見我認為不對，但證據在審查者讀不到的地方，需要擁有者判斷。

| 發現 | 處置 | 修改內容 |
|---|---|---|
| Z1 搬家前沒有「做還是不做」的檢查點 | PROPOSE FIX | 新增步驟 4 的檢查點：第二批之後拿 B 組和 C 組比一題跨三個以上 mod 的題目，每組至少 3 次，並寫明繼續或停止的門檻。第二批照做，因為不管走哪條路，共用 helper 都必須統一由一支工具寫入。 |
| Z2 寫入前沒有擋下手改 | PROPOSE FIX | 步驟 2：目的檔和新產物不同、也和 `HEAD` 不同時，就中止整批；同時附一個測試案例。另外拿掉原本「已修正」的錯誤說法。 |
| Z3 `--check` 抓不到未宣告的產物檔 | PROPOSE FIX | 步驟 2：`--check` 列出整個輸出目錄，再扣掉 manifest 宣告的檔、Herdr 寫入的兩個檔、`USES` 分到該 mod 的副本，以及 `handwritten` 清單。 |
| Z4 `app.mjs` 和 manifest 各寫一份描述 | PROPOSE FIX | 步驟 2：`app.mjs` 改成 import manifest；builder 和 where-error 共用同一個 loader；manifest 沒有列在 `app.mjs` 裡就回傳 2。 |
| Z5 manifest 有沒人讀的欄位 | PROPOSE FIX | 拿掉 `commands`、`shared`。保留 `layoutSlots`、`keys`，並讓 builder 檢查它們確實存在。 |
| Z6 為不存在的安裝器訂規則 | PROPOSE FIX | 寫明這份計畫沒有安裝器，三個設定檔不由任何工具寫入；回復方式改成 `git revert` → 重建 → dev-sync。 |
| Z7 純搬家的驗收過重 | PROPOSE FIX | 步驟 5 分兩種批次：純搬家只要位元組相同就算通過；產物會改變的批次才做視窗冒煙測試。 |
| Z8 exec 類 mod 沒有解除排除的條件 | PROPOSE FIX | 依風險把 13 個 exec mod 分成兩類，並寫明解除條件：建立一個沒有憑證的 macOS 測試帳號。 |
| Z9 側欄範圍與 ⌘B 的基準 | PROPOSE FIX | 已實際讀程式確認：`orca` 的 ⌘B 被 `mods/orca-tabs/main.js:409` 擋掉，沒有作用。側欄那一列已改正，並列出 3b 的範圍；三份 `sidebarFrame` 也逐字比對過，內容相同。 |
| Z10 staging 驗收樹不完整 | PROPOSE FIX | 步驟 3 寫明驗收樹怎麼組成，並規定快照不存在時判失敗。 |
| Z11 文件和程式對不上 | PROPOSE FIX | 先修 plan 的部分；`app.mjs` 和 README 的不一致列進步驟 2，到時一起修。 |
| Z12 現行計畫裡有太多實驗紀錄 | PROPOSE FIX | 數據和細節搬到評估文件和實測報告，現行計畫只留結論加連結；逐段署名改由「已決事項」統一說明。 |
| Z13 生成檔裡沒有「生成」標記 | DECLINE | `where-error.mjs` 和 dev-sync 的規則已經涵蓋；如果加標記，還得讓 `--check` 改成比對「來源加標記」，多出一層複雜度。 |
| C1 分不清哪些已完成、哪些是計畫 | PROPOSE FIX | 文件開頭加一行狀態。 |
| C2 manifest 的用詞混亂 | PROPOSE FIX | 名詞表加上 feature 和 manifest 的定義；路徑清單補上 manifest 和 where-error。 |
| C3 Herdr 的 app、core、hc、shot 沒有定義 | PROPOSE FIX | 名詞表補上。 |
| C4 兩套 layout 的用途沒有說明 | PROPOSE FIX | 名詞表補上。 |
| C5 安裝器和 dev-sync 沒有定義 | PROPOSE FIX | 名詞表補上，並寫明「沒有安裝器」。 |
| C6 titlebar-height.py 沒有說明 | PROPOSE FIX | 寫明它會寫入 `layouts/*.json`（repo 和 live 兩邊），在步驟 5 移交。 |
| C7 現行計畫依賴歷史段落 | PROPOSE FIX | 把需要的內容寫進現行段落，不再引用歷史 Task 1 或 P0／P1。 |
| C8 測試放哪裡沒寫定 | PROPOSE FIX | 寫明已定案：搬到 feature 來源旁。 |
| C9 有名詞沒定義 | PROPOSE FIX | 補上八個共用 JS 和 `OMP_`／`PI_` 變數；layout slots 併進 manifest 的定義。 |
| C10 署名標記沒有說明 | PROPOSE FIX | 現行計畫不再逐段署名。 |
| C11 測試基準看似互相矛盾 | PROPOSE FIX | 基準改成 440／440；只在第一批對照的說明裡提到 A、C 組的 16 個失敗。 |

**codex 顧問（`codex_advice.md`）的 4 個 blocker 都已處理：**
1. 逐檔對應 → 對應 Z4 和 3a 的處置。
2. 寫入前擋下手改 → 對應 Z2 和 Z3。
3. 側欄基準 → 對應 Z9。
4. 驗收樹 → 對應 Z10。
