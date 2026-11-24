步驟 2–3：NOT YET

以下 L 指 `docs/plan-orca-ui-package.md` 的行號。

## 會卡住步驟 2–3 的問題

1. **Blocker｜L35、94–97、101–102｜Z3–Z5，逐檔所有權。** `scripts/build-orca-ui.mjs:34–51,73–89` 假設一份 manifest 對一個目錄，且只看來源第一層。照搬會漏收 Spaces 的 `agent-icons/`，或把 3a 的 `review-store.js` 在 3b 重複宣告。`handwritten` 也沒有說明如何涵蓋只接管 helper 的 13 個目錄。
   - **修法。** 步驟 2 定稿共用 loader 的路徑表。保留 feature 的 `files`，3a 使用 `orca-ui/shared/manifest.json` 的 `{files:[{source,outputs:[…]}]}`，路徑皆相對 repo 根。讓 `app.mjs` 登記兩種 manifest。遞迴比對 feature 來源的檔案清單，展開所有來源與輸出後拒絕重複目的地及受管檔與 `handwritten` 重疊。步驟 2 也拒絕 feature 認領 `USES` 的目的檔。3a 對只接管 helper 的目錄逐檔比對，3b 起對有 feature 的目錄遞迴掃描，以所有 manifest 在該目錄的目的地聯集、逐檔 `handwritten` 及兩個 Herdr 生成檔作允許清單。測一個共管目錄與一個重複認領。
2. **Blocker｜L76、94–97｜Z2，寫前保護少了模式與缺檔規則。** 內容相同就跳過，會留下 `--check` 判定失敗的模式。`scripts/build-orca-ui.mjs:78–88` 比對並複製 `0o777`，`scripts/build-orca-ui.test.js:40–52` 已有模式與漏檔案例。現案也無法判斷 HEAD 無檔、工作樹刪檔或目的地指向其他 worktree 時如何處理。
   - **修法。** 寫之前展開、讀取並核對整批。正式 repo 輸出以實際目的 worktree 的 HEAD blob 和 Git 執行位元為基準。現檔符合新內容及模式即跳過。符合 HEAD 即可更新。兩邊均無檔則新增。其餘情況（含只在 HEAD 有檔、只有工作樹新增檔且與產物不同）列路徑與內容／模式差異、退出 1，零寫入。對獨立 staging 免做 HEAD 比對。驗證路徑留在預定根下，拒絕 symlink 和非一般檔案。加同內容異模式、第二檔手改且第一檔本會更新的測試。
3. **Blocker｜L88–92、102–103｜Z8，exec 清單錯且隔離不足。** 實際有 **15 個**呼叫 Herdr `exec` 的 mod。漏了 `orca-handoff`（`mods/orca-handoff/main.js:70–77,115–147`）和 `orca-chrome`（`mods/orca-chrome/main.js:58–59`、`runner.js:83–88,111–114,129–136,169`）。Chrome 在空任務清單下仍會探測 Claude 快取與 Codex session（`shared/tasks.js:265–279`）。「只做 Git 與檔案操作」也不成立。Spaces 會跑 `gh`、`curl`（`mods/orca-spaces/main.js:474,573`、`project.js:92–100`），Changes 有 `gh`，Files 會開外部 app（`mods/orca-changes/main.js:315–316,347–348`、`mods/orca-files/main.js:645,1078–1085`）。
   - **修法。** 補列兩個 mod，按測試路徑列可執行的副作用。3b 的真視窗使用乾淨 macOS 測試帳號、無 agent／GH 憑證、僅本機 fixture 與空任務清單。先確認 app、core 的 socket，以及實際子程序的 HOME、PATH、Git／GH 設定。要用替身就從 core 子程序驗證確已生效。高風險 mod 的 `check` 也用該隔離環境，未具備時以 fixture 測試驗收離線項目並標真視窗／check 待驗。來源請直接連 `artifacts/orca-bundler/20261123T162528Z-retest/{window,exec}/RESULT.md`（前者 L18–29、後者 L14–27）。Stage 9 報告 L32 仍記載視窗待測。
