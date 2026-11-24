# Stage 9 Implementation Readiness：發現與處置（第 1 輪）

- **審查範圍：** DetailedRange，第 83–217 行。
- **審查者：**
  - egm-implementation-readiness（Sonnet）
  - egm-codebase-details（Sonnet）
  - egm-style（Haiku）
  - codex gpt-6.2-sol high，原文在 `egm/codex_review_round3.md`
- **判定：** 四方都認為還不能讓實作者「不做任何決定」就開工。差的是實作契約的細節，不是方向問題。codex 確認 3a 允許的差異與受影響測試已經定案。
- **收斂方式：** 以下由 Elephant 把每個開放項目定成具體預設值，寫進 plan 的「實作預設值」段落。實作者照預設值做；要偏離時，必須在提交訊息裡寫明理由。

## 決定（PROPOSE FIX）

1. **逐檔所有權**（codex 1、readiness M2）
   - 規則：
     - 用正規化的 repo 相對路徑判斷是否重複。
     - 來源必須在宣告的來源目錄內；目的必須在 `mods/<mod>/` 內。
     - 目的路徑上任何一層是 symlink（包含斷鏈）就整批拒絕，加 `--force` 也一樣拒絕。
     - 同一路徑不能同時出現在下列任兩處：`handwritten`、共用副本、Herdr 保留檔、builder 產物。
     - 「非法目的檔」指目錄、symlink 或非一般檔案。
     - 遞迴掃描時忽略 `.DS_Store`。
     - layout 檢查讀 repo 裡的 `layouts/<name>.json`，遞迴所有物件的 `id`。
   - 案例：同一根目錄下的 symlink 一個；手寫與共用重疊一個。

2. **寫入前檢查（2b）**（codex 2–3、readiness M1）
   - 檢查順序：
     1. 先比對預期內容和 `mode & 0o777`。兩者都相同就跳過，不檢查 mtime，也不寫入。
     2. 只有內容或模式需要更新的現存目的檔，才做 mtime 預檢：目的檔的 mtime 晚於來源（嚴格大於）就算手改。
     3. 預檢擋下時，把所有路徑印在 stderr，結束碼 1，一個檔都不寫。
     4. 缺少的目的檔一律建立。
   - `--force`：只跳過 mtime 這一項；和 `--check` 同時用時回 2；要寫進 USAGE、README 和 dev-sync。
   - 已知限制：
     - 先手改副本、之後才存來源檔，會讓來源比較新，因此漏擋。
     - 只做 `chmod` 不會改 mtime，也會漏擋。
     - 開始編輯前先跑一次 `--check`，可以找出已經存在的漂移。
   - 3a 第一次交接時，先確認父提交的 20 份副本內容等於「來源加舊說明行」；如果只是 mtime 擋下，用 `--force` 跑一次即可。
   - 案例：在同一個目的樹連續 build，中間只改一份來源，確認其他資產的 mtime 沒有被動到。

3. **loader 的 API**（readiness B2、codebase 3、Missed reuse）
   - 新檔 `scripts/orca-ui-manifests.mjs`，把兩支腳本裡現有的 `manifests()` 走訪程式抽出來共用。
   - 匯出 `ROOT`，以及同步函式 `loadManifests({ root = ROOT, uses })`。
   - 回傳 `{ table, features, shared }`：
     - `table` 是 `Map<repo 相對目的路徑, { kind: "feature" | "shared", id, source, mode, consumers, tests, layoutSlots }>`。
   - 遇到無效的 manifest 時拋出 `ManifestError(message, path)`。
   - `uses` 參數只在 3a 之前使用，型別是 `{ [name]: string[] }`，3a 移除。
   - builder 加 `--root <dir>`（只給測試用），預設值是 `ROOT`。

4. **`app.mjs` 的新格式**（readiness B3、codebase 4）
   - 每個條目是 `{ manifest, area, description, next }`，其中 `manifest` 用 `import … with { type: "json" }` 取得。
   - 拿掉 `id`、`source`、`output`、`layouts`、`shortcuts` 欄位，這些改由 manifest 推得。
   - 保留 `settings`、`build` 兩個 export。
   - 共用 manifest 用同樣的格式登記，`area` 填 `"shared"`。
   - 登記一致性的測試放在 `scripts/orca-ui-manifests.test.js`，現有的 `node --test mods scripts orca-ui/features` 會跑到。

