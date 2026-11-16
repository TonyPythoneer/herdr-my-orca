# Main 與分支的 P0 量測

在隔離 Herdr 0.1.16 視窗比較 main `d38d045` 與分支 `74d89ae` 的正式
`orca-spaces`，不是 virtual candidate。來源及生成檔 hash、fixture、原始記錄和執行
程序見同目錄。每組 200 筆 synthetic spaces/agents，200 ms 通知，warmup 後每秒要求
截圖 30 次，連續進行 A/A、AB、BA、AB。

| 組別 | root render 樣本數 | root median / p95 | 截圖指令 median / p95 |
| --- | ---: | ---: | ---: |
| A/A 1 | 24 | 43.5 / 50 ms | 117.7 / 131.7 ms |
| A/A 2 | 30 | 40 / 41 ms | 99.9 / 102.4 ms |
| AB 1 A | 30 | 40 / 42 ms | 100.0 / 103.1 ms |
| AB 1 B | 30 | 10 / 13 ms | 69.1 / 90.7 ms |
| BA 2 B | 30 | 9 / 13 ms | 69.8 / 99.6 ms |
| BA 2 A | 29 | 40 / 50 ms | 100.8 / 132.9 ms |
| AB 3 A | 30 | 40 / 43 ms | 100.6 / 104.4 ms |
| AB 3 B | 30 | 9 / 12 ms | 68.9 / 96.4 ms |

截圖指令以單調時鐘計時，包含 IPC、實際 render、圖片編碼和磁碟寫入；root 使用
`Date.now()`，精度 1 ms。p95 為排序後第 `floor(0.95 × (n−1))` 筆；30 次不足以精確
估計尾部。每次 render 和 interval 都輸出 log，未量關閉 instrumentation 的成本。
顯示器閒置時截圖會觸發 render，但每個截圖請求不一定對應一次新 render。這些結果
顯示此 synthetic fixture 的 root render 和截圖指令中位數下降，超過此次 A/A 差距；
不能由此推論一般操作的延遲、CPU、native paint 或其他資料情境也改善。

尚需真實資料和 native interaction 驗證；不要把 `shot` 指令耗時稱為 input-to-paint。
