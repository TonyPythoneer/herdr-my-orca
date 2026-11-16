# 隔離 native 互動驗證

- Herdr 0.1.16，獨立 app home 與 `orcaui` core session；沒有使用使用者的正式 core。
- 正式 `orca-spaces/main.js` SHA-256：
  `3c9a31ba3a9edbb0c5d3df54758716785da870c2075ab3fdbdfe491c99ae0247`；隔離 mod 的
  同一檔案 hash 相同。`focus.js`：
  `73385b926a7722ac96452778340a956ccd5220863e8dd94d4da6aa6f9c088fa5`。
- 20 列 synthetic fixture：實際捲至第 20 列並返回；群組收合與展開。注入一次性的
  `enter()` 以進入鍵盤模式後，按 Tab 從首組新增按鈕移到卡片，Shift-Tab 回到按鈕；
  焦點框均在預期位置。這沒有驗證從其他 pane 進入，以及完整長列表焦點順序。
- 真實隔離 core：建立 Smoke One、Two、Three 三個 spaces，拖曳 One 到 Three 之後；
  app 與 `herdr-app ls` 均顯示 Two、Three、One。收合 Three 並重啟 app，排序與收合
  狀態保留；[restart.png](restart.png) 及 [spaces.json](spaces.json) 是重啟後證據。
- 對同一正式來源的暫存副本只在 `check()` 加一行計數 log，重啟後三個非 Git 資料夾
  各檢查一次，約 28 秒內沒有再次檢查；[git-pacing.log](git-pacing.log) 保存三筆。
  單元測試另驗證 60 秒重試、舊版 cache、暫時性失敗與既有 snapshot 保留。
- 本機隔離 repo 有主 worktree 和 linked worktree；只開 linked，確認主 worktree 也
  出現。暫時移走 linked 目錄並重啟後，插入的診斷 log 確認 Git 查詢失敗，畫面及
  cache 仍保留兩個 worktree。還原目錄後將 branch 改名，cache 隨 watch 更新為
  `smoke-restored`；見 offline／reconnected 截圖、cache 與 log。這模擬本機路徑暫時
  不可用，不是遠端機器重連測試。
- 隔離 fixture 不包含遠端機器、PR、已儲存專案或完整 Orca layout；沒有做跨 host
  拖曳、遠端離線重連或 native frame trace。
