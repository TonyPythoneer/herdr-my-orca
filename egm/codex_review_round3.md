NOT READY

L 指 `docs/plan-orca-ui-package.md` 第一條獨立 `---` 之前的行號。2a 的逐檔所有權仍有漏洞，2b 的正常重建規則互相矛盾。3a 的產物差異與既有測試清單已定案，首次交接仍依賴 2b 的修正。

1. **Blocker｜L97–100、L123、L142｜逐檔所有權必須涵蓋實際寫入位置。**
   - **證據**　`scripts/build-orca-ui.mjs:73–88` 直接寫目的路徑。若 `mods/orca-panel-head/main.js` 是指向 `../../keys.json` 的 symlink，解析後仍在 repo 內且為一般檔案，卻會改到 L50 排除的設定。L99 也只判 builder 與其他類別重疊，同一路徑仍可同時列在 `handwritten` 與 `USES`，反查會有兩種編輯入口。
   - **最小修法**　逐檔用正規化 repo 相對路徑判重，來源須在宣告的來源目錄內，目的須在指定的 `mods/<mod>/` 內。整批先拒絕目的檔及輸出根以下的 symlink 路徑元件，含斷鏈，`--force` 同樣適用。`handwritten` 也要與共用副本及 Herdr 保留檔互斥。加同根 symlink 與手寫／共用重疊各一個案例。

2. **Blocker｜L117–119、L175｜正常編輯會誤擋。**
   - **證據**　`scripts/build-orca-ui.mjs:73–88` 每次都重寫全部產物。第一次 build 後只改 `panel-views.js`，未改來源的 `files.svg` 仍比它的來源新。逐檔照 L117 判定會擋下整批，與 L119 的第二次 build 要通過矛盾。既有 `scripts/build-orca-ui.test.js:12–24` 建的是兩個不同目錄。
   - **最小修法**　先以預期 bytes（含 3a 尾行）及 `mode & 0o777` 比對，兩者相同就跳過預檢與寫入。只對需要改寫的現存目的檔做 mtime 預檢，整批通過後才寫入；只有模式不同也算待更新。測同一目的樹連續 build、中間只改一份來源，確認既有資產的 mtime 不動。

3. **Major｜L100、L117–119、L160–175｜mtime 的其餘情境。**
   - **`git checkout`。** L118 已說可能誤擋。採第 2 點後，bytes 與模式皆相符者直接跳過；仍有差異且目的檔較新時，核對差異後才用 `--force`。用 fixture 固定時間驗這兩種結果。
   - **首次 build。** L117 沒寫已有部分產物的首次 build。新 checkout 的相符檔跳過，個別缺檔一律可建立，即使輸出根非空。3a 的新尾行使 20 份舊副本全有差異。本輪讀到這 20 份副本都比舊來源新，若搬檔保留 mtime，未 checkout 也會擋。L160 應寫明先比對父版 20 份副本的內容與模式，僅因時間被擋即可用 `--force` 重跑一次。
   - **空目錄輸出。** L100、L117、L166–175 已寫清楚。沒有既存檔可比較，直接建立本批 12／32 檔；缺檔的 `--check` 回 1 且唯讀（`scripts/build-orca-ui.test.js:49–52`）。無須另外判斷目錄是否為空。
   - **限制與旗標。** 先手改副本、再存來源，會讓來源較新而漏擋。L118 應舉明此例及僅 `chmod` 不改 mtime 的情形，寫明開始編輯前可先跑 `--check` 找既有漂移。明定 `--force` 只略過 mtime，與 `--check` 併用回 2，路徑與宣告驗證照常。

