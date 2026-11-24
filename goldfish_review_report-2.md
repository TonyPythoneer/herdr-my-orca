# Goldfish 審查報告（第二輪 · mimo-2.6-pro high）

- **審查對象（PLAN）**：`docs/plan-orca-ui-package.md`（TARGET：full file）
- **CONTEXT**：`implementation_readiness_report.md` ＋ repo 原始碼（`mods/`、`shared/`、`scripts/`、`layouts/`、`keys.json`、`settings.json`、`programs.json`、`README.md`、`.agents/skills/herdr-app-dev-sync/SKILL.md`）
- **審查方式**：**兩個獨立上下文的唯讀審查者**（app-owned delegated tasks，各自全新 context、只讀）：
  - Pass 1「實作準備度」（readiness-1-*）
  - Pass 2「程式碼核對」（codebase-1-*）
  兩者皆 completed。此為隔離審查，非 single-context 近似。
- **模型說明（誠實記錄）**：委派時指定 `deepai/deepseek-v4.1-flash`，但 orchestrator 實際以繼承的 `deepai/mimo-2.6-pro` 執行兩個 reviewer；DeepSeek 的審查另有 buffy 的 single-context 報告（`goldfish_review_report.md`）。本輪因此是「mimo 雙隔離審查 ＋ buffy DeepSeek 單上下文審查」的合併去重。
- **計畫版本注意**：審查期間計畫被並行修訂（buffy 的修正陸續落地、`orca-ui/` 首批實作出現）。本報告的 evidence 行號對應**各 reviewer 讀到的版本**；每則發現的處置已對照目前工作區計畫重新裁決，並註明「已修／部分修／未修」。
- 未實作計畫內容；reviewer 未修改任何原始碼。計畫更新由本彙整者依使用者「由你更新計畫並署名」的指示套用。

## 驗證補充（本彙整者實跑）

| 項目 | 方法 | 結果 |
|---|---|---|
| `node --test mods scripts orca-ui/features` | PATH 替身攔截 `herdr-app` | **428／428 全綠**，與計畫「已修成全綠（428/428）」相符 |
| statusline 副作用 | 同上替身 | 仍攔到 **3 次 `do orca-status.refresh`**（`claude-statusline.sh` 經繼承 PATH 通知視窗）——Task 1 隔離必須早於第一次跑測試，此點維持成立 |
| `mods/` 數 | `ls -d mods/*/` | 24 個 mod 目錄（22 `orca-*`＋`agent-config`＋`skillshare`） |
| `sidebarFrame` 三份副本 | byte 比對 | 逐位元組相同（readiness 確認） |
| layout bytes | `wc -c` | `orca.json` 7,826、`orca-unified.json` 9,307；2 空格重序列化後 7,826／9,342（兩 reviewer 獨立重現） |

---

## ESCALATE（需你裁決，先列）

### E1（本輪）— `skillshare` 的性質：repo 自有 mod，還是 vendored 第三方？

- **來源**：codebase-1-1（Blocker）。**狀態**：未修（計畫仍寫「保留上游來源…仍需讀上游實作」）。
- **計畫位置**：「第三方與執行期資料」列（現第 29 行）；歷史 Task 1「`skillshare` 保留第三方來源」。
- **矛盾**：README 稱 repo 只放「our own mods (`orca-*`, `agent-config`, `skillshare`)」；dev-sync skill 稱「`skillshare` is part of Orca and tracked in `mods/skillshare/`」；git 歷史為有機成長（`09ae041` Add the Skillshare panel、`d97f824` 納入版控），無 vendor commit、無 LICENSE／NOTICE／上游 URL；`sync-shared.mjs` 還把 repo 自有的 `panel-motion.js` 寫**進** `mods/skillshare/`。
- **影響**：若為自有 mod，「讀上游實作」「不改寫上游碼」不可實作且會凍結第一方程式；若確有上游，README／dev-sync 就是錯的，須同批更正。
- **要你回答**：skillshare 是自有還是 vendored？（若是 vendored，請給上游 URL／版本。）
- **對應修正（擇一）**：自有→該列改「`mods/skillshare/` 是 repo 自有 mod，Orca 以 `sync-shared` 受管的 `panel-motion.js` 副本接入」；vendored→Task 1 指名 pinned 來源與版本並同批修 README／dev-sync。

### E2（承接 buffy E1）— `layout:orca-unified` 是否補建快捷鍵區段（A 案文件化 vs B 案產品變更）

- **來源**：codebase-1-5／buffy E1。**狀態**：計畫已按 **A 案**寫入（`layout:orca` 的 35 條不作用於 unified，只繼承 `global`／`terminal`——經 host `AGENTS.md:523-525` scope 規則與 live `keys.json` 證實）。
- **要你回答**：接受 A（維持現狀、只文件化）？或 B（產生並安裝 `layout:orca-unified`，Task 3 與快捷鍵驗收一併改寫）？未回覆前維持 A。

---

## BLOCKER

### codebase-1-1 — skillshare「上游／第三方」定性與 repo 文件矛盾

