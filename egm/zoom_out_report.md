# Stage 5 Initial Zoom Out：docs/plan-orca-ui-package.md

- 審查範圍：全文，以現行計畫（第 1–104 行）為主。
- 審查者：egm-zoom-out、egm-inventive-catalyst，兩者各自在獨立 context 中執行。
- 外部顧問：codex gpt-6.2-sol high，報告在 `codex_advice.md`，與本報告交叉對照。
- 背景資料（GoldfishContext）：`orca-ui/app.mjs`、`orca-ui/features/panel/head/manifest.json`、`scripts/{build-orca-ui,where-error,sync-shared}.mjs`、`README.md`、dev-sync `SKILL.md`、`keys.json`、兩套 layout、評估文件、三份舊審查報告。

## 結論

**需要修改。** 這份計畫的目標清楚，第一批的範圍也小，但有兩類問題：

1. 「24 個 mod 全部搬家」被寫成已經定案，可是計畫自己的 A/B/C 實測還證明不了搬家有幫助。
2. 有幾項功能被標為「已修正」，但 builder 實際上沒有做到：寫入前擋下手改，以及抓出多出來的產物檔。

兩位審查者和 codex 對第 2 類問題的判斷一致。

## 發現

### 🔴 Z1　逐批擴大缺少「做還是不做」的檢查點（zoom-out）
- **位置：** 第 5、84、89 行。
- **問題：**
  - A/B/C 實測裡，「main 加 app.mjs 地圖」的 C 組 12 題全對，和新結構的 B 組一樣。
  - 不是共用 helper 的檔案，現在本來就只有一份可編輯的版本。搬家後會變成兩份（來源與產物），之後才需要 builder、`--check`、「不要改產物」的規則，以及 `where-error.mjs`。
  - 真正難懂的是隱藏路徑，例如 command、overlay、shared key。處理這部分的是地圖，不是搬檔案。
- **建議：** 在第二批之前加一個量化的檢查點：用跨多個未遷移 mod 的題目比較 C 組（只有地圖）和 B 組（地圖加 builder），B 明顯勝出才繼續擴大。
- **反方意見（codex）：** codex 判斷第二批可以照現有做法進行（READY WITH FIXES），沒有質疑「要不要繼續搬」。這兩種看法需要擁有者取捨。

### 🔴 Z2　寫入前擋下手改的保護沒有實作，卻標成已修正（catalyst F1、zoom-out #6、codex 2）
- **位置：** 第 70、99 行。
- **問題：** `scripts/build-orca-ui.mjs:85–89` 直接覆蓋產物檔。有人手改 `mods/orca-panel-head/` 後再執行 build，修改會被無聲蓋掉。
- **建議（catalyst）：** 寫入前先比對：目的檔和新產物不同、也和 `HEAD` 版本不同時，印出 diff 並中止整批。輸出到空目錄時不做這項檢查。
- **建議（zoom-out，反方）：** 拿掉這條規則，改成 Git 加上必跑的 `--check` 就夠了。

### 🔴 Z3　`--check` 抓不到多出來的產物檔，卻標成已修正（catalyst F2、zoom-out #6、codex 2）
- **位置：** 第 84、99 行。
- **問題：** `--check` 只巡訪 manifest 宣告的檔案。如果 `mods/orca-panel-head/` 裡多了一個未宣告的 `extra.js`，而且 `main.js` 有 import 它，這個檔案會被發給 Herdr，`--check` 卻照樣通過。
- **建議：** 列出整個輸出目錄後，扣掉以下三類，剩下的就算漂移：
  - manifest 宣告的檔案
  - `gpui-kit.d.ts`、`jsconfig.json`
  - `USES` 分配到這個 mod 的共用副本

### 🟡 Z4　`app.mjs` 和 manifest 是兩份手寫副本，builder 沒有讀 `app.mjs`（兩位審查者、codex 1）
- **位置：** 第 11、20 行。
- **問題：**
  - `source`、`output`、layouts（`layoutSlots`）和 shortcuts（`keys`）在 `app.mjs` 和 manifest 各寫一次。
  - builder 自己走訪目錄找 manifest。一個有 manifest、卻沒有寫進 `app.mjs` 的 feature 照樣能 build，但從入口看不到它。
  - `where-error.mjs` 另外複製了一份走訪目錄的程式。
- **建議：** 只保留一份描述。讓 `app.mjs` import 各 manifest，只補讀者需要的欄位（例如 `next`）。builder 和 `where-error` 共用同一個 loader。

### 🟡 Z5　manifest 有些欄位沒有任何程式讀取（zoom-out #3）
- **位置：** 第 72 行。
- **問題：** `layoutSlots`、`commands`、`keys`、`shared` 只出現在 manifest 裡，沒有任何程式讀取。其中 `commands` 甚至是無法檢查的 `orca-panel-head.<view>` 這種樣式。
- **建議：** 二選一：
  - 先拿掉，等有實際的檢查（例如 24-mod 矩陣或懸空 command 檢查）用到再加回來。
  - 照 catalyst 的建議加一個便宜的檢查：每個 `layoutSlots` 節點和 `commands` 前綴，都必須真的出現在 `layouts/*.json` 和 `keys.json` 裡。