4. **Blocker｜L30、102、128｜Z9，⌘B 驗收與基準相反。** `keys.json:37` 送 `orca-tabs.toggle-sidebar`，標準版 tabs 無 unified props（`layouts/orca.json:110–118`），接收端在 `mods/orca-tabs/main.js:402–413` 略過。直接呼叫 `toggleSidebar()` 會走另一條分支（同檔 L556–560）。三份 `sidebarFrame` 本體逐位元組相同（Nav L135–150、Spaces L32–47、Chrome L31–46），也都只在 unified 讀 `sidebar.openPx`。
   - **修法。** 從相同開啟狀態測兩個實際 command 接收端。標準版 ⌘B 應維持側欄狀態，Chrome 按鈕收合、Tabs 按鈕重開（`mods/orca-chrome/main.js:22–24,115`、`mods/orca-tabs/main.js:1444–1456`）。Unified 的 ⌘B 和按鈕各應觸發 native drawer，另測收合中反向、結束後 `main` 回 `weight:1`。三個 view 用同一組 unified／寬度／主題 fixture 驗外框和展開時的直通行為。
5. **Blocker｜L101–104、114｜Z10、C8，驗收樹沒有把測試接上新產物。** Nav 和 Spaces 測試用 `../../scripts/` 與 `./main.js`，Spaces 另用同目錄快照和 `../${mod}/review-store.js`（`mods/orca-nav/refresh.test.js:8–9`、`mods/orca-spaces/render.test.js:9–13,47–52`、`review-store.test.js:5–7`）。原樣搬走會讀錯檔或缺檔。父提交也沒有本批新的腳本、測試與 manifest。`scripts/perf-spaces.py:17–33,90–93` 只接受 Git ref 或取腳本所在樹，第二參數無法傳來源路徑。
   - **修法。** 先用 3a／3b 的路徑清單與父提交 Git 模式核對空 staging。再補父版未接管的 runtime 檔、兩套 layouts 和根設定，放入候選版 `scripts/`、`orca-ui/`、測試與 fixtures，禁止覆蓋新產物。搬遷的測試和快照留在 feature 來源旁，清掉 staging 裡父版同名測試以免重跑。3b 測試從驗收根目錄解析 `scripts/gpui-stub-loader.mjs` 與實際 `mods/<mod>/` 下的 JS，快照仍從測試旁讀。以候選版目錄結構從 staging 根跑 `node --test mods scripts orca-ui/features`，比對測試名稱及數量。Spaces 缺快照直接失敗。從 staging 的 `scripts/` 跑兩支效能探針，傳新探針輸出目錄、不傳 ref（`scripts/perf-spaces-virtual.py:12–14`）。步驟 1 要指定 CLI 替身回傳及驗證方式。
6. **Major｜L101–102｜3a、3b 的產物差異規則互相打架。** 改尾行就有位元組差異，抽 helper 則至少會新增三個檔、從三個 `main.js` 刪掉函式本體並加 import。原函式已用到 `props/layout/shared/theme/div`（第 4 點證據）。`scripts/sync-shared.test.mjs:3–11` 需替換已刪模組的 import 和 API，`scripts/where-error.test.js:12–16,27–32` 也硬編碼舊路徑。
   - **修法。** 3a 允許且僅允許 20 個目的檔尾註解改成新來源及新生成器，保留執行位元。3b 的新目的路徑寫明是三個 `mods/<mod>/sidebar-frame.js`，允許三個 `main.js` 刪本體與新增 import，其餘 runtime 檔、資產、模式逐檔比父版。既有 footer 標記規則一併寫明。3a 同批改 sync 測試用新路徑表，更新反查三個案例與 OpenCode 測試（`scripts/opencode-launch.test.mjs:5–7`）。
7. **Major｜L19、26、40、69、97、101｜反查與驗證界線仍缺。** README 只有路徑文字（`README.md:101–105`）。現有 `app.mjs:12–25` 只列 panel/head、layout 名稱和下一跳。builder 已讀 manifest，反查也已自行讀；只在步驟 2 才共用。反查只有 feature 分支有測試、layout 和 next，任何未知 mod 路徑都被當成「原地修改」（`scripts/where-error.mjs:12–18,21–44,49–53`）。非 Error throw 可完全沒有 frame（`artifacts/orca-bundler/20261123T162528Z-retest/column-semantics/RESULT.md:14,19–32`）。壞 JSON 目前也未由 `fail()` 接管（`scripts/build-orca-ui.mjs:17–20,34–38`）。
   - **修法。** 區分現況和步驟 2／3。README 加實際相對連結。loader 只走訪磁碟核對登記集合，builder 和反查一律查同一份已解析對應。manifest 或引用錯誤回 2。每個 slot 查 ID 與其掛載 mod，`keys` 查頂層區段。反查要逐幀保留有值的 byte 欄，區分已受管、已知手寫、未知路徑及無 frame。共用副本列 owner、消費端與可用的測試／layout，補測未知、無欄和無 frame。L69 的示範指向隔離副本。