→ 見 **E1**（裁決需 repo 外知識）。**狀態**：未修。

---

## MAJOR

### readiness-1-1 — 測試搬進來源樹後，「單向生成＋逐位元組比對＋兩邊執行」互相矛盾

- **位置**：Task 2／步驟 2（原 54、59 行）。
- **問題**：「產物由來源單向生成」「保留位元組」與「遷入來源的測試…另列允許差異並驗證兩邊執行的案例」衝突：一份逐位元組相同的測試無法在兩個深度都跑（`mods/orca-panel-head/panel-views.test.js:35` 用 `../../keys.json`，搬到 `orca-ui/features/panel/head/` 就解析到不存在的 `orca-ui/keys.json`；`../scripts/gpui-stub-loader.mjs` 同類）。若來源與產物位元組不同，builder 就不是純複製，「允許差異」沒有比較基準。
- **處置：PROPOSE FIX — 已套用（部分由 buffy 先行修）**。現行計畫已定測試去向（搬到 features 並改寫相對定位，或留產物旁）；本輪補上「允許差異只限路徑常數」，並要求搬前搬後跑同一組案例。（若你要來源／產物逐位元組全等，另一條路是測試以向上尋找 repo 根定位 `keys.json`／`gpui-stub-loader.mjs`，由 builder 不改位元組——兩者擇一即可。）
- **狀態**：verified（路徑實際解析）。

### readiness-1-2 — 歷史需求哪些仍具約束力未定義；「Task 1／Task 2」懸空引用

- **位置**：原 7、45、58 行。
- **問題**：現行計畫稱「遇到差異以現行計畫為準」，卻把歷史 Task 5a 操作案例、P0 install manifest、P1 24-mod 矩陣、P1 單一驗收指令全部留在歷史段落，沒說是廢除還是併入；正文又引用不存在於現行段落的「Task 1／Task 2」。
- **處置：PROPOSE FIX — 已套用**。歷史 P0／P1 已多數併入（buffy：隔離清單、manifest、升級 fixture、測試發現路徑）；本輪併入 24-mod 入口矩陣與每批冒煙，並把「Task 1」「Task 2」引用改指「歷史 Task N」。
- **狀態**：verified。

### readiness-1-3 ／ codebase-1-2 — `herdr-app check` 寫入 `gpui-kit.d.ts`／`jsconfig.json`，污染路徑集合比對；「多檔」漏列為失敗案例

- **位置**：步驟 3（原 60 行）、`--check` 說明（原 54 行）。
- **證據**：`.agents/skills/herdr-app-dev-sync/SKILL.md:16`（兩檔「written by `herdr-app check`」）；README「Not included」列 `*.d.ts`、`jsconfig.json`。
- **處置：PROPOSE FIX — 已套用**（排序「check 在比對後／一次性副本」由 buffy 先行修；本輪補：兩檔不入版控、不列入路徑集合比對；`--check` 的失敗案例補「多出未宣告檔案」）。
- **狀態**：verified（repo 文件；未實跑 check，因其會寫檔）。

### readiness-1-4 — 現行驗收無「跑起來的操作」案例與 24-mod 入口矩陣

- **位置**：實施順序與驗收（原 56–61 行）。
- **問題**：建置保真、unit／render、AI 可讀性都有了，但歷史 Task 5a 的操作驗收（⌘⇧F→Contents、⌘B／按鈕切側欄、右鍵選單、頁尾開 Tasks、`herdr-app status` 差異）與 P1 的 24-mod 入口矩陣不在現行驗收內；行為保留的承諾可以帶著 runtime regression 通過全部 gate。
- **處置：PROPOSE FIX — 已套用**：每批受影響入口冒煙（快捷鍵／按鈕／選單／overlay 各一）＋ `herdr-app status` 對比；完整遷移後 24-mod 入口矩陣。
- **狀態**：verified（原文缺漏）。

### codebase-1-3 — `titlebar-height.py` 對 unified 會 assert 失敗，「移交寫入責任」缺驗收條件

- **位置**：步驟 3（原 60 行）、歷史 98 行。
- **證據**：`scripts/titlebar-height.py:13-22`（`ROW` 含 `brand`、`assert len(nodes) == len(ROW)`、硬寫 live `~/.config/herdr-app/layouts/orca.json`）；`brand` 只存在 `layouts/orca.json`，unified 無此節點。
- **處置：PROPOSE FIX — 已修**（buffy：依 layout 用不同期望節點集、`--check`／`--root`、預設不寫 live）。無新增條文。
- **狀態**：verified。

### codebase-1-4 — 失敗的 titlebar 案例與 15 個效能案例同為「探針過期」，計畫只排修一種

