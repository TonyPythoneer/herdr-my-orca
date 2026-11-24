# 本輪改寫紀錄

## 非顯而易見的決定

- 步驟 2 先定出可接收兩種 manifest 的路徑表，先用 fixture 驗共用格式。3a 才用它接管 USES 的 20 個目標。
- 上次 build 記錄按目的 worktree 隔離，保存原始 bytes 的 SHA-256 和完整權限位。HEAD 的 Git mode 轉成標準權限位，用來保護沒有 Git 執行位差異的手動 chmod。
- 獨立 staging 免查 HEAD，現有檔只可在與新產物完全相符時跳過。先逐檔完成整批預查，再更新產物，最後更新成功記錄。
- 反查的 fallback 沿用展開及驗證規則。無法判斷所有權時輸出未知路徑，缺少欄位就省略。舊 shared 路徑另命中兩個 agent-config 測試的註解，一併列入 3a。
- B／C 題目固定為收窄時位移 28px→16px，搭配標準版 ⌘⇧F 聚焦且不重搜。兩組共用 helper builder 和同一份起始 README，C 只把 panel-head 改回原地維護。

## 基準輸出

以 `git archive 9b9e22a` 暫存副本、Node v26.13.1 和 PATH 替身執行完整 suite。替身收到 3 次 `do orca-status.refresh`。本輪驗證範圍為 Node 測試與文件檢查，Herdr 宿主及真視窗待驗。

```text
1..440
# tests 440
# pass 440
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## 待擁有者動作（1 項）

- 建立無 agent／GH 憑證與 session 的 macOS 測試帳號。建立前視窗與需要此環境的 `check` 待驗，純搬家可繼續。
- 未來回復若有 live 剩檔，由擁有者依當批清單處理。本輪沒有 live 清理項目。