8. **Major｜L100、119｜兩個提交有回復順序，live 新檔無法靠 cp 還原。** Revert 3a 會移除 3b 依賴的 shared loader／manifest。Revert 3b 則會留下 live 的三份 `sidebar-frame.js`，dev-sync 明令不鏡像刪除（`.agents/skills/herdr-app-dev-sync/SKILL.md:10–17`）。
   - **修法。** 有 3b 先回 3b，再回 3a。用回復後版本的 builder 與仍存在的 `sync-shared.mjs` 重建、比較 Git blob／模式。逐檔複製變更並列出 live 剩檔由擁有者處置。從一份含自訂設定、runtime 資料與額外 mod 的假 app home 演練升級及回復，記錄這些檔的雜湊。

## 其餘錯誤與改寫退步

9. **Major｜L9、105–107｜Z1，檢查點延到 3b 之後，理由只支持 3a。** `scripts/sync-shared.mjs:10–19,40–46` 和 `orca-ui/features/panel/head/manifest.json:5–18` 目前已各管各的路徑。Spaces／Tasks 排序範例也沒指定第三個 mod 和未遷移入口（`mods/orca-tasks/main.js:2–6`、`mods/orca-chrome/runner.js:129–152`）。
   - **修法。** 選定 3a 後先比較才搬側欄，或明列 3b 是本輪額外對照試點並取得決策。兩組固定同一父版、helper 生成方式、測試狀態、模型和起始 README。C 說明搬回哪些來源與測試、如何保留相同連結資訊。先定題目、預期 diff 與計分方式（工具數用各組中位數，受管產物手改判錯）。若保留 3b 後檢查點，可用「在 Workspace Options 和側欄已開啟的 Chrome 新增同一收合操作，由 Tabs 的 native drawer 接收」作三 mod 題，先寫兩套 layout 的預期行為。
10. **Major｜L42、125｜Z6、C5，「沒有任何工具會改寫」過廣。** `mods/orca-agent-manager/main.js:63,569–570,859–870` 會寫 app home 的 `programs.json`。`README.md:129` 的首次安裝範例也會複製三份設定。
    - **修法。** 改成「builder 不生成根目錄三份設定，遷移與回復不覆寫已存在的 live 設定」。另交代 Agent Manager 原有的 runtime 寫入和 README 首次安裝範圍。
11. **Major｜L80、113｜C6，titlebar 工具的現況寫錯，layout 差異清單不完整。** `scripts/titlebar-height.py:10–14,38–44,57–78` 現有 `--check`、`--root`，預設只寫 repo，`--write-live` 才加寫 live。除 tabs 外，Nav、Spaces、Chrome、右面板多個節點也有 unified props（`layouts/orca-unified.json:78–116,200–296`），外層還有 `left`／`work` 組合差異（`layouts/orca-unified.json:37–62`、`layouts/orca.json:41–110`）。
    - **修法。** 明載現有參數與預設值。步驟 5 改來源側寫入，保留現有唯讀介面，停用 `--write-live`，改由 dev-sync 交付。把列出的差異標為例子，以兩套父版完整 JSON、節點順序及巢狀 pane header 為驗收。
12. **Major｜L77、85、111、117｜Z7、C7、C11，完成條件可漏測。** 失敗數可因為漏掉一批測試而維持零，Git blob 相同也可能只掉執行位元（`scripts/build-orca-ui.test.js:39–52`）。24-mod 矩陣目前只有欄位要求，缺入口資料。Sidebar 批至少還有 Nav 的 Workspace Options → Spaces Refresh（`mods/orca-nav/refresh.test.js:20–30`），以及標準版 Chrome 的 brand 與 footer 兩個角色（`layouts/orca.json:52–60,90–100`）。
    - **修法。** 綁定父提交 SHA，保留發現的測試清單與每項結果，按名稱比對，純搬家驗 blob 加 Git 模式。每批先登記可操作入口、觸發、預期結果、關閉方式與隔離狀態；3b 至少列上述三個角色／路徑及雙 layout。把 440／440 的全綠敘述附上該 SHA 的隔離測試輸出。
