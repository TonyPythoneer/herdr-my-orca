# M0 實際視窗量測（未完成驗收）

結論：200 列 baseline 能在隔離 Herdr 視窗中啟動及 render；`herdr-app check` 的
`interrupted` 不代表 app 無法執行。測試 50 列通過，100、150、200 列均在約一秒內
中斷，與執行預算限制相符，但尚未確認檢查器內部中斷機制。

來源、生成檔 hash 與環境見 [manifest.json](manifest.json)。P0 使用 200 個 synthetic
spaces/agents，空 panes/machines/git/saved，隔離 app home 與 core session。相同的
200 ms probe 在兩側使用；為容納 warmup + 30 秒，生成檔將 probe 上限從 150 改為 400。
每組切換 layout 後 warmup 8 秒，再收集 30 秒；只量 root `render` 中的 `Date.now()`，
每次 render 和 interval 都有 console log。

| 量測 | render 數 | median | p95（排序後第 floor(0.95 × (n−1)) 筆） |
| --- | ---: | ---: | ---: |
| A/A 1 | 143 | 9 ms | 15 ms |
| A/A 2 | 143 | 9 ms | 14 ms |
| AB 1 A | 143 | 13 ms | 18 ms |
| AB 1 B | 144 | 0 ms | 1 ms |
| BA 2 B | 87 | 不完整 | 不完整 |
| BA 2 A | 0 | 無效 | 無效 |
| AB 3 A | 0 | 無效 | 無效 |
| AB 3 B | 0 | 無效 | 無效 |

中途仍有約 143 次 interval／30 秒，但 render 停止，故後四組不可用。系統設定顯示
10 分鐘顯示器休眠，當時 `UserIsActive` 為 0；這是可能原因，並非已證實的唯一原因。
以 `caffeinate` 喚醒後也未恢復 render，不再盲目重跑。第一次完整序列是在首次啟動
welcome 覆蓋視窗下進行，保留在 `covered/`，不計入上述結果。

第一組 AB 的 root 差距不能當整體效能改善：candidate 把工作移至 250 ms projection、
child render 和 native 層；未量事件到可見結果、CPU 或 native paint，沒有 instrumentation
關閉對照，也沒有 P1/P3、鍵盤、捲動與實體輸入測試。應用 log 另有
`Scrollbar("space-list") drives nothing` 警告，需要在候選版正式驗收前追查。

下一步：在開始量測前保持顯示器清醒並確認 window 持續 render，重新執行 A/A 和
AB/BA/AB；收集 callback/projection/adoption 與可見結果的獨立證據，確認 scrollbar，
才可依原定門檻作保留或回退決策。
