READY WITH FIXES

審查範圍為現行計畫第 1–268 行。2a 的反查分類與 3a 的 live 驗收各有一處規則衝突。兩處都可用一句明確的預設規則處理。

| 上輪項目 | 核對結果 |
|---|---|
| Blocker 1 | 已解決。計畫 L128–132、L141–145 要求正規化後逐檔互斥，並在整批寫入前拒絕目的路徑上的 symlink 和斷鏈，`--force` 亦適用。涵蓋現有 builder 直接寫目的檔的問題。 [現有寫入路徑](../scripts/build-orca-ui.mjs#L73-L88) |
| Blocker 2 | 已解決。計畫 L152、L160 明定先比 bytes 與模式，相同檔跳過，用同一輸出樹重建驗證。現有測試使用兩個空樹，計畫已另指定同樹案例。 [現有建置測試](../scripts/build-orca-ui.test.js#L12-L24) |
| Major 3 | 已解決。計畫 L152–162、L204 明定補檔、checkout 誤擋、`chmod` 限制、`--force` 邊界及 3a 的首次交接。核對八份來源、13 個消費 mod、20 個唯一副本及模式，均與現況相符。 [舊副本生成規則](../scripts/sync-shared.mjs#L10-L27) |
| Major 4 | 尚有一處。登記、`next`、輸出、退出碼、共用 metadata、README 及宿主證據的處置均已明定。受管副本缺檔時的分類見下。 [實作預設值與 2a](../docs/plan-orca-ui-package.md#L88-L103) [現有反查測試](../scripts/where-error.test.js#L7-L32) |
| Major 7 | 尚有一處。暫存 HOME、PATH 替身及 repo 驗收條件均已明定。live 驗收仍與宿主隔離規則衝突。 [計畫交付條件](../docs/plan-orca-ui-package.md#L109-L118) [實際 PATH 呼叫](../mods/orca-status/claude-statusline.sh#L98-L103) |

1. **Major 4｜2a 反查對缺失的受管副本有兩種結果。** 例如 `mods/orca-panel-head/panel-views.js` 已從 repo 輸出樹刪除，但 live 遇到的舊 frame 仍指向它。計畫 L92 的表命中規則會給來源座標，同一行的缺檔規則會給 `unknown`。現行定位器按 manifest 找到來源，且現有漂移測試已涵蓋受管檔缺失。明定表命中優先，僅未命中時用 repo 檔案存在性和 `mod.json` 分辨 `in-place`／`unknown`，路徑越界一律 `unknown`。 [計畫 L92](../docs/plan-orca-ui-package.md#L92) [現有定位](../scripts/where-error.mjs#L35-L44) [缺檔案例](../scripts/build-orca-ui.test.js#L49-L52)

2. **Major 7｜3a 的 live 完成條件仍要求在 live 路徑做宿主 `check`。** 計畫 L113–118 要求 `check` 用無憑證測試帳號和隔離樹，live 交付又沿用 dev-sync，其中要求對每個改動的 live mod 執行 `check`。3a 涉及 `orca-agents`，其 `init()` 會啟動讀取 OMP session 的子程序，預設讀子程序的 `$HOME/.omp/agent`。明定宿主 `check` 只在隔離樹完成，並同步修改 3a 的 dev-sync，寫清 live 核對項及測試帳號未就緒時的交付狀態。 [計畫 L113–118](../docs/plan-orca-ui-package.md#L113-L118) [dev-sync](../.agents/skills/herdr-app-dev-sync/SKILL.md#L8-L12) [Agents 初始化與掃描](../mods/orca-agents/main.js#L263-L312) [session 根目錄](../mods/orca-agents/main.js#L149-L166) [子程序探針](../artifacts/orca-bundler/20261123T162528Z-retest/exec/RESULT.md#L14-L27)

現有 builder 與 sync-shared 的唯讀檢查及 5 個反查／共用測試通過。完整 suite、Herdr 宿主與 live 交付本輪未執行。

## 修正後複核
NOT READY

- (1) 已解決。先拒絕越界，再查表。受管副本即使缺檔仍回來源座標，只有未命中才看檔案與 `mod.json`。 [計畫 L92](../docs/plan-orca-ui-package.md#L92)
- (2) 未解決。L114、L116 要求宿主 `check` 隔離，L118 允許在 live 執行，且 repo 驗收仍可把宿主項目列為待驗。 [計畫 L114–118](../docs/plan-orca-ui-package.md#L114-L118)
  具體情境：擁有者啟動 app 時用 `OMP_CODING_AGENT_DIR` 指向工作專用 session 目錄，交付終端沒帶這個變數。3a 只同步 `orca-agents/panel-motion.js`，live `check` 仍會跑 `main.js` 的 `init()`，可能轉去讀 `$HOME/.omp/agent/sessions` 裡最近 12 份個人對話的首尾。探針已證實子程序可在 `check` 回 0 後才完成。 [3a L177](../docs/plan-orca-ui-package.md#L177) [掃描路徑](../mods/orca-agents/main.js#L149-L166) [初始化](../mods/orca-agents/main.js#L263-L312) [探針](../artifacts/orca-bundler/20261123T162528Z-retest/exec/RESULT.md#L14-L27)
  宿主 `check` 應在隔離樹完成，測試帳號未就緒就標待驗。同步更新 dev-sync 第 3 點，live 核對同步檔與現有 app 狀態。 [dev-sync L10–12](../.agents/skills/herdr-app-dev-sync/SKILL.md#L10-L12)
- (3) 已解決。3a 的唯一共用 manifest 條目、欄位、CLI 對應及登記測試均已明定。 [計畫 L91](../docs/plan-orca-ui-package.md#L91)

本輪為文件與原始碼複核。宿主行為依既有探針判讀。

## 第二次複核
READY

- (2) 已解決。L114–118 一致要求宿主 `check` 在測試帳號的隔離樹執行。測試帳號未就緒時記為「live 已同步、宿主 check 待驗」。Live 僅逐檔 `cmp` 並確認擁有者視窗的 `herdr-app status` 無新錯誤。 [計畫 L114–118](../docs/plan-orca-ui-package.md#L114-L118)
- 3a 的檔案清單已列入 `.agents/skills/herdr-app-dev-sync/SKILL.md`，與 L118 要求同一提交更新 dev-sync 第 3 點一致。 [3a 檔案清單](../docs/plan-orca-ui-package.md#L107)