13. **Nit｜L16、22、30、59、65–67、98｜C3、C9、Z11–Z12，幾處現況寫得太絕對。** `hc` 是命令入口，實測還有 `herdr-core connect` 程序（`README.md:17–18`、上述 window 報告 L18–21）。OMP 先取 OMP 變數，再取 PI，最後才用執行子程序的 `$HOME/.omp/agent`（`mods/orca-agents/main.js:149–166`）。目前 source map 結論只來自 0.1.17 的外部／inline 探針，發布量是兩個樣本（`docs/plan-orca-bundler-evaluation.md:5–12`、`artifacts/orca-bundler/20261123T160756Z/observations.md:18–28`）。事件錯誤仍未實測（window 報告 L29）。
    - **修法。** 寫清楚 CLI、core 和 OMP 路徑優先序。把 source map、stack、無點擊指令的結論限定於已測版本與案例。補一句 statusline 是 Claude Code 回呼 wrapper（`README.md:82–94`），`gpui-kit`／`gpui-base` 是 host UI 模組（`scripts/gpui-stub-loader.mjs:1–7`）。把 `README.md:6,108,123` 列為步驟 2 確認改完的項目；目前第 6 行和 L43／126 的所有權決策相反。

## 開工前要定案

- 步驟 2 要定逐檔路徑表、掃描範圍、HEAD／模式／缺檔規則、反查與退出碼。
- 步驟 3 要定允許的產物差異、驗收樹兩階段的組法、視窗隔離及預期結果、回復順序，以及側欄試點是否先於去留檢查。

## PROPOSE FIX 逐項處置

- **Z1** 落了門檻，試點時點、題目和對照組仍待定（第 9 點）。**Z2、Z3、Z4、Z5** 都落了文字，缺可執行契約（第 1、2、7 點）。
- **Z6** 已取消安裝器，需收窄設定與回復承諾（第 8、10 點）。**Z7** 已分流，純搬家仍須比模式和測試清單（第 12 點）。**Z8、Z9、Z10** 均部分落地，現有驗收會卡住（第 3–5 點）。
- **Z11** plan 已改正 unified 鍵表與舊 replay 未入版控說法，README／入口命令列為後續修補（L98、`orca-ui/app.mjs:30–33`）。**Z12** 已移走大部分實驗細節，但應直接連到實測檔並標範圍（第 3、13 點）。
- **C1** 已落（L3）。**C2** 已落定義，loader 與共用 manifest 例外待補（第 1、7 點）。**C3** 已補名詞，CLI／程序關係待修（第 13 點）。**C4** 已落（L15–17）。**C5** 已落，設定寫入承諾待修（第 10 點）。**C6** 已補但現況錯（第 11 點）。
- **C7** 已移除歷史段落的硬引用，當批矩陣仍欠接線（第 12 點）。**C8** 已決測試放來源旁，產物如何載入仍待補（第 5 點）。**C9** 部分落地（第 13 點）。**C10** 已落（L129）。**C11** 已區分當前與舊實驗，當前全綠缺同 SHA 紀錄（第 12 點）。Z13 是 DECLINE。

## 已核對的基準與驗證範圍

- `2d38b99`／`9b9e22a` 與第一批路徑吻合。24 個 mod 由 `mods/*/mod.json` 計數；兩套 layout 的遞迴 `mod` 集合相同。8 份來源、13 個目的 mod、20 份副本吻合（`scripts/sync-shared.mjs:10–27`）。鍵表 57／10／35，無 unified 區段（`keys.json:2,61,73`）。`tasks.json`、`layouts/.state/` 未追蹤。
- ⌘⇧F 的 show → select → Contents、中央 Tasks、Changes 開 Diff、New Menu 開 Worktree 均吻合（`keys.json:102`、`orca-ui/features/panel/head/panel-views.js:7–24`、`mods/orca-files/main.js:723–733`、`layouts/orca.json:121–180`、`mods/orca-changes/main.js:492–504`、`mods/orca-new-menu/main.js:215–217`）。skillshare CLI 由 `mods/skillshare/jobs.js:43–48` 呼叫。建立 Herdr 型別檔的描述與 `.gitignore:1–4` 相符。
- 440 個案例可靜態核對（437 個呼叫點，`mods/orca-spaces/git-refresh.test.js:24–29` 的四次迴圈多三個）。舊 A/B/C 的 12 次、速度和 A/C 既有 16 個失敗吻合（`artifacts/orca-bundler/20261123T162528Z-retest/ab-comprehension/RESULT.md:1–17`）。
- 本輪僅跑唯讀檢查。17 項 Node 測試通過，builder 的 12 個產物、shared 與 titlebar 的 `--check` 均通過。完整 suite 有建立 fixture 的測試，本輪未重跑；Herdr 視窗與 live 行為只核對既存證據。