- **位置**：步驟 3（原 60 行）。
- **證據**（reviewer 重現）：`scripts/perf-spaces.py:61,80` 的 `replace_once` 針與 `render(cx) → renderBody` 重構脫節（`mods/orca-spaces/main.js:968`）；`scripts/titlebar-height.test.js:26-37` 擷取 `mods/orca-tabs/main.js:1404` 的運算式含未綁定的 `unified` → `ReferenceError`。兩者都是探針過期，不是行為退化。
- **處置：PROPOSE FIX — 已套用**：修復範圍明列兩者（本輪實跑確認已修，428/428 全綠；計畫原文的「遷入 spaces 前先修復卡在 fixture 的效能探針」已過時，改為「兩者已修、回歸即退化」）。
- **狀態**：verified（reviewer 與彙整者皆重現修復後全綠）。

---

## NIT

### readiness-1-7 — 手改差異「保留供移植」未定義動作

- **位置**：`--check`／寫入說明（原 54 行）。
- **處置：PROPOSE FIX — 已套用**：列印 diff 並中止寫入，由人移植後重跑。
- **狀態**：verified。

### readiness-1-8 — 「實作形狀」清單漏 layout／主題來源

- **位置**：原 24 行 vs 33–39 行。
- **問題**：稱 layout、主題都由 `orca-ui/` 重生，但形狀區塊沒有它們的來源路徑；layout 移交後「輸出 JSON」的輸入在哪裡未定。
- **處置：PROPOSE FIX — 已套用**：補 `orca-ui/layouts/`、`orca-ui/themes/`（存放形式於移交時定案）。
- **狀態**：verified。

### codebase-1-6 — 歷史 Task 2 誇大 `sync-shared.mjs` 既有能力（已被現行計畫取代）

- **位置**：歷史 80 行。
- **處置：DECLINE** — 歷史段落依約保存原文，現行計畫（manifest 段）已明確取代該機制；加註只會破壞「保留原文」的約定。若你想在歷史段加一行「已由 builder 取代」，可另說。
- **狀態**：verified。

---

## 已由他人涵蓋／維持不變（無 finding）

- **readiness-1-5（隔離不全）**：buffy 已把 P0 隔離清單併入步驟 1；本輪實跑確認 statusline 仍需 PATH 替身，該條文必要且足夠。**已修**。
- **buffy B1（feature 單位）**：已由「Feature 是檔案所有權的單位」段落解決（與 readiness 觀察的「同畫面多 mod」一致）。
- **buffy M2／N2（測試發現與 `mods/keys.test.js` 家）**：已由測試去向段落與 README 單一指令解決。
- **buffy M4／M5（layout 差異即規格、`layout.test.js` 補斷言）**：已落地。
- **buffy M6／M8（seed-once／merge-only、Herdr keys 升級規則）**：已落地。
- **buffy N4（LICENSE／NOTICE）、N5（側欄動畫驗收）**：維持 DECLINE（同 buffy 理由）。

---

## 處置紀錄（依使用者「由你更新計畫並署名」指示）

套用到 `docs/plan-orca-ui-package.md` 的修正，皆署名 **（mimo-2.6-pro high）**：

1. 手改處置：「列印該 diff 並中止寫入，由人移植後重跑。」（readiness-1-7）
2. `--check` 失敗案例補「多出未宣告檔案」；`gpui-kit.d.ts`／`jsconfig.json` 不入版控與比對；check 排序在比對後或一次性副本。（readiness-1-3／codebase-1-2）
3. 測試搬動的允許差異限定「只限路徑常數」。（readiness-1-1）
4. 形狀清單補 `orca-ui/layouts/`、`orca-ui/themes/`。（readiness-1-8）
5. 探針修復範圍補 `titlebar-height.test.js` tab-padding 案例，並註明兩者已修、回歸即退化。（codebase-1-4）
6. 每批入口冒煙＋`herdr-app status` 對比＋24-mod 入口矩陣併入步驟 4。（readiness-1-4）
7. 「Task 1」懸空引用改「盤點清單（歷史 Task 1）」。（readiness-1-2）
8. 新增「補審紀錄與待決事項（mimo-2.6-pro high）」節，連結本報告與 buffy 報告，記錄實跑 428/428 與 3 次攔截，並列兩項 ESCALATE。

**未套用**：E1（skillshare 定性）、E2（unified 快捷鍵 A／B）——等你裁決。計畫已通過結構檢查（標題層級一致、表格完整、連結有效、歷史段落原文未動）。

## 審查者狀態

| 審查 | 方式 | 狀態 | 發現 |
|---|---|---|---|
| 實作準備度（readiness-1-*） | 獨立唯讀子代理 | completed | 1 Blocker（=重疊）、5 Major、2 Nit |
| 程式碼核對（codebase-1-*） | 獨立唯讀子代理 | completed | 1 Blocker、4 Major、1 Nit |
| DeepSeek（buffy，single-context） | 另一 CLI 會話 | completed（見 `goldfish_review_report.md`） | E1、B1、B2、M1–M9、N1–N5 |

無法從 repo 驗證者：`herdr-app check` 的實際寫入行為（CLI 無唯讀模式）、`HERDR_APP_HOME` 的 runtime 行為、`herdr-app status` 輸出、host `layout:<name>` scope 語意（引自 `~/.config/herdr-app/AGENTS.md`，經 buffy 授權讀取）。