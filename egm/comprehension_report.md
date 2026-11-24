# Stage 6 Comprehension Test：docs/plan-orca-ui-package.md

範圍：FeatureRange 1–75、DetailedRange 76–104。審查者（egm-comprehension）只讀這兩段，沒有其他背景資料。

## What this proposes

The plan moves the Orca UI's hand-maintained files into one source package, `orca-ui/`. The files covered are the mods, the two layouts (`orca` and `orca-unified`), the themes and the assets. A new AI should be able to start from `orca-ui/app.mjs` and follow links to the right source, tests and shortcut config without opening generated files.

- **Build:** a Node.js copy builder, `scripts/build-orca-ui.mjs`, generates the files Herdr loads under `mods/`, `layouts/` and `themes/`. A per-batch manifest controls which files it writes, and `--check` mode reports drift.
- **No bundler:** measurements showed little size gain and broken error mapping.
- **Error mapping:** a helper, `scripts/where-error.mjs`, maps Herdr error locations back to the source file and line.
- **Batches:** `orca-panel-head` goes first, then the sidebar together with the eight shared JS helpers.
- **Checks per batch:** each batch runs in an isolated Herdr instance against an all-green test suite (428/428). There is also a test where a fresh AI must find the right files to change.

## How the existing system works, per this document

Herdr is a host app that runs on QuickJS.

- **Loading mods:** it loads each mod from `mods/<name>/main.js`. It picks mods through layout JSON fields (`content.mod`, `content.props`) or through commands and overlays.
- **Shared code:** a mod may only import files from its own folder, so `scripts/sync-shared.mjs` copies shared helpers from `shared/` into each mod, following its `USES` table. Mods share live state through `shared()` and `setShared()`.
- **Settings:** `keys.json`, `settings.json` and `programs.json` stay in the repo root. They are seeded into the user's live config at `~/.config/herdr-app/` and never overwritten there.
- **Shortcuts:** a `layout:<name>` shortcut section only applies to the layout with that name.
- **Titlebar:** `titlebar-height.py` also writes or checks layout data.

## Findings

審查者可以複述每一節，所以**沒有 Blocker**。

### 🟡 C1　分不清哪些已完成、哪些還是計畫（第 7、33、61、81–83、89 行）
- 第 7 行說本文「只規劃遷移」，第 33 行說這些是「要實作的介面」。
- 但第 61 行說命令「已隨第一批實作」，第 57、89 行也引用了實測結果。
- **建議：** 在開頭加一行狀態，例如「第一批（panel-head、builder、where-error）已完成，其餘為計畫」。

### 🟡 C2　app.mjs、批次 manifest、builder descriptor、mod manifest 四者的關係不清楚（第 11、45、57、72 行）
- 讀者分不出這是一份檔案還是三份，也不知道批次 manifest 放在哪裡。
- 第 35–43 行的路徑清單裡，沒有 manifest，也沒有 `where-error.mjs`。

### 🟡 C3　沒有定義 Herdr 的組成元件（第 49、78、93 行）
- core（和 app 是不同程序，由 launchd 啟動）、`hc`、`shot` 都沒有解釋。
- 步驟 1 的隔離做法，必須先知道 app 和 core 是各自擁有環境的兩個程序才看得懂。

### 🟡 C4　沒有說明兩套 layout 各自的用途（第 15、28、86 行）
- 文件只列出 `orca` 和 `orca-unified` 的差異，沒說各自用來做什麼、誰在用。
- 「Orca」本身也沒有定義。

### 🟡 C5　「安裝器」和「dev-sync」沒有定義（第 70、74、81 行）
- 第 74 行替「安裝器」訂了規則，但文件其他地方都沒有出現安裝器。
- dev-sync 到底是安裝器、腳本，還是給 AI 看的 skill 文件，讀者無從判斷。

### 🟡 C6　`titlebar-height.py` 是第二個寫入者，卻沒有說明它寫什麼（第 84、86 行）
- 文件沒說它寫的是 repo 裡的 layout 還是 live 設定，也沒說它為什麼要動 layout。
- 這會影響文件自己訂的「每個檔案只能有一個寫入者」規則。

### 🟡 C7　現行計畫依賴自己宣稱「只供追溯」的歷史段落（第 78、80、93 行）
- 24-mod 盤點依賴「歷史 Task 1」。
- 隔離做法依賴「Review notes P0」，入口矩陣依賴「Review notes P1」。
- P0 已經在正文重寫一遍；盤點和 P1 矩陣沒有。

### 🟡 C8　測試放哪裡寫著「本批定案」，內文卻還列兩個選項（第 83 行）
- 第 83 行說測試去向在本批定案，接著又並列兩個選項；`keys.test.js` 也寫成「根目錄或 `orca-ui/`」。
- 實際上已經選了「搬到來源旁」，但文字沒有明說。

### 🟢 C9　沒有定義的名詞
- layout slots
- `OMP_`／`PI_` 變數，以及它們帶的是誰的憑證
- statusline
- `gpui-kit`／`gpui-base`
- 八個共用 JS 是哪八個，文件沒有列出

### 🟢 C10　署名標記沒有說明
- 例如「buffy deepseek-v4.1-flash high」，其中「buffy」從沒定義過。

### 🟢 C11　測試基準看起來互相矛盾（第 80、89 行）
- 第 80 行說基準是 428／428 全綠，第 89 行卻說 A、C 組帶著 16 個失敗。
- 讀者要自己推論出：修正只在本分支，main 上沒有。
