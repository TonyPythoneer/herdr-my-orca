# where-error retest

Herdr 執行結果：三次 `Herdr check` 都在輸出錯誤框架前，以 `launchd checker submission failed ... Operation not permitted` 退出（-6）。因此 L/R/M 的解析結果是「無 frame」，不能驗證定位器對預期 Herdr frame 的轉換；三者標記 FAIL。每個命令、退出碼和完整輸出見 `evidence.log`，原始 check 輸出分別見 `check-L.out`、`check-R.out`、`check-M.out`。

| probe | truth | Herdr raw frame | where-error output | PASS/FAIL |
|---|---|---|---|---|
| L (load) | `mods/orca-panel-gap/main.js:14` | 無；Herdr exit -6，無 frame | `no mods/<mod>/<file>:<line> frame found in the input` (exit 1) | FAIL（Herdr 未產生 frame） |
| R (render/shared helper) | `shared/panel-motion.js:22` | 無；Herdr exit -6，無 frame | `no mods/<mod>/<file>:<line> frame found in the input` (exit 1) | FAIL（Herdr 未產生 frame） |
| M (migrated feature) | `orca-ui/features/panel/head/main.js:8` (feature `panel/head`) | 無；Herdr exit -6，無 frame | `no mods/<mod>/<file>:<line> frame found in the input` (exit 1) | FAIL（Herdr 未產生 frame） |
| no frame | — | 無 | `no mods/<mod>/<file>:<line> frame found in the input` (exit 1) | PASS |

R 的 canonical 行號由 scratch copy 的 `nl -ba` 記錄於 `line-R.out`。插入後 `Error` token 的列號可由各 scratch 檔案的行內容直接核實；但沒有 Herdr frame，無法實測 column 傳遞。
