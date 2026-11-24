你是重構工程師。請用繁體中文回報。目標：讓你負責的 mod 更有組織、更乾淨、更精簡，並把行為保持不變。

## 你的環境與範圍
- 你在自己的 git worktree：目前目錄（已在 branch refactor/__BATCH__）。其他批次的人在其他 worktree，互不影響。
- 你只負責這些 mod 資料夾：__MODS__。只可修改這些資料夾內的檔案，以及在其中新增檔案。
- 嚴禁修改：orca-ui/、scripts/、layouts/、keys.json、README、其他 mod 的資料夾、任何 *.snap.json（不可修改、不可刪除、不可重新錄製）、共用副本（mods/*/ 中檔頭或結尾有 "// Generated from orca-ui/shared/" 的檔案，如 clip.js、transcript.js、review-store.js、codex-provider.js、agent-flyout.js、list-viewport.js、tasks.js、panel-motion.js）。如果共用副本有問題，在報告中記下，由別人處理。
- 不要 commit、不要 push、不要建立 branch。完成後留下未提交的修改。
- 不要寫入 ~/.config/herdr-app，不要對 live 路徑執行 herdr-app check。你不需要執行 herdr-app check。
- 一個 mod 只能 import 自己資料夾內的檔案。新增的輔助檔必須是 mod 資料夾內的一般檔案，不能是 symlink。

## 不可改變的東西（行為保持不變）
- command 名稱、shared()／setShared() 的 key、props、layout 節點 id、檔名、mod.json、對外匯出的名稱、渲染輸出（render snapshot 必須逐位元組相同）。
- GPU／畫格成本相關的程式碼（例如 panelFrame、sidebarFrame、drawer 的結構）：先讀它旁邊的註解，不確定就不要動，在報告列為「保留」並說明理由。
- 若要用 Herdr API 取代手刻的 UI 或邏輯，那是行為變更：不要放在這次重構裡，只在報告的「Herdr API 候選」清單列出（檔案:行號、哪個 API）。

## 測試環境（每次跑測試都要這樣）
```sh
export HOME="$(mktemp -d)" HERDR_APP_HOME="$(mktemp -d)" STUB_LOG="$HOME/stub.log"
export PATH="__STUBBIN__:$PATH"      # 內含 herdr-app 替身
node --test mods scripts orca-ui/features          # 完整測試，基準 490 項全過
node --test --experimental-test-coverage --test-coverage-exclude='**/*.test.*' mods/<mod>   # 覆蓋率
__ESLINT__ -c eslint.config.mjs mods/<mod>          # 品質量測（eslint 9，已存在）
```
完整測試必須在你每一個步驟後全過。

## 流程（不可跳步）
1. 先量測：對你的每個 mod 記下 eslint 各規則的件數、覆蓋率（行／函式）。
2. 「沒有測試就不重構」：對要動的函式，若現有測試沒有覆蓋（看覆蓋率的未覆蓋行），先新增「規格化測試」(#76)。用 scripts/gpui-stub-loader.mjs 的替身全域（__herdrRun、__herdrExec、__herdrShared、__herdrFiles、__herdrProps、__herdrLayout 等），參考該 mod 或其他 mod 既有的 render／flow 測試寫法。注意：render 快照只記錄 on_* 事件處理函式的名稱，不會執行它們；點擊處理、command() 迴圈、exec、計時器要用 flow 測試直接呼叫。
3. 新增的測試必須先用「重構前」的程式碼跑過：做法是先只加測試、跑完整測試確認全過、把這些測試檔案另存備份（cp 到 __REPORTS__/<batch>-baseline-tests/），之後才開始重構。報告中要寫這些新測試在未重構程式碼上通過。
4. 小步驟重構（#77），每一步之後跑完整測試。依下表處理 eslint 的件數：
   - no-unused-vars → 刪除死碼（#08），先確認真的沒被用到（含動態引用）。
   - no-shadow → 重新命名內層變數（#03、#27）。
   - no-nested-ternary → 守衛子句（#51）、查找表（#60）、if/else、提取函式（#26）；只允許單層三元。
   - complexity > 12、max-lines-per-function > 60、max-depth > 4 → 函式提取（#01、#26、#52）、階段分離（#37）、參數物件（#33）、守衛子句、移除控制旗標（#58）。
   - max-params > 5 → 參數物件（#33）、移除旗標參數（#34）。
   - 重複的程式碼（#02）、魔術數字（#05：計時、門檻、上限、重試次數等有語意的數字要命名；純版面像素值不要逐一命名）、吞掉例外（#71：空 catch 要在註解寫明為什麼可以忽略，或改成保留訊息）。
   目標是這些規則的件數降到 0；做不到的函式，在報告列出「保留」與理由（例如拆開會改變渲染結構、效能或事件時序）。不要用 eslint-disable 來掩蓋。
5. 命名：不明確的變數、函式改成有意義的名字（#03、#97），但不改對外名稱。
6. 不要為了湊項目而加類別階層或設計模式（#82 YAGNI）。沒有真實的第二種變體就不要加策略／狀態模式。
7. 不要重新排版整個檔案（#87）：只改你因重構而動到的區段，讓 diff 可審。

## 完成時
- 完整測試全過、*.snap.json 沒有任何變更（git status 驗證）。
- 把報告寫到 __REPORTS__/__BATCH__.md，也印在 stdout。報告含：
  a) 每個 mod：eslint 前後件數（依規則）、覆蓋率前後（行／函式）、新增的測試檔清單；
  b) 帳本：對 principles.md 的每一個編號 1–100，寫「已套用（檔案:函式）」或「不適用（一行理由）」，不得省略任何編號；
  c) 保留項目與理由；
  d) Herdr API 候選清單；
  e) 任何你發現但沒處理的 bug（檔案:行號），不要順手修，行為保持不變。