5. **where-error 的輸出契約**（readiness B4、codex 4）
   - `locate(text, table)` 回傳 `[{ frame, edit, kind, note }]`，`kind` 是 `feature`、`shared`、`in-place`、`unknown` 之一。
   - 每個 frame 印成兩行。第一行固定是 `<edit>`（`path:line[:col]`），第二行依 kind：

     | kind | 第二行 |
     |---|---|
     | feature | `  from <frame>; feature "<id>"; tests <…>; layouts <…>` |
     | shared | `  from <frame>; shared helper, copied into <consumer mods>` |
     | in-place | `  from <frame>; not in app.mjs yet: edit this file in place` |
     | unknown | `  from <frame>; unknown path: no such mod in this repo` |

   - `in-place` 是 repo 裡存在、但不在表中的 mod 檔案；`unknown` 是 repo 裡沒有對應 `mod.json` 的路徑。
   - 行號 0 不算 frame。重複的 frame 保留。
   - 結束碼：manifest 壞掉或有衝突時，診斷寫到 stderr，回 2；沒有任何 frame 回 1；其餘回 0。
   - shared 類只列來源和消費的 mod；只有消費的 mod 有 feature manifest 時，才另外列 tests 和 slots。
   - `next` 改從 `app.mjs` 讀，只在 CLI 輸出時附加；讀取失敗不影響結果。

6. **各步驟的檔案清單**（readiness B1、M1）
   - **2a**：
     - 新增 `scripts/orca-ui-manifests.mjs`、`scripts/orca-ui-manifests.test.js`
     - 修改 `scripts/build-orca-ui.mjs`、`scripts/build-orca-ui.test.js`、`scripts/where-error.mjs`、`scripts/where-error.test.js`、`orca-ui/app.mjs`、`orca-ui/features/panel/head/manifest.json`、`README.md`、`.agents/skills/herdr-app-dev-sync/SKILL.md`
   - **2b**：修改 `scripts/build-orca-ui.mjs`、`scripts/build-orca-ui.test.js`、README、dev-sync。
   - **3a**：照 plan 現有的清單，另外加上 `scripts/build-orca-ui.test.js`（抽查範圍擴大為 32 個檔案，並比對模式）。

7. **3a 的寫法和內容**（style 1、readiness M3、M4、codebase 2、5）
   - 標題改為「搬家並切換來源的提交」。
   - builder 的共用展開程式在 3a「新增」：讀 `orca-ui/shared/manifest.json`，把每個來源展開到所有目的地；結尾沒有 LF 就補上，然後加上說明行。
   - `shared/` 原始檔裡四處提到 `sync-shared.mjs` 的註解，依位元組契約保留不改。
   - 2a 的測試 fixture 明確寫成「新建」。

8. **步驟 1 的替身與交付條件**（codex 7）
   - 寫明暫存 `HOME`／`HERDR_APP_HOME`。
   - 在 PATH 最前面放一個 `herdr-app` 替身：只接受 `do orca-status.refresh`，記錄呼叫並回 0。用 `command -v herdr-app` 確認找到的是替身。
   - repo 驗收和 live 交付的完成條件分開寫。宿主相關項目標為待驗時，不影響 repo 驗收。

9. **文字和證據**（style 2–6、codebase 1、6、codex 4）
   - 寫明第一批對照的 A 組是 main，每格 n=2，差異落在雜訊內，而且不影響檢查點的判斷。
   - 修正隔離規則的措辭和 mtime 限制的措辭。
   - 回復演練寫成步驟、清單檔位置和通過條件。
   - 「frame」加進名詞表。
   - `shared/tasks.js` 的連結改指 `mods/orca-chrome/runner.js`。
   - 宿主探針（codex-where-error）標為「待驗」，目前可重跑的證據改以 `scripts/where-error.test.js` 為準。
   - `egm/`、`docs/plan-orca-ui-3b-notes.md` 會隨本輪一起提交，所以連結會有效。

## DECLINE
- 其餘 Nit（codebase 7–10，以及 readiness 的部分 Nit）都是行號範圍或是否引用的細節，不影響實作。