4. **Major｜L96、L101–103、L111–112、L123、L142｜反查資料與錯誤契約。**
   - **證據**　`scripts/where-error.mjs:9–18,35–40` 從磁碟載 manifest，另由 `app.mjs` 補 layout／`next`。改為單向依賴已足以移除 fallback。L102 對載入失敗只要求診斷，未明定退出碼。3a 共用 manifest 只有來源與目的，沒有測試／layout 欄位，現有 `USES` 的 13 個消費 mod 也沒有 feature manifest。
   - **最小修法**　反查遇到壞 manifest 或衝突一律診斷並回 2。共用結果固定列來源和消費 mod；測試／slot 只有能從該消費 mod 的 feature manifest 取得才列。明定 `app.mjs` 用相同的 `{manifestPath, manifest}` 形狀登記共用 manifest，登記測試核對全部路徑。README 的舊「one line up」與「anything no manifest lists」須一起改，後者會誤導人直接編輯 `USES` 副本（`README.md:101–113`）。
   - **證據界線**　L102 所連 `artifacts/orca-bundler/20261123T162528Z-retest/codex-where-error/RESULT.md:3–12` 的三個 Herdr 探針均未產生 frame。最小修法是標明宿主探針待驗，以 `scripts/where-error.test.js:7–32` 作為目前可重跑的定位證據。

5. **已解決｜L123–142、L173–175｜3a 允許的 runtime 差異已定案。**
   - **證據**　L127–134 與 `scripts/sync-shared.mjs:10–27` 逐筆吻合，共 8 份來源、13 個 mod、20 條唯一目的路徑。本輪核對 20 份副本都等於來源加舊尾行，與 `9b9e22a` 的 Git 模式相符。12 個 panel-head 產物與來源的 bytes、模式也一致。L136–142 的新尾行與補 LF 規則可直接實作。
   - **最小修法**　差異契約無須改。明列 `shared/{agent-flyout.js:19,codex-provider.js:6,list-viewport.js:10,tasks.js:4}` 中指向舊腳本的四處內文註解依 bytes 契約保留；操作指令以更新後的 README／dev-sync 為準。

6. **已解決｜L86、L144–156、L163–175｜既有測試清單與 3a 驗收接線。**
   - **證據**　五個直接命中舊路徑／API 的測試正是 L150–154 所列。`mods/keys.test.js:5` 命中上游路徑；`mods/orca-panel-gap/panel-motion.test.js:7` 與 `mods/orca-spaces/review-store.test.js:5–7,83` 讀 runtime 副本，路徑照舊。repo 內建置後跑 suite，空輸出只用於產物比對，避開上一輪的驗收樹接線問題。
   - **最小修法**　將 `scripts/build-orca-ui.test.js:12–24` 明列為同批調整的現有測試，沿用名稱，把四檔抽查擴為 32 檔及模式比對。維持 L156 的 2a fixtures 交接與 L86 的名稱／結果核對。

7. **Major｜L85–90、L142、L160–178｜隔離套件與交付條件仍缺可執行的指引。**
   - **證據**　`egm/codex_rewrite_notes.md:13–23` 記錄 440 全過與替身收到三次呼叫，沒有替身的設定步驟。`mods/orca-status/claude-statusline.test.js:14–18` 只替換 cache 和顯示命令；`mods/orca-status/claude-statusline.sh:98–103` 仍從 PATH 找真實 app。`README.md:119–122` 與 `.agents/skills/herdr-app-dev-sync/SKILL.md:8–17,20` 另有 live 檢查和逐檔同步要求。
   - **最小修法**　在步驟 1 補暫存 `HOME`／`HERDR_APP_HOME`、PATH 前置的 `herdr-app` 替身（只接受 `do orca-status.refresh`、記錄並回 0）及 `command -v` 驗替身位置。明載 3a 的 repo 驗收與 live 交付各自的完成條件；隔離宿主待驗可完成 repo 驗收，live 用更新後的 dev-sync 指引交付。

核對現行段落的 77 個連結、兩套 layout 的 slot／鍵表、24 個 mod 與上述程式入口。現有 builder 和 sync-shared 的唯讀 `--check` 均通過，13 個反查／共用副本／panel-head 既有測試通過。完整套件、實際 build 與 Herdr 宿主本輪未重跑。
