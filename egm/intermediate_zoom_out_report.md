# Stage 8 Intermediate Zoom Out：發現與處置

**審查者：** egm-zoom-out（Sonnet）。

**審查範圍：** 改寫後的現行計畫，第 1–282 行。

**結論：** 需要修改。為了補強，計畫加了幾套機制（記錄上次 build 的雜湊、過渡用的 `writer` 欄位、保底 loader、逐段列舉的路徑規則），超出了步驟 2 和 3a 實際需要的範圍。Stage 5 提出的 13 項，大多已經處理；其中 Z2 和 Z4 的做法，就是這次 M1 和 M3 指出的問題。

**取捨：** 這一輪的意見和 codex 前一輪剛好相反。codex 要求把規則寫得更嚴密，zoom-out 要求把機制減到最少。我判斷的原則是：只要較簡單的規則能擋住同一個風險，就用較簡單的規則；必要的檢查保留下來，但改放在測試裡。

| 發現 | 處置 |
|---|---|
| M1 用雜湊記錄做寫入保護 | **PROPOSE FIX（簡化）**：拿掉雜湊記錄和 `HEAD` 比對，改成整批先檢查：只要有任何目的檔的修改時間比它的來源檔新，就判定為有人手改，印出路徑後中止整批，一個檔都不寫；確認之後可以用 `--force` 強制覆寫。正常的流程（改來源 → build → 再改來源 → 再 build）不會被誤擋。已知限制：`git checkout` 會改動 mtime，可能誤擋，這時用 `--force`，並在程式註解寫明這個限制。輸出到空目錄時不做這項檢查。 |
| M2 兩種 manifest 加上過渡用的 `writer` 欄位 | **PROPOSE FIX**：步驟 2 只把 `USES` 當成唯讀的「允許副本路徑」清單，不把它展開成記錄，也不加 `writer` 欄位。共用 manifest 到 3a 才出現。`handwritten` 只寫在需要例外的 feature 目錄，不另外自動推斷。 |
| M3 保底 loader | **PROPOSE FIX**：loader 一律從磁碟找 manifest；`app.mjs` 單向 import manifest；「`app.mjs` 有登記的等於磁碟上找到的」改成一個 `node --test` 測試案例；builder 和 where-error 都不 import `app.mjs`，也就不需要保底模式。 |
| M4 路徑驗證與寫入安全的細節太多 | **PROPOSE FIX**：路徑規則只保留「解析後的路徑在 repo 內，而且是一般檔案」；拿掉「先寫暫存檔再 rename」；把重複的驗收案例合併。 |
| M5 3b 的規格和已知事實放在現行計畫裡 | **PROPOSE FIX**：移到 `docs/plan-orca-ui-3b-notes.md`，現行計畫只留一行連結。回復演練裡「假的 app home」那部分一併移走。 |
| M6 步驟 2 太大 | **PROPOSE FIX**：拆成 2a（loader、遞迴版 `--check`、where-error 改讀 loader 的表、README 修正）與 2b（寫入前的檢查）。 |
| N1 檢查點的成本 | DECLINE：C 組的做法已經是最小差異。 |
| N2 步驟 1 仍有實驗細節 | **PROPOSE FIX**：精簡成一句話加連結。 |