### 🟡 Z6　計畫為一個不存在的安裝器訂了規則（zoom-out #4）
- **位置：** 第 28、74、91 行。
- **問題：** repo 裡沒有安裝器，現在是靠 README 手動複製和 dev-sync 逐檔 `cp`。計畫卻訂了 seed／merge 規則和升級、回復演練。
- **建議：** 二選一：
  - 寫明這份計畫裡沒有任何工具會寫入三份設定檔。
  - 刻意把安裝器加進檔案清單，並說明為什麼需要。
- codex 把這項列為「可延後，第一次要用生成樹安裝之前要收斂」。

### 🟡 Z7　純搬家的批次，驗收成本和風險不成比例（zoom-out #5）
- **位置：** 第 81、93 行。
- **問題：** 如果產物和父提交逐位元組相同，Herdr 執行的就是同一份程式。這時每批都做視窗冒煙測試、手動點擊，並不會多抓到問題。
- **建議：** 完整的實機驗收只留給產物真的會改變的批次（例如 layout 改由程式組合、側欄程式合併），純搬家只要求位元組相同。
- **反方意見（codex 3）：** 側欄這批不是純搬家。⌘B 的實際行為在 `orca` 和 `unified` 兩套 layout 不一樣（標準版的 command 會被 `unified` guard 擋掉），所以需要先把基準寫清楚。

### 🟡 Z8　exec 類 mod 永遠不進視窗測試，而且沒有解除條件（catalyst F4）
- **位置：** 第 78、93 行。
- **問題：** Agents、New Agent、Handoff、狀態列這些風險最高的 mod，被排除在視窗測試之外，計畫也沒寫什麼時候解除。
- **建議：** 用另一個 macOS 使用者帳號或一次性 VM 跑視窗測試，在那個帳號裡 core 的 HOME 本來就沒有憑證。最少要在步驟 1 寫明「建立測試帳號後解除」。

### 🟡 Z9　側欄批次的範圍和 ⌘B 基準沒有寫清楚（codex 3，兩位審查者未涵蓋）
- **位置：** 第 15、86 行。
- **問題：** 第 15 行寫「`orca` 直接切換 sidebar」，但實際上：
  - 標準版的 ⌘B 送出 `orca-tabs.toggle-sidebar` 後，被 `unified` guard 擋下，沒有任何作用。
  - 畫面上的按鈕走的是另一條路徑（`layout.hide/show`）。
- **建議：** 在第二批的切批表裡寫明：
  - 本批搬 `orca-nav`、`orca-spaces`、`orca-chrome` 和共用檔；`orca-tabs`、`drawer.js`、兩套 layout 留在原地。
  - 保留父提交的行為。標準版 ⌘B 沒有作用這件事另外記錄，要修就另立一個行為變更。

### 🟡 Z10　staging 驗收樹不完整（codex 4）
- **位置：** 第 84 行。
- **問題：**
  - 只 build 本批檔案的空目錄，缺少其他 mod、layout 和 fixture。
  - Spaces 的快照測試在快照不存在時會自己寫入一份。
  - 效能探針預設讀的是 repo 裡的 Spaces，不是產物。
- **建議：** 定一條固定流程：先檢查空 staging 目錄的完整輸出，再用父版本補齊成完整的驗收樹，然後跑產物測試。快照不存在時直接判失敗。

### 🟢 Z11　文件內容和程式碼對不上（zoom-out #6、#8，catalyst F5，codex 4）
- `orca-ui/app.mjs:32` 的 `--check` 範例少了 `--out .`，實際執行會以代碼 2 結束。
- README 第 6 行仍說 skillshare 是 third-party，第 123 行說 bundler 只省「about 3%」，第 106–109 行說「shared helpers one line up」（這已經過時）。
- 第 47 行說 `replay.sh`「不入版控」，但它已經放進 `9b9e22a`。
- 第 91 行說 unified「只有 `global`」，實際上還有 `terminal`。

### 🟢 Z12　現行計畫裡有太多實驗紀錄（zoom-out #7）
- **位置：** 第 47、49–57、78、95–101 行。
- **問題：** 位元組數、版本號、`env -i`／`lsof` 細節、UTF-8 欄號換算，以及每段後面的署名，都塞在現行計畫的段落裡。
- **建議：** 這些證據搬到評估文件和實測報告，現行計畫只留一句結論加連結。

### 🟢 Z13　builder 產生的 `.js` 檔裡沒有「這是生成檔」的標記（catalyst F6）
- **建議：** 首次移交之後，沿用 sync-shared 的做法，在最後一行加上生成說明。行號不會變，所以 `where-error.mjs` 不用改。

## 已檢查、維持原案的部分
- **不用 bundler：** 屬於平台限制（Herdr 不讀 source map，mod 只能 import 自己的資料夾），不是設計可以消除的矛盾（catalyst）。
- **說明行放在最後一行：** 讓副本行號和原件相同，`where-error.mjs` 可以維持單純的查表（catalyst）。
