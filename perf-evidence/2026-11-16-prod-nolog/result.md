# Main 與分支 P0：關閉計時和 factory 計數

沿用上一組 main／分支的 200 列 fixture 和截圖序列，但移除 JS render 計時、
factory 計數及每 200 ms 的 console 記錄。每組 30 次 `herdr-app shot`，以單調時鐘
量整個指令；來源與生成檔 hash 見 manifest。p95 為排序後第 `floor(0.95 × (n−1))`
筆，30 次不足以精確估計尾部。

| 組別 | 截圖指令 median / p95 |
| --- | ---: |
| A/A 1 | 115.6 / 134.3 ms |
| A/A 2 | 115.9 / 134.2 ms |
| AB 1 A | 121.6 / 131.6 ms |
| AB 1 B | 91.9 / 102.0 ms |
| BA 2 B | 96.6 / 107.2 ms |
| BA 2 A | 117.1 / 136.5 ms |
| AB 3 A | 109.6 / 129.8 ms |
| AB 3 B | 86.3 / 103.3 ms |

三組的截圖指令中位數均降低超過 20% 和 2 ms，也超過這次 A/A 中位數差距。這是
synthetic P0 與截圖工作負載的結果，不是鍵盤或滑鼠事件到 paint 的時間。因已關閉
render 計數，這輪無法確認每張截圖是否都觸發新 render；截圖編碼、IPC、磁碟及
200 ms 測試通知仍在。與有計時的結果一樣，不足以單獨完成 native interaction 驗收。
