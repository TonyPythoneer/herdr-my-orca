# Orca 版面整合檢查

隔離 Herdr 0.1.16 與獨立 core，使用實際 Orca layout、4 個測試 spaces、
本機 Git repo 和 linked worktree。透過 app 命令切換 workspace、terminal stack 和
Changes panel；status 的 errors 為空，畫面與狀態見同目錄。spaces 的 production
`main.js` hash 為 `3c9a31ba3a9edbb0c5d3df54758716785da870c2075ab3fdbdfe491c99ae0247`。

測試副本停用 status provider 查詢，避免讀取個人憑證或連線外部服務；這是功能 smoke，
不是 P3 效能比較。未驗證遠端機器、完整 native frame trace 或端到端互動延遲。
