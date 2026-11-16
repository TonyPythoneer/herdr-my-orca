# 交接說明：本輪 Solar 做了什麼、留給下一輪做什麼

## 後續進度（2026-11-16）

- 修正 `due()` 將負快取誤判為舊版資料而每 250 ms 重試 Git 的問題；負快取仍在
  60 秒後重試，離線 host 恢復 ready 時立即重試，暫時性失敗不清除既有 repo snapshot。
  `git-refresh.test.js` 覆蓋這些路徑；隔離 app 的 3 個非 Git 目錄在約 28 秒內只各查
  一次，真實 repo 暫時失敗後保留兩個 worktree，還原後 branch 變更能刷新。
- 新增正式分支對 main 的 P0 有／無 instrumentation 的 A/A 與 AB/BA/AB，以及隔離
  native 捲動、收合、Tab、Shift-Tab、拖曳與重啟保存證據，見
  `perf-evidence/2026-11-16-{prod,prod-nolog,native}/result.md`。合併樹與目前未提交
  變更的 13 個測試檔全部通過，五個變更 mod 的 `herdr-app check` 通過。
- 已在隔離 app 實際啟動 200 列 baseline，並量到 A/A 與第一組 AB 的 root render；
  顯示器閒置後 render 停止，餘下比較無效。完整數據、原始 log、來源 hash、限制及
  scrollbar 警告見 `perf-evidence/2026-11-16-m0/result.md`。
- P0 的兩個 builder 現在都固定 `panes()` 與 `machines()` 為空，避免讀取目前使用者的
  工作區；這只是 synthetic P0，不代表多主機情境。相關回歸測試共 51 項通過。
- baseline 200 列的 check 曾回報 `interrupted`；將暫存產物縮為 20 列後通過，候選版
  200 列也通過。這不能證明中斷原因，亦不能代替 200 列的實際 app 驗證。
- 修改後 `scripts/perf-spaces.py` SHA-256 為
  `4921b0d813ac28b2600a9f15fea89fdf55ecb3d0db15f608bfdf32c2f55c3b6c`；下面列出的
  先前 hash 是修改前的值，不可用來識別目前 builder。
- 候選 builder 不再自動執行 focus smoke；100 ms focus tick 保留供真正的焦點請求使用。
  250 ms projection/adoption 僅在 adoption 有操作時通知；共用的 200 ms probe 仍存在。
- 新增 builder 回歸測試；`node --test scripts/perf-spaces-virtual.test.js mods/orca-spaces/*.test.js`
  通過 50 項。`herdr-app check` 候選版通過，baseline 在 200-row 首次 render 報
  `interrupted` 而失敗，因此尚不能將兩者當成已通過的可比較 fixture。
- 實際工作樹來源 SHA-256：`main.js` 為
  `db3c70b3c2bd49ef7f909da916fc2a85f815eb5ae455568babefecc025474637`，與下方舊紀錄不同；
  `focus.js`、`perf-spaces.py` 分別為
  `73385b926a7722ac96452778340a956ccd5220863e8dd94d4da6aa6f9c088fa5`、
  `408a27c215641e24cc10ed92de71b761135976ecbf3ca05d6061db2e90ce7b8d`。
- 仍需固定 panes/machines/shared 等來源、確認兩側事件和通知等價，處理 baseline check
  失敗，再執行 A/A 及 AB/BA/AB；沒有新的效能或 native 量測結果。

工作目錄：`/Users/tonyyang/git/herdr-my-orca.worktrees/perf-todo`
分支：`perf-todo`

## 本輪做的

1. 把舊的 20 段累加式 `perf-todo.md` 蓋掉，換成本文件：M0 建立可相信的比較、H01–H30
  、H09–H17 候選版上線檢查、H18–H26 正式資料與面板、H27–H30 正確性與觀測、分工表、
   完成條件、結果檔格式。
2. 做了 M0a 靜態校正：凍結 `main.js`、`focus.js`、`perf-spaces.py` 的 SHA-256 並寫進
   `perf-evidence/2026-11-16/measurements.json`；列出 `scripts/perf-spaces-virtual.py`
   的替換表（scroll container 改 host、list ID、loading 高度、synthetic fixture、200 ms
   probe、100 ms focus smoke、250 ms 輪詢改 `prepareVirtualRows`/`syncRetained`）。
3. 產出 `perf-handoff.md` 保留，給下一輪真正重現時用。生成檔 `gpui-kit.d.ts`、`jsconfig.json`
   保留不清理。
4. 寫 `perf-evidence/2026-11-16/result.md` 做為本輪交接結果記錄。

## 已做的限制

- 沒有啟動 Herdr。
- 沒有執行任何性能測試，只有靜態分析與舊檔讀取。
- 沒有修改 production 程式；舊 20 段 todo 只被本文蓋掉，歷史與證據保留。
- `main.js`、`focus.js`、`perf-spaces.py` 的 SHA-256 恕我直說，很可能有誤：前者應是
  Generator 版本，後兩者已有效。新任務的來源身份必須以本輪產出的 manifest 為準，禁
  止只寫 HEAD。
- 本輪 `final` 數據（10/8 ms、4 factories）來自舊 probe script 與 generator 版本的落差，
  不能當作新成績，也不能當作已驗收的效能飛行數據。

## 交給下一輪的

- M0b：事件分層與觀測規格（已寫本文，已做靜態分解，不產出完整 trace）。
- M0c：拆 P0/P1/P2/P3、關閉自動焦點、固定同 cadence 的 A/B。
- 真正量測：先量 A/A 噪音，再做 AB/BA/AB 各三組；達 M0 門檻才叫改善。
- 按證據選一個 H 做 S1/S2，先寫能否證假設的測試。
- native/physical input/完整 trace 不做：標 UNMEASURED。
